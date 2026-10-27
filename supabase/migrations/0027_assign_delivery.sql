-- Localty 0027: the shop assigns its own delivery partner.
--
-- Until now any partner on a shop's team could take (claim) a packed order. Shops manage their
-- own delivery, so the shop now chooses who delivers. The claim path is removed so an order has
-- exactly one way of getting a rider.
--
--   packed --assign_delivery()--> assigned --pickup_delivery()--> out_for_delivery --complete_delivery()--> delivered
--
-- Until the rider picks the order up, the shop can change the rider.

drop function if exists public.claim_delivery(uuid);
drop function if exists public.available_deliveries();

create or replace function public.assign_delivery(p_order uuid, p_agent uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller   uuid := public.current_seller_id();
  v_order    public.orders;
  v_agent    public.delivery_agents;
  v_assign   public.delivery_assignments;
  v_previous uuid;
begin
  if v_seller is null then raise exception 'SELLER_PROFILE_REQUIRED'; end if;

  select * into v_order from public.orders where id = p_order and seller_id = v_seller for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  -- Only a partner who is on this shop's active team, never someone else's.
  select a.* into v_agent
  from public.delivery_agents a
  where a.id = p_agent
    and a.status = 'approved'
    and exists (
      select 1 from public.delivery_relationships r
      where r.seller_id = v_seller and r.agent_id = a.id and r.active
    );
  if not found then raise exception 'RIDER_NOT_IN_TEAM'; end if;

  select * into v_assign from public.delivery_assignments where order_id = p_order for update;

  if found then
    -- Changing the rider is allowed only until the first rider has the food.
    if v_assign.status <> 'claimed' then raise exception 'ORDER_ALREADY_PICKED_UP'; end if;
    if v_assign.agent_id = p_agent then return; end if;

    v_previous := v_assign.agent_id;
    update public.delivery_assignments
       set agent_id = p_agent, claimed_at = now()
     where id = v_assign.id;

    perform public.notify(
      (select user_id from public.delivery_agents where id = v_previous),
      'delivery', 'delivery', 'Delivery given to someone else',
      'The shop changed the rider for ' || v_order.order_code || '. You do not need to deliver it.',
      '/delivery', 'unassigned:' || p_order::text || ':' || v_previous::text
    );
  else
    if v_order.status <> 'packed' then raise exception 'ORDER_NOT_READY'; end if;

    insert into public.delivery_assignments (order_id, agent_id, seller_id, cash_due_paise)
    values (p_order, p_agent, v_seller, greatest(v_order.total_paise - v_order.verified_prepaid_paise, 0));

    update public.orders set status = 'assigned' where id = p_order;

    insert into public.order_events (order_id, status, actor_id, actor_role, note)
    values (p_order, 'assigned', auth.uid(), 'seller', 'Delivery partner assigned');

    perform public.notify(v_order.customer_id, 'customer', 'delivery', 'Delivery partner assigned',
      'Your order is on its way to you soon.', '/orders/' || p_order::text,
      'assigned:' || p_order::text);
  end if;

  perform public.notify(
    v_agent.user_id, 'delivery', 'delivery', 'New delivery for you',
    'Order ' || v_order.order_code || ' is ready. Open your dashboard to collect it.',
    '/delivery', 'assigned-rider:' || p_order::text || ':' || p_agent::text
  );
end;
$$;

revoke execute on function public.assign_delivery(uuid, uuid) from public, anon;
grant execute on function public.assign_delivery(uuid, uuid) to authenticated;
