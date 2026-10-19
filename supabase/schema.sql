-- ReadyUs full schema: migrations 0001-0011 in order.
-- Generated; paste into the Supabase SQL editor and run once on an empty project.
-- Source of truth stays in supabase/migrations/.

-- ===== 0001_foundation.sql =====
-- ReadyUs 0001: extensions, enums, helper functions.

-- SQL functions below read tables created by later migrations (sellers,
-- user_roles, delivery_agents). Postgres validates SQL bodies at creation, so
-- validation is switched off for this script; every body is checked at call time.
set check_function_bodies = off;

create extension if not exists "pgcrypto";
create extension if not exists "postgis";
create extension if not exists "pg_trgm";

-- ---------- Enums ----------

create type app_role as enum ('customer', 'seller', 'delivery', 'admin');

create type listing_mode as enum ('food', 'items');

create type approval_status as enum ('pending', 'approved', 'rejected');

create type account_status as enum ('active', 'suspended', 'disabled');

-- Mirrors the full order lifecycle: placement, seller decision, preparation,
-- delivery hand-off, and every terminal state.
create type order_status as enum (
  'pending',
  'payment_required',
  'customer_claimed_paid',
  'payment_confirmed',
  'payment_rejected',
  'accepted',
  'preparing',
  'packed',
  'assigned',
  'out_for_delivery',
  'delivered',
  'rejected',
  'cancelled_by_customer',
  'cancelled',
  'timed_out'
);

-- Business mode of an order. Fixed at checkout and never re-read from seller
-- settings afterwards.
create type payment_mode as enum ('full_prepaid', 'normal_cod', 'cod_partial_prepayment');

create type payment_provider as enum ('manual_upi', 'razorpay', 'other');

create type payment_kind as enum ('full_online', 'cod_prepayment', 'cod_cash', 'refund');

create type delivery_status as enum ('claimed', 'picked_up', 'delivered', 'cancelled');

create type notification_channel as enum ('order', 'approval', 'payment', 'delivery', 'system');

-- ---------- Helper functions ----------

-- Roles are read from user_roles rather than the JWT so that a revoked role
-- takes effect immediately instead of at the next token refresh.
create or replace function public.has_role(target_role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = target_role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin'::app_role);
$$;

-- The seller row owned by the current user, if any.
create or replace function public.current_seller_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.sellers where user_id = auth.uid() limit 1;
$$;

create or replace function public.current_agent_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.delivery_agents where user_id = auth.uid() limit 1;
$$;

-- Keeps updated_at honest without relying on the client.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ===== 0002_identity.sql =====
-- ReadyUs 0002: identity, roles and saved addresses.
-- One verified identity may hold the customer, seller and delivery roles at
-- once; admin is granted only by another admin or by seeding.

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default '',
  phone         text,
  email         text,
  avatar_url    text,
  status        account_status not null default 'active',
  -- Customers pick a delivery radius; everything they browse respects it.
  search_radius_km smallint not null default 5
    check (search_radius_km in (1, 3, 5, 10)),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index profiles_phone_idx on public.profiles (phone) where phone is not null;
create index profiles_email_idx on public.profiles (lower(email)) where email is not null;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create table public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create index user_roles_role_idx on public.user_roles (role);

-- Every authenticated identity becomes a profile with the customer role.
-- Seller and delivery roles are added when those applications are submitted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.phone,
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  label       text not null default 'Home',
  recipient   text not null default '',
  phone       text not null default '',
  line1       text not null,
  line2       text not null default '',
  landmark    text not null default '',
  city        text not null default '',
  pincode     text not null default '',
  location    geography(point, 4326) not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index addresses_user_idx on public.addresses (user_id);
create index addresses_location_idx on public.addresses using gist (location);
-- At most one default address per customer.
create unique index addresses_one_default_idx
  on public.addresses (user_id) where is_default;

create trigger addresses_touch
  before update on public.addresses
  for each row execute function public.touch_updated_at();


-- ===== 0003_catalog.sql =====
-- ReadyUs 0003: categories, sellers and products.

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  mode       listing_mode not null,
  key        text not null,
  name       text not null,
  "group"    text not null default '',
  image_url  text,
  enabled    boolean not null default true,
  visible    boolean not null default true,
  sort       smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (mode, key)
);

