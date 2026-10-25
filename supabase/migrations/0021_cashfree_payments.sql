-- ReadyUs 0021: replace Razorpay with Cashfree (Payments + Easy Split vendors).
--
-- The flow is unchanged: the customer pays on Cashfree Checkout, the shop's share
-- is split straight to its vendor account, and ReadyUs keeps records only.

-- ---------- 1. Shop payout accounts ----------

-- Razorpay linked accounts mean nothing to Cashfree. Those shops simply add
-- their bank details again on the Payouts page.
delete from public.seller_payout_accounts where razorpay_account_id like 'acc\_%';

alter table public.seller_payout_accounts
  drop constraint if exists seller_payout_accounts_razorpay_account_id_check,
  drop column if exists razorpay_product_id;

alter table public.seller_payout_accounts rename column razorpay_account_id to cashfree_vendor_id;

alter table public.seller_payout_accounts
  add constraint seller_payout_accounts_cashfree_vendor_id_check
  check (cashfree_vendor_id ~ '^[A-Za-z0-9_-]{3,50}$');

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

  insert into public.seller_payout_accounts (seller_id, cashfree_vendor_id)
  values (p_seller, trim(p_account))
  on conflict (seller_id) do update
    set cashfree_vendor_id = excluded.cashfree_vendor_id, updated_at = now();

  insert into public.audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), 'seller.payout_account', 'seller', p_seller::text,
          jsonb_build_object('account', trim(p_account)));
end;
$$;

-- ---------- 2. Link orders to Cashfree ----------

alter type payment_provider add value if not exists 'cashfree';

drop index if exists public.orders_razorpay_idx;
drop index if exists public.orders_razorpay_order_idx;
alter table public.orders rename column razorpay_order_id to cashfree_order_id;
create unique index if not exists orders_cashfree_order_idx
  on public.orders (cashfree_order_id) where cashfree_order_id is not null;

-- ---------- 3. Record a successful payment ----------

drop function if exists public.mark_order_paid(text, text, integer);

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

  insert into public.payments (order_id, kind, provider, amount_paise, reference, verified_at, idempotency_key)
  values (
    v_order.id,
    case when v_order.payment_mode = 'full_prepaid' then 'full_online' else 'cod_prepayment' end,
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

drop function if exists public.orders_needing_refund();

-- Orders that ended without delivery but still hold money we have not returned.
-- Cashfree refunds by order, and the split is reversed from the shop's vendor.
create or replace function public.orders_needing_refund()
returns table (order_id uuid, cashfree_order text, vendor_id text, amount_paise integer)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         o.cashfree_order_id,
         a.cashfree_vendor_id,
         o.verified_prepaid_paise - o.refunded_paise
  from public.orders o
  join public.seller_payout_accounts a on a.seller_id = o.seller_id
  where o.status in ('rejected', 'cancelled_by_customer', 'cancelled', 'timed_out')
    and o.payment_provider = 'cashfree'
    and o.cashfree_order_id is not null
    and o.verified_prepaid_paise > o.refunded_paise
  limit 50;
$$;

drop function if exists public.record_refund(uuid, text, integer);

create or replace function public.record_refund(
  p_order uuid,
  p_cashfree_refund text,
  p_amount_paise integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payments (order_id, kind, provider, amount_paise, reference, verified_at, idempotency_key)
  values (p_order, 'refund', 'cashfree', p_amount_paise, p_cashfree_refund, now(),
          'cf-refund:' || p_cashfree_refund)
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
