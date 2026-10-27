-- Localty 0028: shop compliance documents (FSSAI, GST) and the rules that depend on them.
--
--   * A food shop must have an FSSAI licence or registration on file, reviewed by an admin, before
--     the admin can approve the shop. The licence number is shown to customers on the shop page.
--   * A licence has an expiry date. An expired (or rejected) licence takes a food shop off the
--     marketplace and stops new orders until it is renewed; orders already placed carry on.
--   * Shops that were already live get 30 days to add their licence, so nobody disappears on deploy.
--   * GST is optional on our side: shops that have a GSTIN may add it for review.
--
-- Files live in a private bucket that only the server can read. The shop and the admin see
-- them through short-lived links the backend creates after checking who is asking.

alter table public.sellers
  add column if not exists documents_due_at timestamptz;

alter table public.platform_settings
  add column if not exists compliance_enforced boolean not null default true;

-- ---------- Documents ----------

create table public.seller_documents (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.sellers(id) on delete cascade,
  kind        text not null check (kind in ('fssai', 'gst')),
  -- FSSAI: 14 digits. GST: the 15-character GSTIN.
  number      text not null,
  valid_until date,
  -- Path inside the private 'seller-documents' bucket, always under the shop's own folder.
  file_path   text not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (seller_id, kind),
  constraint seller_documents_fssai_format check (kind <> 'fssai' or number ~ '^[0-9]{14}$'),
  constraint seller_documents_gst_format
    check (kind <> 'gst' or number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  constraint seller_documents_fssai_expiry check (kind <> 'fssai' or valid_until is not null)
);

create index seller_documents_review_idx on public.seller_documents (status, created_at);

create trigger seller_documents_touch
  before update on public.seller_documents
  for each row execute function public.touch_updated_at();

alter table public.seller_documents enable row level security;
revoke all on public.seller_documents from anon, authenticated;
-- No policies: the tables are reached only through the functions below.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seller-documents', 'seller-documents', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Shops already live get time to add their licence.
update public.sellers
   set documents_due_at = now() + interval '30 days'
 where status = 'approved' and listing_mode = 'food' and documents_due_at is null;

-- ---------- Rules ----------

create or replace function public.shop_needs_fssai(p_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select listing_mode = 'food' from public.sellers where id = p_seller), false);
$$;

create or replace function public.has_valid_fssai(p_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.seller_documents d
    where d.seller_id = p_seller and d.kind = 'fssai' and d.status = 'approved'
      and d.valid_until >= current_date
  );
$$;

create or replace function public.shop_is_compliant(p_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    not (select compliance_enforced from public.platform_settings where id)
    or not public.shop_needs_fssai(p_seller)
    or public.has_valid_fssai(p_seller)
    -- Shops that were live before this rule existed, until their deadline.
    or coalesce((select documents_due_at > now() from public.sellers where id = p_seller), false),
    false
  );
$$;

