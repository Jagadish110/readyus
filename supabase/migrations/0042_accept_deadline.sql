-- Localty 0042: a shop has a few minutes to accept an order, or the order is lost.
--
-- Since 0040 every order is placed as "pending" and goes to the shop first; nothing is charged until the shop
-- accepts. The accept deadline (platform_settings.order_accept_window_seconds, 300 s = 5 minutes) was still set
-- on each new order, but only orders that had already been paid were closed when it passed. An order the shop
-- ignored simply stayed pending.
--
--   * expire_stale_orders() now also closes an unpaid pending order whose deadline has passed: it becomes
--     timed_out, its stock goes back on the shelf, and the customer and the shop are both told. Nothing was
--     charged, so there is nothing to refund.
--   * accept_order() refuses an order whose deadline has passed, even before the next sweep runs, so the shop
--     cannot accept an order it has already lost. Declining one still works.
--   * An order paid before 0040 (customer paid first) keeps its own clock, which starts when the money arrives.

-- ---------- Accepting: not after the deadline ----------

create or replace function public.accept_order(p_order uuid, p_actor uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.orders;
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
    -- The shop said yes; now the customer pays. The kitchen starts once the money is in.
    update public.orders
       set status = 'payment_required', accepted_at = now()
     where id = p_order;

    perform public.notify(v_order.customer_id, 'customer', 'payment', 'Order accepted: pay now',
      'The shop accepted your order. Pay now so they can start preparing it.',
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

-- ---------- The sweep: an order nobody accepted in time ----------

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
                  when accepted_at is not null then accepted_at < now() - interval '15 minutes'
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
