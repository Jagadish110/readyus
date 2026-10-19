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
