-- Localty 0025: foundation hardening.
--
--   1. The delivery code comes from a cryptographic source, and a wrong code is
--      counted: five misses lock completion of that order for 15 minutes.
--   2. A shop that does not answer a PAID order no longer holds the customer's
--      money forever: the order times out and the refund sweep returns the money.
--   3. Orders abandoned at the payment step stop holding stock.
--
-- Orders that are not paid online keep waiting for the shop, as set in 0020.

-- ---------- 1. Delivery code ----------

alter table public.orders
  alter column delivery_code
  set default lpad((abs(('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');

-- Not part of the column grant on orders, so neither the browser nor a rider can read them.
alter table public.orders
  add column if not exists delivery_code_attempts smallint not null default 0,
  add column if not exists delivery_code_locked_until timestamptz;

-- Now answers with a result instead of raising on a wrong code: an exception would roll
-- back the attempt counter along with everything else, and the counter is the point.
drop function if exists public.complete_delivery(uuid, text);

create function public.complete_delivery(p_order uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid := public.current_agent_id();
  v_order public.orders;
  v_cash  integer;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if not exists (
    select 1 from public.delivery_assignments
    where order_id = p_order and agent_id = v_agent and status = 'picked_up'
  ) then
    raise exception 'ASSIGNMENT_NOT_FOUND';
  end if;

  if v_order.delivery_code_locked_until is not null and v_order.delivery_code_locked_until > now() then
    return 'CODE_LOCKED';
  end if;

  if v_order.delivery_code <> trim(p_code) then
    update public.orders
       set delivery_code_attempts = case when delivery_code_attempts + 1 >= 5 then 0 else delivery_code_attempts + 1 end,
           delivery_code_locked_until = case when delivery_code_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where id = p_order;
    return 'INVALID_DELIVERY_CODE';
  end if;

  if v_order.verified_prepaid_paise < v_order.required_online_paise then
    raise exception 'ONLINE_PAYMENT_NOT_VERIFIED';
  end if;

  v_cash := greatest(v_order.total_paise - v_order.verified_prepaid_paise, 0);

  if v_cash > 0 then
    insert into public.payments (order_id, kind, provider, amount_paise, verified_by, verified_at, idempotency_key)
    values (p_order, 'cod_cash', 'other', v_cash, auth.uid(), now(), 'cash:' || p_order::text)
    on conflict (idempotency_key) do nothing;
  end if;

  update public.orders
     set status = 'delivered',
         delivered_at = now(),
         cash_collected_paise = v_cash
   where id = p_order;

  update public.delivery_assignments
     set status = 'delivered', delivered_at = now()
   where order_id = p_order;

  insert into public.order_events (order_id, status, actor_id, actor_role, note)
  values (p_order, 'delivered', auth.uid(), 'delivery', 'Delivered and verified by code');

  perform public.notify(v_order.customer_id, 'customer', 'order', 'Order delivered',
    'Enjoy. You can leave a review now.', '/orders/' || p_order::text,
    'delivered:' || p_order::text);

  perform public.notify(
    (select user_id from public.sellers where id = v_order.seller_id),
    'seller', 'order', 'Order delivered', '', '/business/orders/' || p_order::text,
    'delivered-seller:' || p_order::text);

  return 'OK';
end;
$$;

revoke execute on function public.complete_delivery(uuid, text) from public, anon;
grant execute on function public.complete_delivery(uuid, text) to authenticated;

-- ---------- 2. The shop's clock starts when the money arrives ----------

-- Same as 0023, plus: the shop's answer window restarts when payment is recorded, so a
-- customer who pays ten minutes after placing the order does not find it already expired.
create or replace function public.mark_order_paid(
  p_cashfree_order text,
  p_cashfree_payment text,
  p_amount_paise integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_window integer;
begin
  select * into v_order from public.orders
   where cashfree_order_id = p_cashfree_order
   for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if p_amount_paise <> v_order.required_online_paise then
    raise exception 'AMOUNT_MISMATCH';
  end if;

  -- Already recorded.
  if v_order.verified_prepaid_paise >= v_order.required_online_paise then
    return false;
  end if;

  select order_accept_window_seconds into v_window from public.platform_settings where id;

  insert into public.payments (order_id, kind, provider, amount_paise, reference, verified_at, idempotency_key)
  values (
    v_order.id,
    (case when v_order.payment_mode = 'full_prepaid' then 'full_online' else 'cod_prepayment' end)::payment_kind,
    'cashfree',
    p_amount_paise,
    p_cashfree_payment,
    now(),
    'cf:' || p_cashfree_payment
  )
  on conflict (idempotency_key) do nothing;

  update public.orders
     set verified_prepaid_paise = required_online_paise,
         payment_provider = 'cashfree',
         accept_deadline_at = case
           when status in ('payment_required', 'payment_rejected', 'customer_claimed_paid')
             then now() + make_interval(secs => v_window)
           else accept_deadline_at
         end,
         status = case
           when status in ('payment_required', 'payment_rejected', 'customer_claimed_paid')
             then 'payment_confirmed'::order_status
           else status
         end
   where id = v_order.id;

  if v_order.status in ('payment_required', 'payment_rejected', 'customer_claimed_paid') then
    insert into public.order_events (order_id, status, actor_role, note)
    values (v_order.id, 'payment_confirmed', 'customer', 'Paid online');

    perform public.notify(
      (select user_id from public.sellers where id = v_order.seller_id),
      'seller', 'payment', 'Order paid online',
      'The customer has paid. The money is on its way to your account. Accept the order to start.',
      '/business/orders/' || v_order.id::text,
      'paid-online:' || v_order.id::text
    );
  end if;

  return true;
end;
$$;

revoke execute on function public.mark_order_paid(text, text, integer) from public, anon, authenticated;
grant execute on function public.mark_order_paid(text, text, integer) to service_role;

-- ---------- 3. Sweep ----------

-- Returns the number of orders it closed. Safe to run often and from several places at once:
-- rows another run already holds are skipped.
--
--  - Paid online, shop silent past its deadline  -> timed_out (the refund sweep returns the money)
--  - Waiting for payment for over 30 minutes     -> cancelled (stock goes back on the shelf)
--
-- A payment that still arrives for a closed order is recorded by mark_order_paid and then
-- refunded by the same refund sweep, because the order is in an ended state.
create or replace function public.expire_stale_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  for v_row in
    select id, customer_id, status
    from public.orders
    where (
            status in ('pending', 'payment_confirmed')
            and verified_prepaid_paise > 0
            and accept_deadline_at < now()
          )
       or (
            status in ('payment_required', 'payment_rejected')
            and created_at < now() - interval '30 minutes'
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
        'The shop did not respond in time. Your payment is being refunded.',
        '/orders/' || v_row.id::text, 'timeout:' || v_row.id::text);
    else
      update public.orders
         set status = 'cancelled', cancelled_at = now(),
             cancel_reason = 'Payment was not completed'
       where id = v_row.id;

      insert into public.order_events (order_id, status, note)
      values (v_row.id, 'cancelled', 'Payment was not completed');
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.expire_stale_orders() from public, anon, authenticated;
grant execute on function public.expire_stale_orders() to service_role;
