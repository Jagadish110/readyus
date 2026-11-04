-- Localty 0043: a customer has 10 minutes to pay once the shop accepts, and both sides can see the clock.
--
-- Until now an accepted order could wait 15 minutes for payment, and that limit lived only inside the sweep, so
-- no screen could show it.
--
--   * orders.pay_deadline_at holds the moment the time to pay runs out. accept_order() sets it when the shop
--     accepts an order that still has to be paid, from platform_settings.order_pay_window_seconds (600 s).
--   * expire_stale_orders() cancels an order once that moment has passed. An order accepted before this
--     migration has no deadline stored, so it is held to 10 minutes from when it was accepted.
--   * The accept deadline is unchanged: 5 minutes, from order_accept_window_seconds.
--
-- Customers and shops read `orders` through per-column grants (0015), so the new column needs its own grant.

alter table public.platform_settings
  add column if not exists order_pay_window_seconds integer not null default 600;

alter table public.orders
  add column if not exists pay_deadline_at timestamptz;

grant select (pay_deadline_at) on public.orders to authenticated;

-- ---------- Accepting: start the clock for paying ----------

create or replace function public.accept_order(p_order uuid, p_actor uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.orders;
  v_pay_window integer;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status not in ('pending', 'payment_confirmed') then raise exception 'ORDER_NOT_DECIDABLE'; end if;

  -- The shop waited too long. The sweep (expire_stale_orders) closes the order; until it runs, accepting is refused.
  if v_order.status = 'pending'
     and v_order.verified_prepaid_paise = 0
     and v_order.accept_deadline_at is not null
     and v_order.accept_deadline_at < now() then
    raise exception 'ORDER_TIMED_OUT';
  end if;

  -- clock_timestamp(), not now(): with auto-accept the order was placed in this same transaction, and the
  -- timeline must show "placed" before "accepted".
  insert into public.order_events (order_id, status, actor_id, actor_role, note, created_at)
  values (p_order, 'accepted', p_actor, 'seller', p_note, clock_timestamp());

  if v_order.required_online_paise > v_order.verified_prepaid_paise then
    select order_pay_window_seconds into v_pay_window from public.platform_settings where id;

    -- The shop said yes; now the customer pays. The kitchen starts once the money is in.
    update public.orders
       set status = 'payment_required', accepted_at = now(),
           pay_deadline_at = now() + make_interval(secs => v_pay_window)
     where id = p_order;

    perform public.notify(v_order.customer_id, 'customer', 'payment', 'Order accepted: pay now',
      'The shop accepted your order. Pay within ' || (v_pay_window / 60)::text || ' minutes so they can start preparing it.',
      '/orders/' || p_order::text, 'order-accepted:' || p_order::text);
  else
    update public.orders set status = 'accepted', accepted_at = now() where id = p_order;

    perform public.notify(v_order.customer_id, 'customer', 'order', 'Order accepted',
      'The shop accepted your order.', '/orders/' || p_order::text, 'order-accepted:' || p_order::text);
  end if;
end;
$function$;

revoke execute on function public.accept_order(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_order(uuid, uuid, text) to service_role;

-- ---------- The sweep: unpaid past the deadline ----------

create or replace function public.expire_stale_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count integer := 0;
  v_row record;
begin
  for v_row in
    select id, customer_id, seller_id, status, order_code, accepted_at, verified_prepaid_paise
    from public.orders
    where (
            -- The shop never answered in time. Under 0040 nothing has been paid yet; an order paid first
            -- (before 0040) has its deadline restarted when the money arrives.
            status in ('pending', 'payment_confirmed')
            and accept_deadline_at < now()
          )
       or (
            status in ('payment_required', 'payment_rejected')
            and case
                  -- Accepted, then not paid: the shop is holding the order, so the wait is short.
                  when accepted_at is not null then coalesce(pay_deadline_at, accepted_at + interval '10 minutes') < now()
                  else created_at < now() - interval '30 minutes'
                end
          )
    for update skip locked
  loop
    update public.products p
       set stock = p.stock + oi.quantity
      from public.order_items oi
     where oi.order_id = v_row.id and oi.product_id = p.id;

    if v_row.status in ('pending', 'payment_confirmed') then
      update public.orders
         set status = 'timed_out', cancelled_at = now(),
             cancel_reason = 'The shop did not respond in time'
       where id = v_row.id;

      insert into public.order_events (order_id, status, note)
      values (v_row.id, 'timed_out', 'The shop did not answer in time');

      perform public.notify(v_row.customer_id, 'customer', 'order', 'Order timed out',
        case
          when v_row.verified_prepaid_paise > 0 then 'The shop did not respond in time. Your payment is being refunded.'
          else 'The shop did not accept your order in time, so it was cancelled. Nothing was charged. Try another shop.'
        end,
        '/orders/' || v_row.id::text, 'timeout:' || v_row.id::text);

      perform public.notify((select user_id from public.sellers where id = v_row.seller_id), 'seller', 'order',
        'Order lost: not accepted in time',
        v_row.order_code || ' was cancelled because it was not accepted in time. Keep the app open to catch the next one.',
        '/business/orders/' || v_row.id::text, 'timeout-seller:' || v_row.id::text);
    else
      update public.orders
         set status = 'cancelled', cancelled_at = now(),
             cancel_reason = 'Payment was not completed'
       where id = v_row.id;

      insert into public.order_events (order_id, status, note)
      values (v_row.id, 'cancelled', 'Payment was not completed');

      perform public.notify(v_row.customer_id, 'customer', 'order', 'Order cancelled',
        'The order was cancelled because the payment was not completed.',
        '/orders/' || v_row.id::text, 'unpaid:' || v_row.id::text);

      if v_row.accepted_at is not null then
        perform public.notify((select user_id from public.sellers where id = v_row.seller_id), 'seller', 'order',
          'Order cancelled: not paid',
          v_row.order_code || ' was not paid in time. Do not prepare it.',
          '/business/orders/' || v_row.id::text, 'unpaid-seller:' || v_row.id::text);
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke execute on function public.expire_stale_orders() from public, anon, authenticated;
grant execute on function public.expire_stale_orders() to service_role;