create index categories_listing_idx on public.categories (enabled, visible, mode, sort);

create table public.sellers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references public.profiles(id) on delete cascade,
  shop_name     text not null,
  owner_name    text not null default '',
  phone         text not null default '',
  category      text not null default '',
  listing_mode  listing_mode not null default 'food',
  description   text not null default '',

  address       text not null default '',
  city          text not null default '',
  pincode       text not null default '',
  -- Absent until the seller saves a real pin. The marketplace never guesses.
  location      geography(point, 4326),
  service_radius_km numeric(5,2) not null default 5
    check (service_radius_km > 0 and service_radius_km <= 50),

  open_time     text not null default '09:00',
  close_time    text not null default '22:00',
  business_open boolean not null default false,
  auto_accept   boolean not null default false,
  eta_minutes   smallint not null default 30,

  status          approval_status not null default 'pending',
  public_visible  boolean not null default false,
  review_note     text not null default '',
  reviewed_by     uuid references public.profiles(id),
  reviewed_at     timestamptz,

  min_order_amount      numeric(10,2) not null default 0,
  delivery_fee          numeric(10,2) not null default 0,
  free_delivery_above   numeric(10,2) not null default 0,

  cod_available             boolean not null default true,
  cod_prepayment_required   boolean not null default false,
  cod_prepayment_amount     numeric(10,2) not null default 0,
  upi_id                    text not null default '',
  upi_qr_url                text,

  photo_url     text,
  banner_url    text,
  rating        numeric(2,1) not null default 0,
  rating_count  integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Discovery always filters on approval + visibility before distance, so the
-- geo index carries those columns.
create index sellers_location_idx on public.sellers using gist (location);
create index sellers_discovery_idx
  on public.sellers (status, public_visible, listing_mode)
  where status = 'approved' and public_visible;
create index sellers_pending_idx on public.sellers (status, created_at desc);

create trigger sellers_touch
  before update on public.sellers
  for each row execute function public.touch_updated_at();

create table public.products (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references public.sellers(id) on delete cascade,
  name           text not null,
  description    text not null default '',
  category_key   text not null default '',
  listing_mode   listing_mode not null default 'food',

  price          numeric(10,2) not null check (price >= 0),
  mrp            numeric(10,2) check (mrp is null or mrp >= price),
  unit           text not null default '',
  stock          integer not null default 0 check (stock >= 0),
  min_order_qty  smallint not null default 1 check (min_order_qty >= 1),

  images         text[] not null default '{}',
  veg_type       text not null default '' check (veg_type in ('', 'veg', 'non_veg', 'egg', 'vegan', 'jain')),
  spice_level    text not null default '',
  prep_minutes   smallint,
  tags           text[] not null default '{}',
  -- [{ id, label, price, mrp, stock }]
  variants       jsonb not null default '[]'::jsonb,

  available       boolean not null default true,
  public_visible  boolean not null default true,
  approval_status approval_status not null default 'pending',
  review_note     text not null default '',

  rating        numeric(2,1) not null default 0,
  rating_count  integer not null default 0,

  search_tsv tsvector generated always as (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category_key, ''))
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_seller_idx on public.products (seller_id, created_at desc);
create index products_search_idx on public.products using gin (search_tsv);
create index products_name_trgm_idx on public.products using gin (name gin_trgm_ops);
create index products_live_idx
  on public.products (seller_id, listing_mode, category_key, price)
  where approval_status = 'approved' and public_visible and available;

create trigger products_touch
  before update on public.products
  for each row execute function public.touch_updated_at();


