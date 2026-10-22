-- ReadyUs 0017: Razorpay online payments with direct payout to the shop.
--
-- How the money moves: the customer pays on Razorpay Checkout, and the order is
-- created with a Route transfer, so the shop's share goes straight to its linked
-- account. ReadyUs keeps records only. Every write below is done by the server
-- with the service role after a verified signature; the browser cannot call them.

-- ---------- 1. Shop payout accounts ----------

-- Kept out of public.sellers on purpose: sellers is readable by every visitor.
create table if not exists public.seller_payout_accounts (
  seller_id           uuid primary key references public.sellers(id) on delete cascade,
  razorpay_account_id text not null check (razorpay_account_id ~ '^acc_[A-Za-z0-9]+$'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.seller_payout_accounts enable row level security;
-- No policies: only the service role (which bypasses RLS) can read or write it.
revoke all on public.seller_payout_accounts from anon, authenticated;

create or replace function public.admin_set_payout_account(p_seller uuid, p_account text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  if not exists (select 1 from public.sellers where id = p_seller) then
    raise exception 'SELLER_NOT_FOUND';
  end if;

  insert into public.seller_payout_accounts (seller_id, razorpay_account_id)
  values (p_seller, trim(p_account))
  on conflict (seller_id) do update
    set razorpay_account_id = excluded.razorpay_account_id, updated_at = now();

  insert into public.audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), 'seller.payout_account', 'seller', p_seller::text,
          jsonb_build_object('account', trim(p_account)));
end;
$$;

revoke execute on function public.admin_set_payout_account(uuid, text) from public, anon;
grant execute on function public.admin_set_payout_account(uuid, text) to authenticated;

-- ---------- 2. Link orders to Razorpay ----------

-- Not part of the column grant on orders, so the browser cannot read it.
alter table public.orders add column if not exists razorpay_order_id text;
create unique index if not exists orders_razorpay_order_idx
  on public.orders (razorpay_order_id) where razorpay_order_id is not null;

-- ---------- 3. Record a captured payment ----------

-- Safe to call twice (browser verify and webhook both arrive). Money is always
-- recorded; the order only moves forward if it is still waiting for payment.
-- A payment that lands on an order that was already cancelled stays on the
-- order as verified money, and orders_needing_refund() picks it up.
create or replace function public.mark_order_paid(
  p_razorpay_order text,
  p_razorpay_payment text,
  p_amount_paise integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders
   where razorpay_order_id = p_razorpay_order
   for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if p_amount_paise <> v_order.required_online_paise then
    raise exception 'AMOUNT_MISMATCH';
  end if;

  -- Already recorded.
  if v_order.verified_prepaid_paise >= v_order.required_online_paise then
    return false;
  end if;

  insert into public.payments (order_id, kind, provider, amount_paise, reference, verified_at, idempotency_key)
  values (
    v_order.id,
    case when v_order.payment_mode = 'full_prepaid' then 'full_online' else 'cod_prepayment' end,
    'razorpay',
    p_amount_paise,
    p_razorpay_payment,
    now(),
    'rzp:' || p_razorpay_payment
  )
  on conflict (idempotency_key) do nothing;

  update public.orders
     set verified_prepaid_paise = required_online_paise,
         payment_provider = 'razorpay',
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

-- ---------- 4. Refunds ----------

-- Orders that ended without delivery but still hold money we have not returned.
create or replace function public.orders_needing_refund()
returns table (order_id uuid, razorpay_payment text, amount_paise integer)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         p.reference,
         o.verified_prepaid_paise - o.refunded_paise
  from public.orders o
  join public.payments p
    on p.order_id = o.id and p.provider = 'razorpay' and p.kind <> 'refund'
  where o.status in ('rejected', 'cancelled_by_customer', 'cancelled', 'timed_out')
    and o.payment_provider = 'razorpay'
    and o.verified_prepaid_paise > o.refunded_paise
  limit 50;
$$;

create or replace function public.record_refund(
  p_order uuid,
  p_razorpay_refund text,
  p_amount_paise integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payments (order_id, kind, provider, amount_paise, reference, verified_at, idempotency_key)
  values (p_order, 'refund', 'razorpay', p_amount_paise, p_razorpay_refund, now(),
          'rzp-refund:' || p_razorpay_refund)
  on conflict (idempotency_key) do nothing;

  if found then
    update public.orders
       set refunded_paise = least(refunded_paise + p_amount_paise, verified_prepaid_paise)
     where id = p_order;
  end if;
end;
$$;

revoke execute on function public.orders_needing_refund() from public, anon, authenticated;
revoke execute on function public.record_refund(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.orders_needing_refund() to service_role;
grant execute on function public.record_refund(uuid, text, integer) to service_role;
