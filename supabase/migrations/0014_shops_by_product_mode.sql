-- ReadyUs 0014: a shop that sells items of a mode appears under that mode.

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