-- ===== 0004_commerce.sql =====
-- ReadyUs 0004: cart, orders and payment evidence.
-- Money is stored in paise (integer) on orders and payments so no arithmetic
-- ever depends on floating point.

create table public.cart_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  seller_id     uuid not null references public.sellers(id) on delete cascade,
  variant_id    text not null default '',
  quantity      integer not null check (quantity > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One line per product+variant per customer.
  unique (user_id, product_id, variant_id)
);

create index cart_items_user_idx on public.cart_items (user_id, seller_id);

create trigger cart_items_touch
  before update on public.cart_items
  for each row execute function public.touch_updated_at();

create sequence public.order_code_seq start 1000;

create table public.orders (
  id          uuid primary key default gen_random_uuid(),
  order_code  text not null unique default ('RU' || lpad(nextval('public.order_code_seq')::text, 7, '0')),

  customer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id   uuid not null references public.sellers(id) on delete restrict,

  status      order_status not null default 'pending',

  -- Immutable payment requirement captured at checkout.
  payment_mode     payment_mode not null,
  payment_provider payment_provider not null default 'manual_upi',
  cod_available_at_checkout boolean not null default true,

  subtotal_paise       integer not null check (subtotal_paise >= 0),
  delivery_fee_paise   integer not null default 0 check (delivery_fee_paise >= 0),
  platform_fee_paise   integer not null default 0 check (platform_fee_paise >= 0),
  total_paise          integer not null check (total_paise >= 0),
  required_online_paise integer not null default 0 check (required_online_paise >= 0),

  -- Only ever written by the server after real evidence.
  verified_prepaid_paise integer not null default 0 check (verified_prepaid_paise >= 0),
  cash_collected_paise   integer not null default 0 check (cash_collected_paise >= 0),
  refunded_paise         integer not null default 0 check (refunded_paise >= 0),

  delivery_address jsonb not null,
  delivery_location geography(point, 4326) not null,
  distance_km      numeric(6,2),
  customer_note    text not null default '',

  -- Six digits the customer reads out; delivery completion requires it.
  delivery_code    text not null default lpad((floor(random() * 1000000))::int::text, 6, '0'),

  accept_deadline_at timestamptz,
  accepted_at        timestamptz,
  packed_at          timestamptz,
  delivered_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The money identity the whole system depends on.
  constraint orders_money_balance
    check (verified_prepaid_paise + cash_collected_paise <= total_paise)
);

create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_seller_idx on public.orders (seller_id, status, created_at desc);
create index orders_open_idx on public.orders (status, accept_deadline_at)
  where status in ('pending', 'payment_confirmed', 'accepted');

create trigger orders_touch
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- Line items are snapshots: renaming or repricing a product never rewrites history.
create table public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,
  name           text not null,
  variant_label  text not null default '',
  image_url      text,
  quantity       integer not null check (quantity > 0),
  unit_price_paise integer not null check (unit_price_paise >= 0),
  line_total_paise integer not null check (line_total_paise >= 0)
);

create index order_items_order_idx on public.order_items (order_id);

create table public.order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  status     order_status not null,
  actor_id   uuid references public.profiles(id) on delete set null,
  actor_role app_role,
  note       text not null default '',
  created_at timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, created_at);

-- Evidence of money moving, recorded separately from the order.
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  kind         payment_kind not null,
  provider     payment_provider not null default 'manual_upi',
  amount_paise integer not null check (amount_paise > 0),
  reference    text not null default '',
  claimed_at   timestamptz,
  verified_by  uuid references public.profiles(id),
  verified_at  timestamptz,
  -- Makes every money write replay-safe.
  idempotency_key text not null unique,
  created_at   timestamptz not null default now()
);

create index payments_order_idx on public.payments (order_id, kind);


-- ===== 0005_delivery.sql =====
-- ReadyUs 0005: delivery partners, seller fleets and assignments.

