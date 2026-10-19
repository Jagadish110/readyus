-- ReadyUs 0015: order flow, live delivery tracking and reviews.
--
-- What this does, in plain terms:
--   1. place_order() no longer charges delivery or platform fees (launch pricing).
--   2. Customers can see the live position of the rider on their own order,
--      through order_map() and a narrow delivery_agents read policy.
--   3. Riders report their position with report_agent_location().
--   4. The six-digit delivery code stops being readable by riders and shops
--      (it was selectable through the orders RLS policy); the customer reads it
--      through order_delivery_code().
--   5. Reviews go through submit_review(), and a trigger keeps the rating
--      averages on products and sellers up to date.
--   6. Order, event, assignment and agent tables join the realtime publication.

-- ---------- 1. No fees ----------

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

  -- No delivery or platform fee at launch. The seller's delivery_fee setting and
  -- platform_settings.platform_fee_paise are ignored until pricing is decided.
  v_delivery := 0;

  v_platform := 0;
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
revoke execute on function public.place_order(uuid, uuid, boolean, text) from public, anon;

-- ---------- 2. Live tracking ----------

-- True when the signed-in customer has an in-flight delivery by this agent.
-- Security definer so the check does not recurse through the orders policy.
create or replace function public.is_my_rider(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.delivery_assignments da
    join public.orders o on o.id = da.order_id
    where da.agent_id = p_agent
      and o.customer_id = auth.uid()
      and da.status in ('claimed', 'picked_up')
  );
$$;

revoke execute on function public.is_my_rider(uuid) from public, anon;
grant execute on function public.is_my_rider(uuid) to authenticated;

create policy delivery_agents_customer_read on public.delivery_agents
  for select using (public.is_my_rider(id));

-- Everything the live map needs in one round trip. The rider position is only
-- returned while a delivery is in flight, and only to the parties on the order.
create or replace function public.order_map(p_order uuid)
returns table (
  shop_lat double precision, shop_lng double precision,
  dest_lat double precision, dest_lng double precision,
  rider_name text, rider_phone text,
  rider_lat double precision, rider_lng double precision,
  rider_updated_at timestamptz,
  delivery_status delivery_status
)
language sql
stable
security definer
set search_path = public
as $$
  select st_y(s.location::geometry), st_x(s.location::geometry),
         st_y(o.delivery_location::geometry), st_x(o.delivery_location::geometry),
         a.full_name, a.phone,
         case when da.status in ('claimed', 'picked_up') then st_y(a.location::geometry) end,
         case when da.status in ('claimed', 'picked_up') then st_x(a.location::geometry) end,
         case when da.status in ('claimed', 'picked_up') then a.location_updated_at end,
         da.status
  from public.orders o
  join public.sellers s on s.id = o.seller_id
  left join public.delivery_assignments da on da.order_id = o.id
  left join public.delivery_agents a on a.id = da.agent_id
  where o.id = p_order
    and (
      o.customer_id = auth.uid()
      or o.seller_id = public.current_seller_id()
      or da.agent_id = public.current_agent_id()
      or public.is_admin()
    );
$$;