-- Everything that decides whether customers may see and order from a shop.
create or replace function public.shop_can_trade(p_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.shop_is_billable(p_seller) and public.shop_is_compliant(p_seller);
$$;

revoke execute on function public.shop_needs_fssai(uuid), public.has_valid_fssai(uuid),
  public.shop_is_compliant(uuid), public.shop_can_trade(uuid) from public;
grant execute on function public.shop_needs_fssai(uuid), public.has_valid_fssai(uuid),
  public.shop_is_compliant(uuid), public.shop_can_trade(uuid) to anon, authenticated, service_role;

-- ---------- The owner's side ----------

create or replace function public.submit_seller_document(
  p_kind text,
  p_number text,
  p_valid_until date,
  p_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := public.current_seller_id();
  v_name text;
  v_admin uuid;
begin
  if v_seller is null then raise exception 'SELLER_PROFILE_REQUIRED'; end if;
  if p_kind not in ('fssai', 'gst') then raise exception 'UNKNOWN_DOCUMENT'; end if;
  -- The file must be one this shop uploaded into its own folder.
  if p_path is null or p_path not like v_seller::text || '/%' then raise exception 'INVALID_FILE'; end if;
  if p_kind = 'fssai' and (p_valid_until is null or p_valid_until < current_date) then
    raise exception 'DOCUMENT_EXPIRED';
  end if;

  insert into public.seller_documents (seller_id, kind, number, valid_until, file_path)
  values (v_seller, p_kind, upper(trim(p_number)), case when p_kind = 'fssai' then p_valid_until end, p_path)
  on conflict (seller_id, kind) do update
    set number = excluded.number, valid_until = excluded.valid_until, file_path = excluded.file_path,
        -- A changed document must be looked at again.
        status = 'pending', review_note = '', reviewed_by = null, reviewed_at = null;

  insert into public.audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), 'seller.document_submitted', 'seller', v_seller::text, jsonb_build_object('kind', p_kind));

  select shop_name into v_name from public.sellers where id = v_seller;
  for v_admin in select user_id from public.user_roles where role = 'admin' loop
    perform public.notify(v_admin, 'admin', 'approval', 'Document to review',
      coalesce(v_name, 'A shop') || ' sent its ' || upper(p_kind) || ' document.',
      '/admin/approvals', 'doc-submitted:' || v_seller::text || ':' || p_kind || ':' || clock_timestamp()::text);
  end loop;
end;
$$;