create table public.delivery_agents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references public.profiles(id) on delete cascade,
  full_name  text not null default '',
  phone      text not null default '',
  vehicle    text not null default '',
  -- Partners are eligible only after a seller accepts them into a fleet.
  status     approval_status not null default 'pending',
  available  boolean not null default false,
  location   geography(point, 4326),
  location_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index delivery_agents_location_idx on public.delivery_agents using gist (location);
create index delivery_agents_available_idx on public.delivery_agents (available) where available;

create trigger delivery_agents_touch
  before update on public.delivery_agents
  for each row execute function public.touch_updated_at();

-- A seller's private fleet. A partner may belong to several sellers.
create table public.delivery_relationships (
  id         uuid primary key default gen_random_uuid(),
  seller_id  uuid not null references public.sellers(id) on delete cascade,
  agent_id   uuid not null references public.delivery_agents(id) on delete cascade,
  active     boolean not null default true,
  linked_at  timestamptz not null default now(),
  removed_at timestamptz,
  unique (seller_id, agent_id)
);

create index delivery_relationships_agent_idx on public.delivery_relationships (agent_id, active);

-- Short codes a seller hands out to onboard a partner.
create table public.delivery_invites (
  id         uuid primary key default gen_random_uuid(),
  seller_id  uuid not null references public.sellers(id) on delete cascade,
  code       text not null unique,
  expires_at timestamptz not null,
  used_by    uuid references public.delivery_agents(id) on delete set null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index delivery_invites_open_idx on public.delivery_invites (code) where used_at is null;

create table public.delivery_assignments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null unique references public.orders(id) on delete cascade,
  agent_id     uuid not null references public.delivery_agents(id) on delete restrict,
  seller_id    uuid not null references public.sellers(id) on delete restrict,
  status       delivery_status not null default 'claimed',
  claimed_at   timestamptz not null default now(),
  picked_up_at timestamptz,
  delivered_at timestamptz,
  -- Cash the partner must collect at the door, derived on the server.
  cash_due_paise integer not null default 0 check (cash_due_paise >= 0)
);

create index delivery_assignments_agent_idx on public.delivery_assignments (agent_id, status);


-- ===== 0006_engagement.sql =====
-- ReadyUs 0006: reviews, favourites and notifications.

create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles(id) on delete cascade,
  order_id   uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  seller_id  uuid not null references public.sellers(id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  body       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One review per product per order; a seller review uses a null product.
  unique (order_id, product_id)
);

create index reviews_product_idx on public.reviews (product_id, created_at desc);
create index reviews_seller_idx on public.reviews (seller_id, created_at desc);

create trigger reviews_touch
  before update on public.reviews
  for each row execute function public.touch_updated_at();

create table public.favourite_products (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table public.favourite_sellers (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  seller_id  uuid not null references public.sellers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, seller_id)
);

-- The inbox is the database, not browser storage, so it survives reinstalls
-- and is identical on every device.
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       app_role not null,
  channel    notification_channel not null default 'system',
  title      text not null,
  body       text not null default '',
  href       text,
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  -- Deterministic per event so a retry never duplicates a notification.
  dedupe_key text unique
);

create index notifications_inbox_idx on public.notifications (user_id, role, created_at desc);
create index notifications_unread_idx on public.notifications (user_id, role) where read_at is null;

create table public.notification_devices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  token      text not null unique,
  platform   text not null default 'web',
  created_at timestamptz not null default now()
);

create index notification_devices_user_idx on public.notification_devices (user_id);


-- ===== 0007_platform.sql =====
-- ReadyUs 0007: platform settings and the admin audit trail.

create table public.platform_settings (
  id                  boolean primary key default true check (id),
  platform_fee_paise  integer not null default 0 check (platform_fee_paise >= 0),
  currency_code       text not null default 'INR',
  currency_symbol     text not null default '₹',
  tax_rate            numeric(5,2) not null default 0,
  order_accept_window_seconds integer not null default 300,
  updated_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now()
);

