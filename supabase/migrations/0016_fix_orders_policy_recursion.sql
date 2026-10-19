-- ReadyUs 0016: fix infinite recursion between the orders and
-- delivery_assignments read policies.
--
-- orders_participant_read looked into delivery_assignments, and
-- delivery_assignments_read looked back into orders, so any plain
-- `select ... from orders` failed with "infinite recursion detected in policy".
-- The cross-table checks move into security-definer helpers, which read the
-- other table without re-entering its policy.

create or replace function public.is_assigned_agent(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.delivery_assignments da
    where da.order_id = p_order and da.agent_id = public.current_agent_id()
  );
$$;

create or replace function public.is_order_customer(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order and o.customer_id = auth.uid()
  );
$$;

revoke execute on function public.is_assigned_agent(uuid) from public, anon;
revoke execute on function public.is_order_customer(uuid) from public, anon;
grant execute on function public.is_assigned_agent(uuid) to authenticated;
grant execute on function public.is_order_customer(uuid) to authenticated;

drop policy orders_participant_read on public.orders;
create policy orders_participant_read on public.orders
  for select using (
    customer_id = auth.uid()
    or seller_id = public.current_seller_id()
    or public.is_assigned_agent(id)
    or public.is_admin()
  );

drop policy delivery_assignments_read on public.delivery_assignments;
create policy delivery_assignments_read on public.delivery_assignments
  for select using (
    agent_id = public.current_agent_id()
    or seller_id = public.current_seller_id()
    or public.is_admin()
    or public.is_order_customer(order_id)
  );
