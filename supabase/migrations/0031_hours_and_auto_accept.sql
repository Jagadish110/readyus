-- Localty 0031: opening hours are applied, and shops can accept orders automatically.
--
--   * A shop is open when its "Taking orders" switch is on AND the current time in India is inside its
--     opening hours (hours that cross midnight work; equal times mean open all day). Customers still see a
--     closed shop, marked closed with its hours, but cannot order from it.
--   * A shop with auto-accept on has orders accepted the moment they are ready for the shop: placed (cash)
--     or paid (online). Everything after that is unchanged.

alter table public.sellers add column if not exists auto_accept boolean not null default false;

create or replace function public.shop_is_open_now(p_seller uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.sellers;
  v_now time := (now() at time zone 'Asia/Kolkata')::time;
  v_open time;
  v_close time;
begin
  select * into s from public.sellers where id = p_seller;
  if not found or not s.business_open then return false; end if;

  begin
    v_open := s.open_time::time;
    v_close := s.close_time::time;
  exception when others then
    -- Unreadable hours must not lock a shop out: the switch alone decides.
    return true;
  end;

  if v_open = v_close then return true; end if;
  if v_open < v_close then return v_now >= v_open and v_now < v_close; end if;
  return v_now >= v_open or v_now < v_close;
end;
$$;

revoke execute on function public.shop_is_open_now(uuid) from public;
grant execute on function public.shop_is_open_now(uuid) to anon, authenticated, service_role;

-- Accepts an order for a shop that has auto-accept on. Safe to call for any order: it does nothing unless
-- the shop wants it and the order is waiting for the shop's decision.
create or replace function public.maybe_auto_accept(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found or v_order.status not in ('pending', 'payment_confirmed') then return; end if;
  if not coalesce((select auto_accept from public.sellers where id = v_order.seller_id), false) then return; end if;

  update public.orders set status = 'accepted', accepted_at = now() where id = p_order;

  -- clock_timestamp(), not now(): the order was placed in this same transaction, and the timeline must show
  -- "placed" before "accepted".
  insert into public.order_events (order_id, status, actor_role, note, created_at)
  values (p_order, 'accepted', 'seller', 'Accepted automatically', clock_timestamp());

  perform public.notify(v_order.customer_id, 'customer', 'order', 'Order accepted',
    'The shop accepted your order.', '/orders/' || p_order::text, 'order-accepted:' || p_order::text);
end;
$$;

revoke execute on function public.maybe_auto_accept(uuid) from public, anon, authenticated;
grant execute on function public.maybe_auto_accept(uuid) to service_role;

drop function if exists public.nearby_sellers(double precision, double precision, numeric, listing_mode, boolean, text, integer, integer);

create or replace function public.nearby_sellers(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_km  numeric default 5,
  p_mode       listing_mode default null,
  p_open_only  boolean default false,
  p_search     text default null,
  p_limit      integer default 40,
  p_offset     integer default 0
)
returns table (
  id            uuid,
  shop_name     text,
  category      text,
  listing_mode  listing_mode,
  description   text,
  address       text,
  city          text,
  photo_url     text,
  banner_url    text,
  rating        numeric,
  rating_count  integer,
  business_open boolean,
  open_time     text,
  close_time    text,
  eta_minutes   smallint,
  min_order_amount numeric,
  delivery_fee  numeric,
  free_delivery_above numeric,
  cod_available boolean,
  distance_km   numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with origin as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  )
  select
    s.id, s.shop_name, s.category, s.listing_mode, s.description,
    s.address, s.city, s.photo_url, s.banner_url,
    s.rating, s.rating_count, public.shop_is_open_now(s.id), s.open_time, s.close_time, s.eta_minutes,
    s.min_order_amount, s.delivery_fee, s.free_delivery_above, s.cod_available,
    round((st_distance(s.location, o.g) / 1000)::numeric, 2) as distance_km
  from public.sellers s
  cross join origin o
  where s.status = 'approved'
    and s.public_visible
    and public.shop_can_trade(s.id)
    and s.location is not null
    -- Shop inside the customer's chosen radius.
    and st_dwithin(s.location, o.g, p_radius_km * 1000)
    -- Customer inside the shop's own delivery radius.
    and st_distance(s.location, o.g) <= s.service_radius_km * 1000
    -- A shop belongs to a mode by its own type, or by selling at least one live
  -- item of that mode (a kitchen that also stocks bread and milk shows in both).
    and (
      p_mode is null
      or s.listing_mode = p_mode
      or exists (
        select 1 from public.products p
        where p.seller_id = s.id
          and p.listing_mode = p_mode
          and p.approval_status = 'approved'
          and p.public_visible
          and p.available
      )
    )
    and (not p_open_only or public.shop_is_open_now(s.id))
    and (
      p_search is null
      or p_search = ''
      or s.shop_name ilike '%' || p_search || '%'
      or s.category ilike '%' || p_search || '%'
    )
  order by distance_km asc, s.rating desc
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
$$;

create or replace function public.nearby_products(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_km  numeric default 5,
  p_mode       listing_mode default null,
  p_category   text default null,
  p_search     text default null,
  p_sort       text default 'distance',
  p_seller_id  uuid default null,
  p_limit      integer default 40,
  p_offset     integer default 0
)
returns table (
  id            uuid,
  seller_id     uuid,
  seller_name   text,
  name          text,
  description   text,
  category_key  text,
  listing_mode  listing_mode,
  price         numeric,
  mrp           numeric,
  unit          text,
  stock         integer,
  min_order_qty smallint,
  images        text[],
  veg_type      text,
  variants      jsonb,
  rating        numeric,
  rating_count  integer,
  business_open boolean,
  eta_minutes   smallint,
  distance_km   numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with origin as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  ),
  eligible as (
    select s.id, s.shop_name, public.shop_is_open_now(s.id) as business_open, s.eta_minutes,
           round((st_distance(s.location, o.g) / 1000)::numeric, 2) as distance_km
    from public.sellers s
    cross join origin o
    where s.status = 'approved'
      and s.public_visible
      and public.shop_can_trade(s.id)
      and s.location is not null
      and st_dwithin(s.location, o.g, p_radius_km * 1000)
      and st_distance(s.location, o.g) <= s.service_radius_km * 1000
      and (p_seller_id is null or s.id = p_seller_id)
  )
  select
    p.id, p.seller_id, e.shop_name, p.name, p.description, p.category_key,
    p.listing_mode, p.price, p.mrp, p.unit, p.stock, p.min_order_qty,
    p.images, p.veg_type, p.variants, p.rating, p.rating_count,
    e.business_open, e.eta_minutes, e.distance_km
  from public.products p
  join eligible e on e.id = p.seller_id
  where p.approval_status = 'approved'
    and p.public_visible
    and p.available
    and (p_mode is null or p.listing_mode = p_mode)
    and (p_category is null or p_category = '' or p.category_key = p_category)
    and (
      p_search is null
      or p_search = ''
      or p.search_tsv @@ plainto_tsquery('simple', p_search)
      or p.name ilike '%' || p_search || '%'
    )
  order by
    case when p_sort = 'price_asc'  then p.price end asc,
    case when p_sort = 'price_desc' then p.price end desc,
    case when p_sort = 'rating'     then p.rating end desc,
    case when p_sort = 'newest'     then p.created_at end desc,
    e.distance_km asc,
    p.rating desc
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
$$;

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
  -- A shop whose subscription has lapsed takes no new orders; orders already placed carry on.
  if not public.shop_can_trade(p_seller_id) then
    raise exception 'SELLER_NOT_ACCEPTING_ORDERS';
  end if;
  -- Closed (switched off, or outside its opening hours in India): browsing is fine, ordering is not.
  if not public.shop_is_open_now(p_seller_id) then
    raise exception 'SHOP_CLOSED';
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

  perform public.maybe_auto_accept(v_order);

  return v_order;
end;
$$;

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

    perform public.maybe_auto_accept(v_order.id);
  end if;

  return true;
end;
$$;

revoke execute on function public.mark_order_paid(text, text, integer) from public, anon, authenticated;
grant execute on function public.mark_order_paid(text, text, integer) to service_role;
grant execute on function public.nearby_sellers to anon, authenticated;