insert into public.platform_settings (id) values (true) on conflict do nothing;

create table public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text not null default '',
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_recent_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);

-- Uploaded media ledger. Storage objects are owner-scoped by path.
create table public.upload_assets (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  bucket     text not null,
  path       text not null,
  scope      text not null,
  bytes      integer not null default 0,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

create index upload_assets_owner_idx on public.upload_assets (owner_id, scope);


-- ===== 0008_marketplace.sql =====
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


-- ===== 0009_rls.sql =====
-- ReadyUs 0009: row level security.
-- In the single-app architecture, RLS is what keeps roles apart. The browser
-- is never trusted; every rule below is evaluated in the database.

alter table public.profiles              enable row level security;
alter table public.user_roles            enable row level security;
alter table public.addresses             enable row level security;
alter table public.categories            enable row level security;
alter table public.sellers               enable row level security;
alter table public.products              enable row level security;
alter table public.cart_items            enable row level security;
alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;
alter table public.order_events          enable row level security;
alter table public.payments              enable row level security;
alter table public.delivery_agents       enable row level security;
alter table public.delivery_relationships enable row level security;
alter table public.delivery_invites      enable row level security;
alter table public.delivery_assignments  enable row level security;
alter table public.reviews               enable row level security;
alter table public.favourite_products    enable row level security;
alter table public.favourite_sellers     enable row level security;
alter table public.notifications         enable row level security;
alter table public.notification_devices  enable row level security;
alter table public.platform_settings     enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.upload_assets         enable row level security;

-- ---------- Profiles and roles ----------

create policy profiles_self_read on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy profiles_self_write on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_admin_write on public.profiles
  for update using (public.is_admin());

create policy user_roles_self_read on public.user_roles
  for select using (user_id = auth.uid() or public.is_admin());

-- Roles are never granted from the browser. Seller and delivery roles are
-- added by security-definer functions; admin is granted by an admin only.
create policy user_roles_admin_write on public.user_roles
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Addresses ----------

create policy addresses_owner_all on public.addresses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Categories ----------

create policy categories_public_read on public.categories
  for select using (enabled and visible or public.is_admin());

create policy categories_admin_write on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Sellers ----------

-- Approved shops are public. A seller always sees their own row, approved or not.
create policy sellers_public_read on public.sellers
  for select using (
    (status = 'approved' and public_visible)
    or user_id = auth.uid()
    or public.is_admin()
  );

create policy sellers_self_insert on public.sellers
  for insert with check (user_id = auth.uid());

create policy sellers_self_update on public.sellers
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy sellers_admin_write on public.sellers
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Products ----------

create policy products_public_read on public.products
  for select using (
    (approval_status = 'approved' and public_visible and available)
    or seller_id = public.current_seller_id()
    or public.is_admin()
  );

create policy products_seller_write on public.products
  for all
  using (seller_id = public.current_seller_id())
  with check (seller_id = public.current_seller_id());

create policy products_admin_write on public.products
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Cart ----------

create policy cart_owner_all on public.cart_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Orders ----------

-- Each party sees only the orders they are part of.
create policy orders_participant_read on public.orders
  for select using (
    customer_id = auth.uid()
    or seller_id = public.current_seller_id()
    or exists (
      select 1 from public.delivery_assignments da
      where da.order_id = orders.id and da.agent_id = public.current_agent_id()
    )
    or public.is_admin()
  );

-- Orders are created through place_order(), never by direct insert.
create policy orders_admin_write on public.orders
  for all using (public.is_admin()) with check (public.is_admin());

create policy order_items_participant_read on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          o.customer_id = auth.uid()
          or o.seller_id = public.current_seller_id()
          or exists (
            select 1 from public.delivery_assignments da
            where da.order_id = o.id and da.agent_id = public.current_agent_id()
          )
          or public.is_admin()
        )
    )
  );

