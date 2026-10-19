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
