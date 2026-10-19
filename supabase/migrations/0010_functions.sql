-- ReadyUs 0010: transactional business logic.
-- Everything that moves money or changes order state lives here, so it runs in
-- one transaction with the database as the only authority.

-- ---------- Notifications ----------

create or replace function public.notify(
  p_user uuid,
  p_role app_role,
  p_channel notification_channel,
  p_title text,
  p_body text default '',
  p_href text default null,
  p_dedupe text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, role, channel, title, body, href, dedupe_key)
  values (p_user, p_role, p_channel, p_title, p_body, p_href, p_dedupe)
  on conflict (dedupe_key) do nothing;
$$;

-- ---------- Role onboarding ----------

-- Creates the seller record and grants the seller role. The shop stays
-- invisible until an admin approves it.
create or replace function public.apply_to_sell(
  p_shop_name text,
  p_owner_name text,
  p_phone text,
  p_category text,
  p_listing_mode listing_mode,
  p_address text,
  p_city text,
  p_pincode text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  insert into public.sellers (user_id, shop_name, owner_name, phone, category, listing_mode, address, city, pincode)
  values (auth.uid(), p_shop_name, p_owner_name, p_phone, p_category, p_listing_mode, p_address, p_city, p_pincode)
  on conflict (user_id) do update
    set shop_name = excluded.shop_name,
        owner_name = excluded.owner_name,
        phone = excluded.phone,
        category = excluded.category,
        listing_mode = excluded.listing_mode,
        address = excluded.address,
        city = excluded.city,
        pincode = excluded.pincode
  returning id into v_seller;

  insert into public.user_roles (user_id, role) values (auth.uid(), 'seller')
  on conflict do nothing;

  -- Tell every admin there is something to review.
  insert into public.notifications (user_id, role, channel, title, body, href, dedupe_key)
  select ur.user_id, 'admin', 'approval',
         'New shop application',
         p_shop_name || ' applied to sell on ReadyUs.',
         '/admin/approvals',
         'seller-application:' || v_seller::text || ':' || ur.user_id::text
  from public.user_roles ur
  where ur.role = 'admin'
  on conflict (dedupe_key) do nothing;

  return v_seller;
end;
$$;

create or replace function public.apply_to_deliver(
  p_full_name text,
  p_phone text,
  p_vehicle text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  insert into public.delivery_agents (user_id, full_name, phone, vehicle)
  values (auth.uid(), p_full_name, p_phone, p_vehicle)
  on conflict (user_id) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        vehicle = excluded.vehicle
  returning id into v_agent;

  insert into public.user_roles (user_id, role) values (auth.uid(), 'delivery')
  on conflict do nothing;

  return v_agent;
end;
$$;

-- A partner joins a seller's fleet with a short code. Accepting a code is what
-- makes the partner eligible to take that seller's orders.
create or replace function public.redeem_delivery_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.delivery_invites;
  v_agent uuid := public.current_agent_id();
begin
  if v_agent is null then
    raise exception 'DELIVERY_PROFILE_REQUIRED';
  end if;

  select * into v_invite
  from public.delivery_invites
  where code = upper(trim(p_code))
  for update;

  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
  if v_invite.used_at is not null then raise exception 'INVITE_ALREADY_USED'; end if;
  if v_invite.expires_at < now() then raise exception 'INVITE_EXPIRED'; end if;

  update public.delivery_invites
    set used_by = v_agent, used_at = now()
    where id = v_invite.id;

  insert into public.delivery_relationships (seller_id, agent_id)
  values (v_invite.seller_id, v_agent)
  on conflict (seller_id, agent_id) do update set active = true, removed_at = null;

  -- Joining a fleet is the approval step for a delivery partner.
  update public.delivery_agents set status = 'approved' where id = v_agent;

  return v_invite.seller_id;
end;
$$;

grant execute on function public.apply_to_sell to authenticated;
grant execute on function public.apply_to_deliver to authenticated;
grant execute on function public.redeem_delivery_invite to authenticated;

-- ---------- Checkout ----------
--
-- Places one order per seller from the customer's cart, in a single
-- transaction. Prices, fees and the payment requirement are all recomputed on
-- the server; nothing the browser sent about money is trusted.

create or replace function public.place_order(
  p_address_id uuid,
  p_seller_id  uuid,
  p_pay_online boolean default false,
  p_note       text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_addr     public.addresses;
  v_seller   public.sellers;
  v_settings public.platform_settings;
  v_order    uuid;
  v_subtotal integer := 0;
  v_delivery integer := 0;
  v_platform integer := 0;
  v_total    integer := 0;
  v_required integer := 0;
  v_mode     payment_mode;
  v_distance numeric;
  v_item     record;
  v_price    numeric;
  v_stock    integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_addr from public.addresses where id = p_address_id and user_id = v_user;
  if not found then raise exception 'ADDRESS_NOT_FOUND'; end if;

  select * into v_seller from public.sellers where id = p_seller_id for update;
  if not found then raise exception 'SELLER_NOT_FOUND'; end if;
  if v_seller.status <> 'approved' or not v_seller.public_visible then
    raise exception 'SELLER_UNAVAILABLE';
  end if;
  if v_seller.location is null then raise exception 'SELLER_LOCATION_REQUIRED'; end if;

  -- The radius rule is re-checked at purchase time, not just at browse time.
  v_distance := round((st_distance(v_seller.location, v_addr.location) / 1000)::numeric, 2);
  if v_distance > v_seller.service_radius_km then
    raise exception 'OUTSIDE_DELIVERY_RADIUS';
  end if;

  select * into v_settings from public.platform_settings where id;

  -- Price every line from the products table, locking rows against races.
  for v_item in
    select ci.product_id, ci.variant_id, ci.quantity, p.name, p.price, p.stock,
           p.min_order_qty, p.images, p.variants, p.available, p.approval_status, p.public_visible
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    where ci.user_id = v_user and ci.seller_id = p_seller_id
    for update of p
  loop
    if not v_item.available or v_item.approval_status <> 'approved' or not v_item.public_visible then
      raise exception 'PRODUCT_UNAVAILABLE:%', v_item.name;
    end if;
    if v_item.quantity < v_item.min_order_qty then
      raise exception 'BELOW_MIN_QUANTITY:%', v_item.name;
    end if;

    v_price := v_item.price;
    v_stock := v_item.stock;

    -- A chosen variant overrides the base price and stock.
    if v_item.variant_id <> '' then
      select coalesce((value ->> 'price')::numeric, v_item.price),
             coalesce((value ->> 'stock')::integer, v_item.stock)
        into v_price, v_stock
      from jsonb_array_elements(v_item.variants)
      where value ->> 'id' = v_item.variant_id
      limit 1;
      if not found then raise exception 'VARIANT_NOT_FOUND:%', v_item.name; end if;
    end if;

    if v_stock < v_item.quantity then
      raise exception 'INSUFFICIENT_STOCK:%', v_item.name;
    end if;

    v_subtotal := v_subtotal + round(v_price * 100)::integer * v_item.quantity;
  end loop;

  if v_subtotal = 0 then raise exception 'CART_EMPTY'; end if;

  if v_seller.min_order_amount > 0 and v_subtotal < round(v_seller.min_order_amount * 100) then
    raise exception 'BELOW_MIN_ORDER';
  end if;

  v_delivery := round(v_seller.delivery_fee * 100)::integer;
  if v_seller.free_delivery_above > 0 and v_subtotal >= round(v_seller.free_delivery_above * 100) then
    v_delivery := 0;
  end if;

  v_platform := v_settings.platform_fee_paise;
  v_total := v_subtotal + v_delivery + v_platform;

  -- Resolve the one business mode this order will keep for life.
  if p_pay_online or not v_seller.cod_available then
    v_mode := 'full_prepaid';
    v_required := v_total;
  elsif v_seller.cod_prepayment_required and v_seller.cod_prepayment_amount > 0 then
    v_required := least(round(v_seller.cod_prepayment_amount * 100)::integer, v_total);
    -- A prepayment at or above the total collapses to a fully prepaid order.
    v_mode := case when v_required >= v_total then 'full_prepaid' else 'cod_partial_prepayment' end;
  else
    v_mode := 'normal_cod';
    v_required := 0;
  end if;

  insert into public.orders (
    customer_id, seller_id, status, payment_mode, cod_available_at_checkout,
    subtotal_paise, delivery_fee_paise, platform_fee_paise, total_paise, required_online_paise,
    delivery_address, delivery_location, distance_km, customer_note,
    accept_deadline_at
  ) values (
    v_user, p_seller_id,
    case when v_required > 0 then 'payment_required'::order_status else 'pending'::order_status end,
    v_mode, v_seller.cod_available,
    v_subtotal, v_delivery, v_platform, v_total, v_required,
    to_jsonb(v_addr) - 'location', v_addr.location, v_distance, p_note,
    now() + make_interval(secs => v_settings.order_accept_window_seconds)
  )
  returning id into v_order;

  -- Snapshot the lines and decrement stock.
  insert into public.order_items (order_id, product_id, name, variant_label, image_url, quantity, unit_price_paise, line_total_paise)
  select v_order, ci.product_id, p.name,
         coalesce((
           select value ->> 'label' from jsonb_array_elements(p.variants)
           where value ->> 'id' = ci.variant_id limit 1
         ), ''),
         p.images[1],
         ci.quantity,
         round(coalesce((
           select (value ->> 'price')::numeric from jsonb_array_elements(p.variants)
           where value ->> 'id' = ci.variant_id limit 1
         ), p.price) * 100)::integer,
         round(coalesce((
           select (value ->> 'price')::numeric from jsonb_array_elements(p.variants)
           where value ->> 'id' = ci.variant_id limit 1
         ), p.price) * 100)::integer * ci.quantity
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.user_id = v_user and ci.seller_id = p_seller_id;

  update public.products p
     set stock = p.stock - ci.quantity
    from public.cart_items ci
   where ci.product_id = p.id and ci.user_id = v_user and ci.seller_id = p_seller_id;

  delete from public.cart_items where user_id = v_user and seller_id = p_seller_id;

  insert into public.order_events (order_id, status, actor_id, actor_role, note)
  values (v_order, 'pending', v_user, 'customer', 'Order placed');

  perform public.notify(
    v_seller.user_id, 'seller', 'order', 'New order received',
    'Order is waiting for your decision.', '/business/orders/' || v_order::text,
    'order-placed:' || v_order::text
  );

  return v_order;
end;
$$;

grant execute on function public.place_order to authenticated;

-- ---------- Payment evidence ----------

-- The customer asserts they have paid. This records a claim only; it never
-- counts as money received.
create or replace function public.claim_payment(p_order uuid, p_reference text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order and customer_id = auth.uid() for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.required_online_paise = 0 then raise exception 'NO_ONLINE_PAYMENT_DUE'; end if;
  if v_order.status not in ('payment_required', 'payment_rejected') then
    raise exception 'PAYMENT_NOT_PENDING';
  end if;

  insert into public.payments (order_id, kind, provider, amount_paise, reference, claimed_at, idempotency_key)
  values (
    p_order,
    case when v_order.payment_mode = 'full_prepaid' then 'full_online' else 'cod_prepayment' end,
    'manual_upi',
    v_order.required_online_paise,
    p_reference,
    now(),
    'claim:' || p_order::text
  )
  on conflict (idempotency_key) do update set reference = excluded.reference, claimed_at = now();

  update public.orders set status = 'customer_claimed_paid' where id = p_order;

  insert into public.order_events (order_id, status, actor_id, actor_role, note)
  values (p_order, 'customer_claimed_paid', auth.uid(), 'customer', 'Customer reported payment');

  perform public.notify(
    (select user_id from public.sellers where id = v_order.seller_id),
    'seller', 'payment', 'Payment reported',
    'A customer says they have paid. Verify it to continue.',
    '/business/orders/' || p_order::text,
    'payment-claimed:' || p_order::text
  );
end;
$$;

-- The seller verifies the claim. Only this writes verified_prepaid_paise.
create or replace function public.verify_payment(p_order uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_seller uuid := public.current_seller_id();
begin
  select * into v_order from public.orders where id = p_order and seller_id = v_seller for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'customer_claimed_paid' then raise exception 'NO_CLAIM_TO_VERIFY'; end if;

  if p_accept then
    update public.payments
       set verified_by = auth.uid(), verified_at = now()
     where order_id = p_order and verified_at is null;

    update public.orders
       set status = 'payment_confirmed',
           verified_prepaid_paise = v_order.required_online_paise
     where id = p_order;

    insert into public.order_events (order_id, status, actor_id, actor_role, note)
    values (p_order, 'payment_confirmed', auth.uid(), 'seller', 'Payment verified');

    perform public.notify(v_order.customer_id, 'customer', 'payment', 'Payment confirmed',
      'Your payment was verified. The shop is preparing your order.',
      '/orders/' || p_order::text, 'payment-ok:' || p_order::text);
  else
    update public.orders set status = 'payment_rejected' where id = p_order;

    insert into public.order_events (order_id, status, actor_id, actor_role, note)
    values (p_order, 'payment_rejected', auth.uid(), 'seller', 'Payment could not be verified');

    perform public.notify(v_order.customer_id, 'customer', 'payment', 'Payment not verified',
      'The shop could not find your payment. You can try again.',
      '/orders/' || p_order::text, 'payment-no:' || p_order::text);
  end if;
end;
$$;

-- ---------- Seller order decisions ----------

create or replace function public.seller_decide_order(p_order uuid, p_accept boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_seller uuid := public.current_seller_id();
begin
  select * into v_order from public.orders where id = p_order and seller_id = v_seller for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status not in ('pending', 'payment_confirmed') then raise exception 'ORDER_NOT_DECIDABLE'; end if;

  if p_accept then
    update public.orders set status = 'accepted', accepted_at = now() where id = p_order;
    insert into public.order_events (order_id, status, actor_id, actor_role, note)
    values (p_order, 'accepted', auth.uid(), 'seller', 'Order accepted');

    perform public.notify(v_order.customer_id, 'customer', 'order', 'Order accepted',
      'The shop accepted your order.', '/orders/' || p_order::text, 'order-accepted:' || p_order::text);
  else
    -- Rejecting returns the reserved stock.
    update public.products p
       set stock = p.stock + oi.quantity
      from public.order_items oi
     where oi.order_id = p_order and oi.product_id = p.id;

    update public.orders
       set status = 'rejected', cancelled_at = now(), cancel_reason = p_reason
     where id = p_order;

    insert into public.order_events (order_id, status, actor_id, actor_role, note)
    values (p_order, 'rejected', auth.uid(), 'seller', p_reason);

    perform public.notify(v_order.customer_id, 'customer', 'order', 'Order declined',
      coalesce(nullif(p_reason, ''), 'The shop could not take this order.'),
      '/orders/' || p_order::text, 'order-rejected:' || p_order::text);
  end if;
end;
$$;

create or replace function public.seller_set_stage(p_order uuid, p_stage order_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := public.current_seller_id();
  v_customer uuid;
begin
  if p_stage not in ('preparing', 'packed') then raise exception 'INVALID_STAGE'; end if;

  update public.orders
     set status = p_stage,
         packed_at = case when p_stage = 'packed' then now() else packed_at end
   where id = p_order and seller_id = v_seller and status in ('accepted', 'preparing')
  returning customer_id into v_customer;

  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  insert into public.order_events (order_id, status, actor_id, actor_role)
  values (p_order, p_stage, auth.uid(), 'seller');

  perform public.notify(v_customer, 'customer', 'order',
    case when p_stage = 'packed' then 'Order packed' else 'Order being prepared' end,
    '', '/orders/' || p_order::text, p_stage::text || ':' || p_order::text);
end;
$$;

grant execute on function public.claim_payment to authenticated;
grant execute on function public.verify_payment to authenticated;
grant execute on function public.seller_decide_order to authenticated;
grant execute on function public.seller_set_stage to authenticated;

-- ---------- Delivery ----------

-- Orders a partner may take: packed, unassigned, and from a seller whose fleet
-- the partner belongs to.
create or replace function public.available_deliveries()
returns table (
  order_id uuid, order_code text, seller_name text, city text,
  distance_km numeric, total_paise integer, cash_due_paise integer, packed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.order_code, s.shop_name, s.city, o.distance_km, o.total_paise,
         greatest(o.total_paise - o.verified_prepaid_paise, 0),
         o.packed_at
  from public.orders o
  join public.sellers s on s.id = o.seller_id
  join public.delivery_relationships dr
    on dr.seller_id = o.seller_id
   and dr.agent_id = public.current_agent_id()
   and dr.active
  where o.status = 'packed'
    and not exists (select 1 from public.delivery_assignments da where da.order_id = o.id)
  order by o.packed_at asc;
$$;

create or replace function public.claim_delivery(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid := public.current_agent_id();
  v_order public.orders;
begin
  if v_agent is null then raise exception 'DELIVERY_PROFILE_REQUIRED'; end if;

  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'packed' then raise exception 'ORDER_NOT_READY'; end if;

  if not exists (
    select 1 from public.delivery_relationships
    where seller_id = v_order.seller_id and agent_id = v_agent and active
  ) then
    raise exception 'NOT_IN_SELLER_FLEET';
  end if;

  -- The unique index on order_id makes the race safe: only one claim wins.
  insert into public.delivery_assignments (order_id, agent_id, seller_id, cash_due_paise)
  values (p_order, v_agent, v_order.seller_id,
          greatest(v_order.total_paise - v_order.verified_prepaid_paise, 0));

  update public.orders set status = 'assigned' where id = p_order;

  insert into public.order_events (order_id, status, actor_id, actor_role, note)
  values (p_order, 'assigned', auth.uid(), 'delivery', 'Delivery partner assigned');

  perform public.notify(v_order.customer_id, 'customer', 'delivery', 'Delivery partner assigned',
    'Your order is on its way to you soon.', '/orders/' || p_order::text,
    'assigned:' || p_order::text);
end;
$$;

create or replace function public.pickup_delivery(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
begin
  update public.delivery_assignments
     set status = 'picked_up', picked_up_at = now()
   where order_id = p_order and agent_id = public.current_agent_id() and status = 'claimed';
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;

  update public.orders set status = 'out_for_delivery' where id = p_order
  returning customer_id into v_customer;

  insert into public.order_events (order_id, status, actor_id, actor_role)
  values (p_order, 'out_for_delivery', auth.uid(), 'delivery');

  perform public.notify(v_customer, 'customer', 'delivery', 'Out for delivery',
    'Your order has left the shop.', '/orders/' || p_order::text,
    'out-for-delivery:' || p_order::text);
end;
$$;

-- Completion is the only place cash is recorded. It requires the customer's
-- code, proves every required online amount was already verified, derives the
-- cash remainder on the server, and closes the money equation.
create or replace function public.complete_delivery(p_order uuid, p_code text)
returns void
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

  if v_order.delivery_code <> trim(p_code) then
    raise exception 'INVALID_DELIVERY_CODE';
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
end;
$$;

grant execute on function public.available_deliveries to authenticated;
grant execute on function public.claim_delivery to authenticated;
grant execute on function public.pickup_delivery to authenticated;
grant execute on function public.complete_delivery to authenticated;

-- ---------- Cancellation, timeout and admin review ----------

create or replace function public.cancel_order(p_order uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order and customer_id = auth.uid() for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  -- A customer may back out only before the shop has started working.
  if v_order.status not in ('pending', 'payment_required', 'payment_rejected', 'accepted') then
    raise exception 'ORDER_NOT_CANCELLABLE';
  end if;

  update public.products p
     set stock = p.stock + oi.quantity
    from public.order_items oi
   where oi.order_id = p_order and oi.product_id = p.id;

  update public.orders
     set status = 'cancelled_by_customer', cancelled_at = now(), cancel_reason = p_reason
   where id = p_order;

  insert into public.order_events (order_id, status, actor_id, actor_role, note)
  values (p_order, 'cancelled_by_customer', auth.uid(), 'customer', p_reason);

  perform public.notify(
    (select user_id from public.sellers where id = v_order.seller_id),
    'seller', 'order', 'Order cancelled', 'The customer cancelled this order.',
    '/business/orders/' || p_order::text, 'cancelled:' || p_order::text);
end;
$$;

-- Sweeps orders the shop never answered. Scheduled with pg_cron or called by a
-- Next.js cron route.
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
    select id, customer_id, seller_id from public.orders
    where status in ('pending', 'payment_confirmed')
      and accept_deadline_at < now()
    for update skip locked
  loop
    update public.products p
       set stock = p.stock + oi.quantity
      from public.order_items oi
     where oi.order_id = v_row.id and oi.product_id = p.id;

    update public.orders
       set status = 'timed_out', cancelled_at = now(),
           cancel_reason = 'The shop did not respond in time'
     where id = v_row.id;

    insert into public.order_events (order_id, status, note)
    values (v_row.id, 'timed_out', 'Acceptance window expired');

    perform public.notify(v_row.customer_id, 'customer', 'order', 'Order timed out',
      'The shop did not respond in time. Nothing was charged.',
      '/orders/' || v_row.id::text, 'timeout:' || v_row.id::text);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------- Admin review ----------

create or replace function public.review_seller(p_seller uuid, p_approve boolean, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_name text;
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;

  update public.sellers
     set status = case when p_approve then 'approved' else 'rejected' end::approval_status,
         public_visible = p_approve,
         review_note = p_note,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_seller
  returning user_id, shop_name into v_user, v_name;

  if not found then raise exception 'SELLER_NOT_FOUND'; end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), case when p_approve then 'seller.approve' else 'seller.reject' end,
          'seller', p_seller::text, jsonb_build_object('note', p_note));

  perform public.notify(v_user, 'seller', 'approval',
    case when p_approve then 'Your shop is live' else 'Shop application declined' end,
    coalesce(nullif(p_note, ''), case when p_approve then 'Customers nearby can now find you.' else '' end),
    '/business', 'seller-review:' || p_seller::text || ':' || clock_timestamp()::text);
end;
$$;

create or replace function public.review_product(p_product uuid, p_approve boolean, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;

  update public.products
     set approval_status = case when p_approve then 'approved' else 'rejected' end::approval_status,
         public_visible = p_approve,
         review_note = p_note
   where id = p_product
  returning (select user_id from public.sellers where id = products.seller_id) into v_user;

  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), case when p_approve then 'product.approve' else 'product.reject' end,
          'product', p_product::text, jsonb_build_object('note', p_note));

  perform public.notify(v_user, 'seller', 'approval',
    case when p_approve then 'Product approved' else 'Product declined' end,
    p_note, '/business/products',
    'product-review:' || p_product::text || ':' || clock_timestamp()::text);
end;
$$;

grant execute on function public.cancel_order to authenticated;
grant execute on function public.expire_stale_orders to authenticated, service_role;
grant execute on function public.review_seller to authenticated;
grant execute on function public.review_product to authenticated;