create policy order_events_participant_read on public.order_events
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_events.order_id
        and (
          o.customer_id = auth.uid()
          or o.seller_id = public.current_seller_id()
          or public.is_admin()
        )
    )
  );

create policy payments_participant_read on public.payments
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = payments.order_id
        and (o.customer_id = auth.uid() or o.seller_id = public.current_seller_id() or public.is_admin())
    )
  );

-- ---------- Delivery ----------

create policy delivery_agents_self_read on public.delivery_agents
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    -- A seller can see the partners in their own fleet.
    or exists (
      select 1 from public.delivery_relationships dr
      where dr.agent_id = delivery_agents.id
        and dr.seller_id = public.current_seller_id()
        and dr.active
    )
  );

create policy delivery_agents_self_insert on public.delivery_agents
  for insert with check (user_id = auth.uid());

create policy delivery_agents_self_update on public.delivery_agents
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy delivery_agents_admin_write on public.delivery_agents
  for all using (public.is_admin()) with check (public.is_admin());

create policy delivery_relationships_read on public.delivery_relationships
  for select using (
    seller_id = public.current_seller_id()
    or agent_id = public.current_agent_id()
    or public.is_admin()
  );

create policy delivery_relationships_seller_write on public.delivery_relationships
  for all
  using (seller_id = public.current_seller_id() or public.is_admin())
  with check (seller_id = public.current_seller_id() or public.is_admin());

create policy delivery_invites_seller_all on public.delivery_invites
  for all
  using (seller_id = public.current_seller_id() or public.is_admin())
  with check (seller_id = public.current_seller_id() or public.is_admin());

create policy delivery_assignments_read on public.delivery_assignments
  for select using (
    agent_id = public.current_agent_id()
    or seller_id = public.current_seller_id()
    or public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = delivery_assignments.order_id and o.customer_id = auth.uid()
    )
  );

-- ---------- Reviews ----------

create policy reviews_public_read on public.reviews
  for select using (true);

-- A review requires a delivered order that belongs to the author.
create policy reviews_author_write on public.reviews
  for all
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = reviews.order_id
        and o.customer_id = auth.uid()
        and o.status = 'delivered'
    )
  );

create policy reviews_admin_write on public.reviews
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Favourites ----------

create policy favourite_products_owner on public.favourite_products
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy favourite_sellers_owner on public.favourite_sellers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Notifications ----------

create policy notifications_owner_read on public.notifications
  for select using (user_id = auth.uid());

-- Recipients may only mark read or delete; they can never create one.
create policy notifications_owner_update on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notifications_owner_delete on public.notifications
  for delete using (user_id = auth.uid());

create policy notification_devices_owner on public.notification_devices
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Platform ----------

create policy platform_settings_public_read on public.platform_settings
  for select using (true);

create policy platform_settings_admin_write on public.platform_settings
  for update using (public.is_admin()) with check (public.is_admin());

create policy audit_logs_admin_read on public.audit_logs
  for select using (public.is_admin());

create policy upload_assets_owner on public.upload_assets
  for all using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid());


-- ===== 0010_functions.sql =====
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


-- ===== 0011_hardening.sql =====
-- ReadyUs 0011: close privilege gaps left by 0009 and 0010.
--
-- 1. An owner's RLS policy lets them write any column of their own row, which
--    included approval state: a seller could set their own shop to approved.
--    Column grants fix that for the `authenticated` role; security-definer
--    functions and the service role are unaffected, so admin review still works.
-- 2. Postgres grants EXECUTE on new functions to PUBLIC. Internal helpers and
--    anything that needs a signed-in user are narrowed explicitly.

-- ---------- Table privileges ----------

-- TRUNCATE ignores row level security, so nobody but the owner gets it.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
-- The public site only ever reads; every write needs an account.
revoke insert, update, delete on all tables in schema public from anon;

