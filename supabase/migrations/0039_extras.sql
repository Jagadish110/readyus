-- Localty 0039: extras, like Extra cheese or Cheese burst crust, priced by size.
--
--   * sellers.extras: the shop's list, set up once:
--       [{"id": "xcheese", "label": "Extra cheese & topping", "price": 35,
--         "size_prices": [{"size": "Small", "price": 35}, {"size": "Medium", "price": 50}, {"size": "Large", "price": 70}]}]
--     An extra costs its size_prices entry for the size the customer chose (matched by name, ignoring case),
--     otherwise its price.
--   * products.extra_ids: which of them a dish offers, so a pizza can offer Cheese burst and a Coke cannot.
--   * cart_items.extra_ids: what the customer added. The same pizza with and without extras is two lines.
--   * order_items.extras: what was added and what each cost, kept with the order.
--   * place_order prices every extra itself from the shop's list; nothing the browser sends sets a price.
--   * Fix: lines of one dish (Half and Full, or with and without extras) share its stock. place_order now
--     checks and takes their total; before, an UPDATE ... FROM took only one line's quantity.

-- ---------- The shop's extras ----------

create or replace function public.seller_extras_are_valid(p_extras jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_extras) = 'array'
    and jsonb_array_length(p_extras) <= 30
    and (select count(distinct x ->> 'id') = count(*) from jsonb_array_elements(p_extras) as x)
    and not exists (
      select 1
      from jsonb_array_elements(p_extras) as x
      where jsonb_typeof(x) is distinct from 'object'
         or coalesce(x ->> 'id', '') !~ '^[a-z0-9]{1,16}$'
         or char_length(btrim(coalesce(x ->> 'label', ''))) not between 1 and 40
         or jsonb_typeof(x -> 'price') is distinct from 'number'
         or (x ->> 'price')::numeric not between 0 and 100000
         or jsonb_typeof(coalesce(x -> 'size_prices', '[]'::jsonb)) is distinct from 'array'
         or jsonb_array_length(coalesce(x -> 'size_prices', '[]'::jsonb)) > 8
         or exists (
           select 1
           from jsonb_array_elements(coalesce(x -> 'size_prices', '[]'::jsonb)) as sp
           where jsonb_typeof(sp) is distinct from 'object'
              or char_length(btrim(coalesce(sp ->> 'size', ''))) not between 1 and 40
              or jsonb_typeof(sp -> 'price') is distinct from 'number'
              or (sp ->> 'price')::numeric not between 0 and 100000
         )
    );
$$;

alter table public.sellers add column if not exists extras jsonb not null default '[]'::jsonb;
alter table public.sellers drop constraint if exists sellers_extras_valid;
alter table public.sellers add constraint sellers_extras_valid check (public.seller_extras_are_valid(extras));
grant update (extras) on public.sellers to authenticated;

/** What one extra costs with a dish of this size: its price for that size, otherwise its own price. */
create or replace function public.extra_price(p_extra jsonb, p_size text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select (sp ->> 'price')::numeric
     from jsonb_array_elements(coalesce(p_extra -> 'size_prices', '[]'::jsonb)) as sp
     where lower(btrim(sp ->> 'size')) = lower(btrim(coalesce(p_size, '')))
     limit 1),
    (p_extra ->> 'price')::numeric
  );
$$;

-- ---------- Which extras a dish offers ----------

alter table public.products add column if not exists extra_ids text[] not null default '{}';
alter table public.products drop constraint if exists products_extra_ids_valid;
alter table public.products add constraint products_extra_ids_valid check (
  cardinality(extra_ids) <= 30 and array_to_string(extra_ids, ',') ~ '^([a-z0-9]{1,16}(,[a-z0-9]{1,16})*)?$'
);
grant insert (extra_ids), update (extra_ids) on public.products to authenticated;

-- ---------- What the customer added ----------

alter table public.cart_items add column if not exists extra_ids text[] not null default '{}';
alter table public.cart_items drop constraint if exists cart_items_user_id_product_id_variant_id_key;
alter table public.cart_items drop constraint if exists cart_items_line_key;
alter table public.cart_items add constraint cart_items_line_key unique (user_id, product_id, variant_id, extra_ids);

alter table public.order_items add column if not exists extras jsonb;

