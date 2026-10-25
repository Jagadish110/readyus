-- Localty 0023: payments run on Cashfree (Easy Split) instead of Razorpay.
--
-- Each shop is a Cashfree Easy Split "vendor"; an online order is created at Cashfree
-- with a split that sends the shop's share straight to that vendor, so Localty never
-- holds the money. This migration is written to be safe to run on a database that
-- already has these changes (it was applied there first): every step checks before it acts.

-- ---------- 1. Orders: the Cashfree order id ----------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'orders' and column_name = 'razorpay_order_id') then
    alter table public.orders rename column razorpay_order_id to cashfree_order_id;
  end if;
end $$;

alter table public.orders add column if not exists cashfree_order_id text;
drop index if exists public.orders_razorpay_order_idx;
create unique index if not exists orders_cashfree_order_idx
  on public.orders (cashfree_order_id) where cashfree_order_id is not null;

-- ---------- 2. Shops: the Cashfree vendor id ----------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'seller_payout_accounts' and column_name = 'razorpay_account_id') then
    alter table public.seller_payout_accounts rename column razorpay_account_id to cashfree_vendor_id;
  end if;
end $$;

alter table public.seller_payout_accounts add column if not exists cashfree_vendor_id text;
alter table public.seller_payout_accounts drop column if exists razorpay_product_id;

do $$
declare
  c record;
begin
  -- Drop the old "acc_..." format check, whatever it was named, then add the vendor id format.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.seller_payout_accounts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%cashfree_vendor_id%'
      and conname <> 'seller_payout_accounts_cashfree_vendor_id_check'
  loop
    execute format('alter table public.seller_payout_accounts drop constraint %I', c.conname);
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'seller_payout_accounts_cashfree_vendor_id_check') then
    alter table public.seller_payout_accounts
      add constraint seller_payout_accounts_cashfree_vendor_id_check
      check (cashfree_vendor_id ~ '^[A-Za-z0-9_-]{3,50}$');
  end if;
end $$;

alter table public.seller_payout_accounts alter column cashfree_vendor_id set not null;

-- ---------- 3. Functions ----------
drop function if exists public.admin_set_payout_account(uuid, text);
drop function if exists public.mark_order_paid(text, text, integer);
drop function if exists public.orders_needing_refund();
drop function if exists public.record_refund(uuid, text, integer);

create function public.admin_set_payout_account(p_seller uuid, p_account text)
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

revoke execute on function public.admin_set_payout_account(uuid, text) from public, anon;
grant execute on function public.admin_set_payout_account(uuid, text) to authenticated;

-- Safe to call twice (the browser check and the webhook both arrive). Money is always
-- recorded; the order only moves forward if it is still waiting for payment.
create function public.mark_order_paid(
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

-- Orders that ended without delivery but still hold money we have not returned,
-- with the shop's vendor id so the refund can name whose share to take back.
create function public.orders_needing_refund()
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

create function public.record_refund(
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

revoke execute on function public.mark_order_paid(text, text, integer) from public, anon, authenticated;
revoke execute on function public.orders_needing_refund() from public, anon, authenticated;
revoke execute on function public.record_refund(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.mark_order_paid(text, text, integer) to service_role;
grant execute on function public.orders_needing_refund() to service_role;
grant execute on function public.record_refund(uuid, text, integer) to service_role;
