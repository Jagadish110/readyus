-- Localty 0038: combos, and variants that are not only sizes.
--
--   * products.combo_items: what a combo includes, like [{"name": "Pizza Mania", "qty": 1}, {"name": "Coke", "qty": 1}].
--     A product with items is a combo. It keeps its own price, and its variants still work, so
--     "Veg Combo Double" can offer a choice of pizza and "Pizza + Coke" can come Small and Medium.
--   * products.variant_name: what the variants are, shown as "Choose your <name>". Size by default
--     (Half / Full, S / M / L); Flavour or Pizza when they are choices rather than sizes.
--   * order_items.combo_items: a copy taken when the order is placed, so the kitchen sees what this
--     order included even if the shop changes the combo later.
--   * Combos, Pizza and Burgers join the food categories.

alter table public.products add column if not exists variant_name text not null default 'Size';
alter table public.products drop constraint if exists products_variant_name_length;
alter table public.products add constraint products_variant_name_length check (char_length(btrim(variant_name)) between 1 and 20);

alter table public.products add column if not exists combo_items jsonb not null default '[]'::jsonb;

-- A combo's contents, as the seller console writes them (see comboItemsField in seller-console.ts).
create or replace function public.combo_items_are_valid(p_items jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_items) = 'array'
    and jsonb_array_length(p_items) <= 12
    and not exists (
      select 1
      from jsonb_array_elements(p_items) as i
      where jsonb_typeof(i) is distinct from 'object'
         or char_length(btrim(coalesce(i ->> 'name', ''))) not between 1 and 60
         or jsonb_typeof(i -> 'qty') is distinct from 'number'
         or (i ->> 'qty')::numeric not between 1 and 20
         or (i ->> 'qty')::numeric <> trunc((i ->> 'qty')::numeric)
    );
$$;

alter table public.products drop constraint if exists products_combo_items_valid;
alter table public.products add constraint products_combo_items_valid check (public.combo_items_are_valid(combo_items));

-- Sellers write their products column by column (see the grants in 0011).
grant insert (variant_name, combo_items), update (variant_name, combo_items) on public.products to authenticated;

alter table public.order_items add column if not exists combo_items jsonb;

insert into public.categories (mode, key, name, sort) values
  ('food', 'combos',  'Combos',  14),
  ('food', 'pizza',   'Pizza',   15),
  ('food', 'burgers', 'Burgers', 16)
on conflict do nothing;

-- ---------- The catalogue returns the new columns ----------

drop function if exists public.nearby_products(double precision, double precision, numeric, listing_mode, text, text, text, uuid, integer, integer);

create function public.nearby_products(
  p_lat double precision,
  p_lng double precision,
  p_radius_km numeric default 5,
  p_mode listing_mode default null,
  p_category text default null,
  p_search text default null,
  p_sort text default 'distance',
  p_seller_id uuid default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table (
  id uuid, seller_id uuid, seller_name text, name text, description text, category_key text,
  listing_mode listing_mode, price numeric, mrp numeric, unit text, stock integer, min_order_qty smallint,
  images text[], veg_type text, variants jsonb, rating numeric, rating_count integer,
  business_open boolean, eta_minutes smallint, distance_km numeric,
  variant_name text, combo_items jsonb
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
    e.business_open, e.eta_minutes, e.distance_km,
    p.variant_name, p.combo_items
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

grant execute on function public.nearby_products(double precision, double precision, numeric, listing_mode, text, text, text, uuid, integer, integer)
  to anon, authenticated, service_role;

-- ---------- place_order keeps a copy of each combo's contents ----------
-- Unchanged from 0036 except the order_items insert, which now also writes combo_items.

create or replace function public.place_order(
  p_address_id uuid,
  p_seller_id uuid,
  p_pay_online boolean default false,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
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
  if not public.shop_can_trade(p_seller_id) then
    raise exception 'SELLER_NOT_ACCEPTING_ORDERS';
  end if;
  if not public.shop_is_open_now(p_seller_id) then
    raise exception 'SHOP_CLOSED';
  end if;
  if v_seller.location is null then raise exception 'SELLER_LOCATION_REQUIRED'; end if;

  if p_pay_online and not v_seller.prepaid_available then
    raise exception 'PREPAID_NOT_OFFERED';
  end if;
  if not p_pay_online and not v_seller.cod_available then
    raise exception 'COD_NOT_OFFERED';
  end if;

  v_distance := round((st_distance(v_seller.location, v_addr.location) / 1000)::numeric, 2);
  if v_distance > v_seller.service_radius_km then
    raise exception 'OUTSIDE_DELIVERY_RADIUS';
  end if;

  select * into v_settings from public.platform_settings where id;

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

  v_delivery := case
    when v_seller.free_delivery_above > 0 and v_subtotal >= round(v_seller.free_delivery_above * 100) then 0
    else round(coalesce(v_seller.delivery_fee, 0) * 100)::integer
  end;

  v_platform := 0;
  v_total := v_subtotal + v_delivery + v_platform;

  if p_pay_online then
    v_mode := 'full_prepaid';
    v_required := v_total;
  elsif v_seller.cod_prepayment_required and v_seller.cod_prepayment_amount > 0 then
    v_required := least(round(v_seller.cod_prepayment_amount * 100)::integer, v_total);
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

  insert into public.order_items (order_id, product_id, name, variant_label, image_url, quantity, unit_price_paise, line_total_paise, combo_items)
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
         ), p.price) * 100)::integer * ci.quantity,
         nullif(p.combo_items, '[]'::jsonb)
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
$function$;
