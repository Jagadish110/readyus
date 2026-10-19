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
