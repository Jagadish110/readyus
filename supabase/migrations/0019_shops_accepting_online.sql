-- ReadyUs 0019: let the storefront know which shops can take online payments.
--
-- seller_payout_accounts is locked down (no browser access at all), so this
-- returns only the shop ids that are ready, never the account details.

create or replace function public.shops_accepting_online(p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select seller_id
  from public.seller_payout_accounts
  where seller_id = any (p_ids) and status = 'activated';
$$;

revoke execute on function public.shops_accepting_online(uuid[]) from public;
grant execute on function public.shops_accepting_online(uuid[]) to anon, authenticated;
