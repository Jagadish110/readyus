-- Localty 0045: shops can name their own menu categories ("Chef's Specials").
-- A dish's category_key is either a key from public.categories ("rice-biryani") or, now, a name the
-- shop typed, stored as typed. initcap() suits keys but mangles typed names ("BBQ Wings" -> "Bbq Wings"),
-- so only keys are reworded; a typed name is shown exactly as the shop wrote it. Safe to re-run.

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
      and public.shop_can_trade(s.id)
      and s.location is not null
      and st_dwithin(s.location, o.g, p_radius_km * 1000)
      and st_distance(s.location, o.g) <= s.service_radius_km * 1000
  )
  select p.category_key,
         coalesce(
           max(c.name),
           case when p.category_key ~ '^[a-z0-9_-]+$'
                then initcap(translate(p.category_key, '-_', '  '))
                else p.category_key
           end
         ) as name,
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