-- ---------- The catalogue returns each dish's extras ----------

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
  variant_name text, combo_items jsonb, extras jsonb
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
           round((st_distance(s.location, o.g) / 1000)::numeric, 2) as distance_km,
           s.extras as shop_extras
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
    p.variant_name, p.combo_items,
    -- The shop's extras this dish offers, in the shop's order.
    coalesce((
      select jsonb_agg(x order by ord)
      from jsonb_array_elements(e.shop_extras) with ordinality as t(x, ord)
      where x ->> 'id' = any (p.extra_ids)
    ), '[]'::jsonb) as extras
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

-- ---------- place_order prices extras ----------
-- As in 0038, except that each line is priced once in the loop (size, then extras for that size) and the
-- order_items rows are written from those prices.

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
  v_label    text;
  v_unit     integer;
  v_extra_id text;
  v_extra    jsonb;
  v_cost     integer;
  v_extras   jsonb;
  v_lines    jsonb := '[]'::jsonb;
  v_short    text;
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
    select ci.product_id, ci.variant_id, ci.extra_ids, ci.quantity, p.name, p.price, p.stock,
           p.min_order_qty, p.images, p.variants, p.extra_ids as offered_extras, p.combo_items,
           p.available, p.approval_status, p.public_visible
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
    v_label := '';

    if v_item.variant_id <> '' then
      select coalesce((value ->> 'price')::numeric, v_item.price),
             coalesce((value ->> 'stock')::integer, v_item.stock),
             coalesce(value ->> 'label', '')
        into v_price, v_stock, v_label
      from jsonb_array_elements(v_item.variants)
      where value ->> 'id' = v_item.variant_id
      limit 1;
      if not found then raise exception 'VARIANT_NOT_FOUND:%', v_item.name; end if;
    end if;

    if v_stock < v_item.quantity then
      raise exception 'INSUFFICIENT_STOCK:%', v_item.name;
    end if;

    -- Each extra must be one this dish offers and the shop still sells, and costs its price for this size.
    v_unit := round(v_price * 100)::integer;
    v_extras := '[]'::jsonb;
    foreach v_extra_id in array (select array(select distinct unnest(v_item.extra_ids))) loop
      if not (v_extra_id = any (v_item.offered_extras)) then
        raise exception 'EXTRA_NOT_FOUND:%', v_item.name;
      end if;
      select value into v_extra from jsonb_array_elements(v_seller.extras) where value ->> 'id' = v_extra_id limit 1;
      if not found then raise exception 'EXTRA_NOT_FOUND:%', v_item.name; end if;
      v_cost := round(public.extra_price(v_extra, v_label) * 100)::integer;
      v_unit := v_unit + v_cost;
      v_extras := v_extras || jsonb_build_object('label', v_extra ->> 'label', 'price_paise', v_cost);
    end loop;

    v_subtotal := v_subtotal + v_unit * v_item.quantity;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_item.product_id,
      'name', v_item.name,
      'variant_label', v_label,
      'image_url', v_item.images[1],
      'quantity', v_item.quantity,
      'unit_price_paise', v_unit,
      'combo_items', nullif(v_item.combo_items, '[]'::jsonb),
      'extras', nullif(v_extras, '[]'::jsonb)
    );
  end loop;

  if v_subtotal = 0 then raise exception 'CART_EMPTY'; end if;

  -- Lines of one dish share its stock, so their total must fit.
  select p.name into v_short
  from (select product_id, sum(quantity) as quantity
        from public.cart_items
        where user_id = v_user and seller_id = p_seller_id
        group by product_id) c
  join public.products p on p.id = c.product_id
  where p.stock < c.quantity
  limit 1;
  if found then raise exception 'INSUFFICIENT_STOCK:%', v_short; end if;

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

  insert into public.order_items (order_id, product_id, name, variant_label, image_url, quantity, unit_price_paise, line_total_paise, combo_items, extras)
  select v_order, l.product_id, l.name, l.variant_label, l.image_url, l.quantity, l.unit_price_paise,
         l.unit_price_paise * l.quantity, l.combo_items, l.extras
  from jsonb_to_recordset(v_lines) as l(
    product_id uuid, name text, variant_label text, image_url text, quantity integer,
    unit_price_paise integer, combo_items jsonb, extras jsonb
  );

  -- One update per dish with the total of its lines: UPDATE ... FROM uses only one joined row per target.
  update public.products p
     set stock = p.stock - c.quantity
    from (select product_id, sum(quantity)::integer as quantity
          from public.cart_items
          where user_id = v_user and seller_id = p_seller_id
          group by product_id) c
   where c.product_id = p.id;

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
