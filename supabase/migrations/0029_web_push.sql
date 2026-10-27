-- Localty 0029: browser notifications (Web Push).
--
-- Every notification is already a row in `notifications` (written inside the same transaction as
-- the thing it announces, by notify()). This migration adds the delivery side:
--
--   * push_subscriptions: one row per browser a person turned alerts on in.
--   * notifications.pushed_at / push_attempts / push_next_at: a delivery queue on the same table.
--     A worker "claims" due rows with a short lease, sends them, and marks them done. A crashed
--     worker's rows come back after the lease; several workers can run at once without sending twice.
--
-- The in-app inbox (the bell) reads the same rows, so a person who never allowed push, or whose
-- browser dropped the message, still sees everything.

create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  -- The browser vendor's address for this browser. Unique: a browser belongs to one person at a time.
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  user_agent      text not null default '',
  failures        smallint not null default 0,
  last_success_at timestamptz,
  created_at      timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Only the server touches this table; it holds the keys needed to send to a browser.
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

alter table public.notifications
  add column if not exists pushed_at timestamptz,
  add column if not exists push_attempts smallint not null default 0,
  add column if not exists push_next_at timestamptz not null default now();

-- History from before this existed is not replayed to anyone.
update public.notifications set pushed_at = now() where pushed_at is null;

create index if not exists notifications_push_queue_idx
  on public.notifications (push_next_at) where pushed_at is null;

-- Takes up to p_limit due notifications and leases them for two minutes, so a second worker (or the
-- same one on its next tick) does not send them again while the first is still working.
-- Gives up on a notification after 5 tries or 24 hours.
create or replace function public.claim_notifications_for_push(p_limit integer default 50)
returns table (
  id uuid, user_id uuid, role app_role, channel notification_channel,
  title text, body text, href text, dedupe_key text, push_attempts smallint
)
language sql
security definer
set search_path = public
as $$
  update public.notifications n
     set push_attempts = n.push_attempts + 1,
         push_next_at = now() + interval '2 minutes'
   where n.id in (
     select q.id from public.notifications q
     where q.pushed_at is null
       and q.push_next_at <= now()
       and q.push_attempts < 5
       and q.created_at > now() - interval '24 hours'
     order by q.created_at
     limit greatest(p_limit, 1)
     for update skip locked
   )
  returning n.id, n.user_id, n.role, n.channel, n.title, n.body, n.href, n.dedupe_key, n.push_attempts;
$$;

revoke execute on function public.claim_notifications_for_push(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications_for_push(integer) to service_role;

-- A customer whose order failed should hear that the money is on its way back, not only see the
-- order end. Same as 0023's record_refund, plus the notification (once per Cashfree refund id).
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
declare
  v_customer uuid;
  v_code text;
begin
  insert into public.payments (order_id, kind, provider, amount_paise, reference, verified_at, idempotency_key)
  values (p_order, 'refund', 'cashfree', p_amount_paise, p_cashfree_refund, now(),
          'cf-refund:' || p_cashfree_refund)
  on conflict (idempotency_key) do nothing;

  if found then
    update public.orders
       set refunded_paise = least(refunded_paise + p_amount_paise, verified_prepaid_paise)
     where id = p_order
    returning customer_id, order_code into v_customer, v_code;

    perform public.notify(v_customer, 'customer', 'payment', 'Refund started',
      'Rs ' || to_char(p_amount_paise / 100.0, 'FM999990.00') || ' for order ' || v_code
        || ' is on its way back to you. Your bank may take a few days to show it.',
      '/orders/' || p_order::text, 'refund:' || p_cashfree_refund);
  end if;
end;
$$;

revoke execute on function public.record_refund(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.record_refund(uuid, text, integer) to service_role;