-- The rider reports where they are. Only accepted while they hold an
-- unfinished delivery, so an idle partner is never tracked.
create or replace function public.report_agent_location(p_lat double precision, p_lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid := public.current_agent_id();
begin
  if v_agent is null then raise exception 'DELIVERY_PROFILE_REQUIRED'; end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_LOCATION';
  end if;

  if not exists (
    select 1 from public.delivery_assignments
    where agent_id = v_agent and status in ('claimed', 'picked_up')
  ) then
    raise exception 'NO_ACTIVE_DELIVERY';
  end if;

  update public.delivery_agents
     set location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
         location_updated_at = now()
   where id = v_agent;
end;
$$;

revoke execute on function public.order_map(uuid) from public, anon;
revoke execute on function public.report_agent_location(double precision, double precision) from public, anon;
grant execute on function public.order_map(uuid) to authenticated;
grant execute on function public.report_agent_location(double precision, double precision) to authenticated;

-- ---------- 3. Delivery code ----------

-- The orders policy lets a shop and the assigned rider read their orders. The
-- code proves the customer handed the order over, so neither may read it.
-- Column-level grants are how Postgres hides one column from a readable row.
-- Any column added to orders later needs its own grant select.
revoke select on public.orders from authenticated, anon;
grant select (
  id, order_code, customer_id, seller_id, status, payment_mode, payment_provider,
  cod_available_at_checkout, subtotal_paise, delivery_fee_paise, platform_fee_paise,
  total_paise, required_online_paise, verified_prepaid_paise, cash_collected_paise,
  refunded_paise, delivery_address, delivery_location, distance_km, customer_note,
  accept_deadline_at, accepted_at, packed_at, delivered_at, cancelled_at,
  cancel_reason, created_at, updated_at
) on public.orders to authenticated;

create or replace function public.order_delivery_code(p_order uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select o.delivery_code
  from public.orders o
  where o.id = p_order
    and o.customer_id = auth.uid()
    and o.status in ('accepted', 'preparing', 'packed', 'assigned', 'out_for_delivery');
$$;

revoke execute on function public.order_delivery_code(uuid) from public, anon;
grant execute on function public.order_delivery_code(uuid) to authenticated;

-- ---------- 4. Reviews ----------

-- A shop-level review has no product, and the unique key on (order, product)
-- does not stop duplicates of those because nulls never collide.
create unique index if not exists reviews_one_shop_review_per_order
  on public.reviews (order_id) where product_id is null;

create or replace function public.refresh_review_ratings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product uuid;
  v_seller uuid;
begin
  v_product := case when tg_op = 'DELETE' then old.product_id else new.product_id end;
  v_seller  := case when tg_op = 'DELETE' then old.seller_id else new.seller_id end;

  if v_product is not null then
    update public.products p
       set rating = coalesce((select round(avg(r.rating)::numeric, 1) from public.reviews r where r.product_id = p.id), 0),
           rating_count = (select count(*) from public.reviews r where r.product_id = p.id)
     where p.id = v_product;
  else
    -- The shop rating comes from shop-level reviews only.
    update public.sellers s
       set rating = coalesce((select round(avg(r.rating)::numeric, 1) from public.reviews r where r.seller_id = s.id and r.product_id is null), 0),
           rating_count = (select count(*) from public.reviews r where r.seller_id = s.id and r.product_id is null)
     where s.id = v_seller;
  end if;

  return null;
end;
$$;

revoke execute on function public.refresh_review_ratings() from public, anon, authenticated;

create trigger reviews_refresh_ratings
  after insert or update of rating or delete on public.reviews
  for each row execute function public.refresh_review_ratings();

-- Reviews are written through this function so a product can only be rated if
-- it was actually on the delivered order.
-- p_items: [{ "product_id": uuid, "rating": 1-5, "body": text }]
create or replace function public.submit_review(
  p_order uuid,
  p_shop_rating integer,
  p_shop_body text default '',
  p_items jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_item jsonb;
  v_product uuid;
  v_rating integer;
begin
  select * into v_order from public.orders where id = p_order and customer_id = auth.uid();
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'delivered' then raise exception 'ORDER_NOT_DELIVERED'; end if;

  if p_shop_rating is not null then
    if p_shop_rating not between 1 and 5 then raise exception 'INVALID_RATING'; end if;
    insert into public.reviews (author_id, order_id, product_id, seller_id, rating, body)
    values (auth.uid(), p_order, null, v_order.seller_id, p_shop_rating, coalesce(p_shop_body, ''))
    on conflict (order_id) where product_id is null
    do update set rating = excluded.rating, body = excluded.body;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_product := (v_item ->> 'product_id')::uuid;
    v_rating := (v_item ->> 'rating')::integer;
    if v_rating is null then continue; end if;
    if v_rating not between 1 and 5 then raise exception 'INVALID_RATING'; end if;
    if not exists (
      select 1 from public.order_items oi where oi.order_id = p_order and oi.product_id = v_product
    ) then
      raise exception 'PRODUCT_NOT_IN_ORDER';
    end if;

    insert into public.reviews (author_id, order_id, product_id, seller_id, rating, body)
    values (auth.uid(), p_order, v_product, v_order.seller_id, v_rating, coalesce(v_item ->> 'body', ''))
    on conflict (order_id, product_id)
    do update set rating = excluded.rating, body = excluded.body;
  end loop;
end;
$$;

revoke execute on function public.submit_review(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.submit_review(uuid, integer, text, jsonb) to authenticated;

-- Direct writes would skip those checks, so the browser may only read reviews.
revoke insert, update, delete on public.reviews from authenticated;

-- ---------- 5. Realtime ----------

do $$
declare
  t text;
begin
  foreach t in array array['orders', 'order_events', 'delivery_assignments', 'delivery_agents']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