-- Profiles: status is an admin decision, not a user setting.
revoke insert, update on public.profiles from authenticated;
grant update (full_name, phone, email, avatar_url, search_radius_km, last_seen_at)
  on public.profiles to authenticated;

-- Sellers: approval, visibility, review fields and ratings are server-owned.
revoke insert, update on public.sellers from authenticated;
grant insert (
  user_id, shop_name, owner_name, phone, category, listing_mode, description,
  address, city, pincode, location, service_radius_km, open_time, close_time,
  eta_minutes, min_order_amount, delivery_fee, free_delivery_above,
  cod_available, cod_prepayment_required, cod_prepayment_amount,
  upi_id, upi_qr_url, photo_url, banner_url
) on public.sellers to authenticated;
grant update (
  shop_name, owner_name, phone, category, listing_mode, description,
  address, city, pincode, location, service_radius_km, open_time, close_time,
  business_open, auto_accept, eta_minutes, min_order_amount, delivery_fee,
  free_delivery_above, cod_available, cod_prepayment_required,
  cod_prepayment_amount, upi_id, upi_qr_url, photo_url, banner_url
) on public.sellers to authenticated;

-- Products: approval and ratings are not the seller's to set.
revoke insert, update on public.products from authenticated;
grant insert (
  seller_id, name, description, category_key, listing_mode, price, mrp, unit,
  stock, min_order_qty, images, veg_type, spice_level, prep_minutes, tags,
  variants, available
) on public.products to authenticated;
grant update (
  name, description, category_key, listing_mode, price, mrp, unit,
  stock, min_order_qty, images, veg_type, spice_level, prep_minutes, tags,
  variants, available
) on public.products to authenticated;

-- Delivery partners: eligibility comes from a seller's invite, never self-set.
revoke insert, update on public.delivery_agents from authenticated;
grant insert (user_id, full_name, phone, vehicle) on public.delivery_agents to authenticated;
grant update (full_name, phone, vehicle, available, location, location_updated_at)
  on public.delivery_agents to authenticated;

-- Recipients may mark a notification read, nothing else.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------- Function privileges ----------

-- Internal: only other functions (as owner) or the service role call these.
revoke execute on function public.notify(uuid, app_role, notification_channel, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.expire_stale_orders() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
grant execute on function public.expire_stale_orders() to service_role;

-- Need a signed-in user: already granted to authenticated in 0010.
revoke execute on function public.apply_to_sell(text, text, text, text, listing_mode, text, text, text) from public, anon;
revoke execute on function public.apply_to_deliver(text, text, text) from public, anon;
revoke execute on function public.redeem_delivery_invite(text) from public, anon;
revoke execute on function public.place_order(uuid, uuid, boolean, text) from public, anon;
revoke execute on function public.claim_payment(uuid, text) from public, anon;
revoke execute on function public.verify_payment(uuid, boolean) from public, anon;
revoke execute on function public.seller_decide_order(uuid, boolean, text) from public, anon;
revoke execute on function public.seller_set_stage(uuid, order_status) from public, anon;
revoke execute on function public.available_deliveries() from public, anon;
revoke execute on function public.claim_delivery(uuid) from public, anon;
revoke execute on function public.pickup_delivery(uuid) from public, anon;
revoke execute on function public.complete_delivery(uuid, text) from public, anon;
revoke execute on function public.cancel_order(uuid, text) from public, anon;
revoke execute on function public.review_seller(uuid, boolean, text) from public, anon;
revoke execute on function public.review_product(uuid, boolean, text) from public, anon;

-- The RLS policies call these as the querying role, so they stay executable.
grant execute on function public.has_role(app_role) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.current_seller_id() to anon, authenticated;
grant execute on function public.current_agent_id() to anon, authenticated;

-- The updated_at trigger does not need to resolve anything from search_path.
alter function public.touch_updated_at() set search_path = '';