-- The owner's own documents, without the file path.
create or replace function public.my_seller_documents()
returns table (kind text, number text, valid_until date, status text, review_note text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.kind, d.number, d.valid_until, d.status, d.review_note, d.updated_at
  from public.seller_documents d
  where d.seller_id = public.current_seller_id()
  order by d.kind;
$$;

-- ---------- The admin's side ----------

create or replace function public.admin_seller_documents(p_seller uuid)
returns table (kind text, number text, valid_until date, file_path text, status text, review_note text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return query
    select d.kind, d.number, d.valid_until, d.file_path, d.status, d.review_note, d.updated_at
    from public.seller_documents d where d.seller_id = p_seller order by d.kind;
end;
$$;

-- Shops that are already live and have a document waiting (a renewal, or a late first upload).
-- Shops still waiting for approval are reviewed with their application instead.
create or replace function public.admin_pending_documents()
returns table (seller_id uuid, shop_name text, listing_mode text, kinds text[], waiting_since timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return query
    select s.id, s.shop_name, s.listing_mode::text, array_agg(d.kind order by d.kind), min(d.updated_at)
    from public.seller_documents d join public.sellers s on s.id = d.seller_id
    where d.status = 'pending' and s.status = 'approved'
    group by s.id, s.shop_name, s.listing_mode
    order by min(d.updated_at);
end;
$$;

create or replace function public.review_seller_document(
  p_seller uuid,
  p_kind text,
  p_approve boolean,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;

  update public.seller_documents
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_note = coalesce(p_note, ''),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where seller_id = p_seller and kind = p_kind;
  if not found then raise exception 'DOCUMENT_NOT_FOUND'; end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), case when p_approve then 'seller.document_approved' else 'seller.document_rejected' end,
          'seller', p_seller::text, jsonb_build_object('kind', p_kind, 'note', p_note));

  select user_id into v_user from public.sellers where id = p_seller;
  perform public.notify(v_user, 'seller', 'approval',
    case when p_approve then upper(p_kind) || ' document approved' else upper(p_kind) || ' document needs a fix' end,
    coalesce(nullif(p_note, ''), case when p_approve then 'Thank you. This document is verified.' else 'Please upload a clearer or correct document.' end),
    '/business/documents', 'doc-review:' || p_seller::text || ':' || p_kind || ':' || clock_timestamp()::text);
end;
$$;

-- ---------- What customers see ----------

create or replace function public.seller_licences(p_ids uuid[])
returns table (seller_id uuid, fssai_number text)
language sql
stable
security definer
set search_path = public
as $$
  select d.seller_id, d.number
  from public.seller_documents d
  join public.sellers s on s.id = d.seller_id and s.status = 'approved' and s.public_visible
  where d.seller_id = any(p_ids) and d.kind = 'fssai' and d.status = 'approved' and d.valid_until >= current_date;
$$;

-- ---------- Reminders ----------

-- One in-app notice per milestone (the dedupe key makes a repeat run harmless).
create or replace function public.compliance_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_days integer;
  v_bucket integer;
  v_count integer := 0;
begin
  -- Licences that are about to expire, or have.
  for v_row in
    select d.seller_id, d.valid_until, s.user_id
    from public.seller_documents d join public.sellers s on s.id = d.seller_id
    where d.kind = 'fssai' and d.status = 'approved' and s.status = 'approved'
      and d.valid_until <= current_date + 30
  loop
    v_days := v_row.valid_until - current_date;
    if v_days < 0 then
      perform public.notify(v_row.user_id, 'seller', 'approval', 'Your FSSAI licence has expired',
        'Customers cannot order from your shop until you upload the renewed licence.', '/business/documents',
        'fssai-expired:' || v_row.seller_id || ':' || v_row.valid_until);
    else
      v_bucket := case when v_days <= 1 then 1 when v_days <= 7 then 7 else 30 end;
      perform public.notify(v_row.user_id, 'seller', 'approval', 'Your FSSAI licence expires soon',
        'It is valid until ' || to_char(v_row.valid_until, 'DD Mon YYYY') || '. Upload the renewal to stay visible.',
        '/business/documents', 'fssai-expiring:' || v_row.seller_id || ':' || v_row.valid_until || ':' || v_bucket);
    end if;
    v_count := v_count + 1;
  end loop;

  -- Shops that were live before the rule and still have no valid licence.
  for v_row in
    select s.id as seller_id, s.user_id, s.documents_due_at
    from public.sellers s
    where s.status = 'approved' and s.listing_mode = 'food' and s.documents_due_at is not null
      and not public.has_valid_fssai(s.id)
  loop
    v_days := ceil(extract(epoch from (v_row.documents_due_at - now())) / 86400);
    if v_days <= 0 then
      perform public.notify(v_row.user_id, 'seller', 'approval', 'Your shop is hidden: FSSAI licence needed',
        'Food shops must show a valid FSSAI licence. Upload it and your shop returns after review.', '/business/documents',
        'fssai-overdue:' || v_row.seller_id);
    else
      v_bucket := case when v_days <= 3 then 3 when v_days <= 14 then 14 else 30 end;
      perform public.notify(v_row.user_id, 'seller', 'approval', 'Add your FSSAI licence',
        'Food shops must show a valid FSSAI licence. Upload it within ' || v_days || ' days to stay visible.', '/business/documents',
        'fssai-due:' || v_row.seller_id || ':' || v_bucket);
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.submit_seller_document(text, text, date, text) from public, anon;
revoke execute on function public.my_seller_documents() from public, anon;
revoke execute on function public.admin_seller_documents(uuid) from public, anon;
revoke execute on function public.admin_pending_documents() from public, anon;
grant execute on function public.admin_pending_documents() to authenticated;
revoke execute on function public.review_seller_document(uuid, text, boolean, text) from public, anon;
revoke execute on function public.compliance_reminders() from public, anon, authenticated;
grant execute on function public.submit_seller_document(text, text, date, text) to authenticated;
grant execute on function public.my_seller_documents() to authenticated;
grant execute on function public.admin_seller_documents(uuid) to authenticated;
grant execute on function public.review_seller_document(uuid, text, boolean, text) to authenticated;
grant execute on function public.compliance_reminders() to service_role;
grant execute on function public.seller_licences(uuid[]) to anon, authenticated, service_role;

-- ---------- Gating ----------
-- The four functions below are unchanged from migration 0026 except that "the shop is billable"
-- became "the shop can trade" (billable and compliant). review_seller is unchanged from 0010
-- except for the FSSAI check at the top.

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

  -- A food shop cannot go live without a reviewed, unexpired FSSAI licence.
  if p_approve
     and public.shop_needs_fssai(p_seller)
     and (select compliance_enforced from public.platform_settings where id)
     and not public.has_valid_fssai(p_seller) then
    raise exception 'FSSAI_REQUIRED';
  end if;

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
