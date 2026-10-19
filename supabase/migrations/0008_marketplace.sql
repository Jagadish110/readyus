-- ReadyUs 0008: radius discovery.
--
-- The rule that defines the product: a shop is visible only when the customer
-- is inside the shop's own delivery radius AND the shop is inside the radius
-- the customer chose. Both directions must hold; there is no wider fallback.

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
    s.rating, s.rating_count, s.business_open, s.eta_minutes,
    s.min_order_amount, s.delivery_fee, s.free_delivery_above, s.cod_available,
    round((st_distance(s.location, o.g) / 1000)::numeric, 2) as distance_km
  from public.sellers s
  cross join origin o
  where s.status = 'approved'
    and s.public_visible
    and s.location is not null
    -- Shop inside the customer's chosen radius.
    and st_dwithin(s.location, o.g, p_radius_km * 1000)
    -- Customer inside the shop's own delivery radius.
    and st_distance(s.location, o.g) <= s.service_radius_km * 1000
    and (p_mode is null or s.listing_mode = p_mode)
    and (not p_open_only or s.business_open)
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
    select s.id, s.shop_name, s.business_open, s.eta_minutes,
           round((st_distance(s.location, o.g) / 1000)::numeric, 2) as distance_km
    from public.sellers s
    cross join origin o
    where s.status = 'approved'
      and s.public_visible
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

-- Category facets for the radius the customer is actually shopping in.
create or replace function public.nearby_categories(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_km numeric default 5,
  p_mode      listing_mode default null
)
returns table (category_key text, name text, product_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with origin as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  ),
  eligible as (
    select s.id
    from public.sellers s
    cross join origin o
    where s.status = 'approved'
      and s.public_visible
      and s.location is not null
      and st_dwithin(s.location, o.g, p_radius_km * 1000)
      and st_distance(s.location, o.g) <= s.service_radius_km * 1000
  )
  select p.category_key,
         coalesce(max(c.name), initcap(p.category_key)) as name,
         count(*) as product_count
  from public.products p
  join eligible e on e.id = p.seller_id
  left join public.categories c
    on c.key = p.category_key and c.mode = p.listing_mode
  where p.approval_status = 'approved'
    and p.public_visible
    and p.available
    and p.category_key <> ''
    and (p_mode is null or p.listing_mode = p_mode)
  group by p.category_key
  order by product_count desc;
$$;

grant execute on function public.nearby_sellers to anon, authenticated;
grant execute on function public.nearby_products to anon, authenticated;
grant execute on function public.nearby_categories to anon, authenticated;
