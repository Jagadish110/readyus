-- Localty 0026: monthly shop subscription.
--
-- Localty's only income is a monthly fee paid by the shop. Order money never passes
-- through Localty (see 0023); this is a separate flow, paid by the shop's mandate at
-- Cashfree Subscriptions.
--
-- Design: nothing here is a stored "status" that can drift. The database keeps facts
-- (trial end, the date the shop has paid through, cancellation) and derives the state
-- from them with the clock. A shop is therefore suspended on time even if a scheduled
-- job or a webhook is late. Webhooks and the resync job only ever add facts.
--
--   trialing  : inside the free trial
--   active    : paid through a date in the future
--   past_due  : the paid period or trial has ended, inside the grace days; still selling
--   suspended : grace is over; hidden from discovery and takes no new orders
--
-- Orders already placed, and refunds, are never blocked by a suspension.

-- ---------- Plans ----------

create table public.subscription_plans (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  -- Price per month before GST, in paise.
  price_paise integer not null check (price_paise > 0),
  trial_days  integer not null default 30 check (trial_days >= 0),
  grace_days  integer not null default 5 check (grace_days >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Placeholder launch price: change it with an UPDATE before real shops subscribe. A shop keeps
-- the price it started with (subscriptions.price_paise).
insert into public.subscription_plans (code, name, price_paise)
values ('standard', 'Localty Standard', 49900)
on conflict (code) do nothing;

-- ---------- A shop's subscription: facts only ----------

create table public.subscriptions (
  seller_id    uuid primary key references public.sellers(id) on delete cascade,
  plan_id      uuid not null references public.subscription_plans(id),
  price_paise  integer not null check (price_paise > 0),
  grace_days   integer not null check (grace_days >= 0),
  trial_ends_at timestamptz not null,
  -- The end of the last month the shop has paid for; null until the first payment.
  paid_through timestamptz,
  cancelled_at timestamptz,
  -- Cashfree's side: the mandate the shop approved, and its last known status.
  cashfree_subscription_id text unique,
  mandate_status text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger subscriptions_touch
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- One row per monthly charge, so a webhook and a resync that report the same charge count once.
create table public.subscription_payments (
  id                  uuid primary key default gen_random_uuid(),
  seller_id           uuid not null references public.sellers(id) on delete cascade,
  cashfree_payment_id text not null unique,
  amount_paise        integer not null check (amount_paise > 0),
  paid_at             timestamptz not null,
  period_start        timestamptz not null,
  period_end          timestamptz not null,
  created_at          timestamptz not null default now()
);

create index subscription_payments_seller_idx on public.subscription_payments (seller_id, paid_at desc);

-- What Cashfree told us and when, for support and audits.
create table public.subscription_events (
  id          bigint generated always as identity primary key,
  cashfree_subscription_id text,
  event_type  text not null,
  status      text,
  received_at timestamptz not null default now()
);

-- Only the server (service role) touches these tables; shops read theirs through the backend.
alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.subscription_events enable row level security;
revoke all on public.subscription_plans, public.subscriptions, public.subscription_payments,
              public.subscription_events from anon, authenticated;

-- Emergency switch: set to false to stop hiding any shop (for example during a Cashfree outage).
alter table public.platform_settings
  add column if not exists billing_enforced boolean not null default true;

-- ---------- State, derived from the clock ----------

-- The moment a shop stops being allowed to sell: the end of the later of the trial and the paid
-- period, plus the grace days. A shop that cancelled keeps what it paid for, with no grace on top.
create or replace function public.subscription_access_until(s public.subscriptions)
returns timestamptz
language sql
immutable
as $$
  select greatest(s.trial_ends_at, coalesce(s.paid_through, '-infinity'))
         + case when s.cancelled_at is not null then interval '0' else make_interval(days => s.grace_days) end;
$$;

create or replace function public.subscription_state(s public.subscriptions)
returns text
language sql
stable
as $$
  select case
    when s.paid_through > now() then 'active'
    when s.trial_ends_at > now() then 'trialing'
    when now() < public.subscription_access_until(s) then 'past_due'
    else 'suspended'
  end;
$$;

create or replace function public.shop_is_billable(p_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    not (select billing_enforced from public.platform_settings where id)
    or exists (
      select 1 from public.subscriptions s
      where s.seller_id = p_seller and now() < public.subscription_access_until(s)
    ),
    false
  );
$$;

revoke execute on function public.shop_is_billable(uuid) from public;
grant execute on function public.shop_is_billable(uuid) to anon, authenticated, service_role;

-- Everything the shop's billing page needs.
create or replace function public.billing_status(p_seller uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'state', public.subscription_state(s),
    'price_paise', s.price_paise,
    'trial_ends_at', s.trial_ends_at,
    'paid_through', s.paid_through,
    'access_until', public.subscription_access_until(s),
    'cancelled', s.cancelled_at is not null,
    'mandate_status', s.mandate_status,
    'grace_days', s.grace_days
  )
  from public.subscriptions s
  where s.seller_id = p_seller;
$$;

revoke execute on function public.billing_status(uuid) from public, anon, authenticated;
grant execute on function public.billing_status(uuid) to service_role;

-- ---------- Starting the trial ----------

-- The free trial starts the moment a shop is approved. Nothing is asked of the owner yet.
create or replace function public.start_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.subscription_plans;
begin
  if new.status <> 'approved' then return new; end if;

  select * into v_plan from public.subscription_plans where active order by created_at limit 1;
  if not found then return new; end if;

  insert into public.subscriptions (seller_id, plan_id, price_paise, grace_days, trial_ends_at)
  values (new.id, v_plan.id, v_plan.price_paise, v_plan.grace_days, now() + make_interval(days => v_plan.trial_days))
  on conflict (seller_id) do nothing;

  return new;
end;
$$;

create trigger sellers_start_trial
  after insert or update of status on public.sellers
  for each row execute function public.start_trial();

-- Shops approved before billing existed get a full trial from today, so nobody disappears on deploy.
insert into public.subscriptions (seller_id, plan_id, price_paise, grace_days, trial_ends_at)
select s.id, p.id, p.price_paise, p.grace_days, now() + make_interval(days => p.trial_days)
from public.sellers s
cross join lateral (
  select * from public.subscription_plans where active order by created_at limit 1
) p
where s.status = 'approved'
on conflict (seller_id) do nothing;

-- ---------- Recording facts from Cashfree (server only) ----------

-- Remembers the mandate the shop is about to approve.
create or replace function public.attach_mandate(p_seller uuid, p_cashfree_subscription text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.subscriptions
     set cashfree_subscription_id = p_cashfree_subscription,
         mandate_status = 'INITIALIZED',
         cancelled_at = null
   where seller_id = p_seller;
$$;

-- Applies Cashfree's status for a mandate and returns the shop it belongs to.
create or replace function public.update_mandate_status(p_cashfree_subscription text, p_status text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid;
begin
  update public.subscriptions
     set mandate_status = upper(p_status),
         cancelled_at = case
           when upper(p_status) in ('CANCELLED', 'CANCELED') then coalesce(cancelled_at, now())
           when upper(p_status) = 'ACTIVE' then null
           else cancelled_at
         end
   where cashfree_subscription_id = p_cashfree_subscription
  returning seller_id into v_seller;

  return v_seller;
end;
$$;

-- Records one successful monthly charge and extends the paid-through date by one month.
-- Safe to call any number of times for the same charge.
create or replace function public.record_subscription_payment(
  p_seller uuid,
  p_cashfree_payment text,
  p_amount_paise integer,
  p_paid_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions;
  v_start timestamptz;
  v_inserted uuid;
begin
  select * into v_sub from public.subscriptions where seller_id = p_seller for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;

  if p_amount_paise < v_sub.price_paise then raise exception 'AMOUNT_MISMATCH'; end if;

  -- A payment made during the trial buys the month that starts when the trial ends;
  -- one made while still paid up extends from the current end; one made after a lapse starts now.
  v_start := greatest(coalesce(v_sub.paid_through, '-infinity'), v_sub.trial_ends_at, p_paid_at);

  insert into public.subscription_payments (seller_id, cashfree_payment_id, amount_paise, paid_at, period_start, period_end)
  values (p_seller, p_cashfree_payment, p_amount_paise, p_paid_at, v_start, v_start + interval '1 month')
  on conflict (cashfree_payment_id) do nothing
  returning id into v_inserted;

  if v_inserted is null then return false; end if;

  update public.subscriptions
     set paid_through = v_start + interval '1 month'
   where seller_id = p_seller;

  return true;
end;
$$;

revoke execute on function public.attach_mandate(uuid, text) from public, anon, authenticated;
revoke execute on function public.update_mandate_status(text, text) from public, anon, authenticated;
revoke execute on function public.record_subscription_payment(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.attach_mandate(uuid, text) to service_role;
grant execute on function public.update_mandate_status(text, text) to service_role;
grant execute on function public.record_subscription_payment(uuid, text, integer, timestamptz) to service_role;

-- Mandates worth asking Cashfree about again: the safety net for a webhook that never arrived.
create or replace function public.billing_syncable()
returns table (seller_id uuid, cashfree_subscription_id text)
language sql
stable
security definer
set search_path = public
as $$
  select s.seller_id, s.cashfree_subscription_id
  from public.subscriptions s
  where s.cashfree_subscription_id is not null
    and coalesce(s.mandate_status, '') not in ('CANCELLED', 'CANCELED', 'EXPIRED', 'COMPLETED')
    and (s.paid_through is null or s.paid_through < now() + interval '2 days')
  limit 200;
$$;

revoke execute on function public.billing_syncable() from public, anon, authenticated;
grant execute on function public.billing_syncable() to service_role;

-- ---------- Reminders ----------

-- One in-app notice per milestone per shop (the dedupe key makes a repeat run a no-op):
-- 7, 3 and 1 days before the trial ends without a mandate, when payment is overdue, and when
-- the shop is suspended. Returns how many shops it looked at.
create or replace function public.billing_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
  v_days numeric;
  v_bucket integer;
begin
  for v_row in
    select s.*, sel.user_id, public.subscription_state(s) as state,
           public.subscription_access_until(s) as access_until
    from public.subscriptions s
    join public.sellers sel on sel.id = s.seller_id
    where sel.status = 'approved'
  loop
    if v_row.state = 'trialing'
       and coalesce(v_row.mandate_status, '') not in ('ACTIVE', 'BANK_APPROVAL_PENDING') then
      v_days := extract(epoch from (v_row.trial_ends_at - now())) / 86400;
      v_bucket := case when v_days <= 1 then 1 when v_days <= 3 then 3 when v_days <= 7 then 7 end;
      if v_bucket is not null then
        perform public.notify(v_row.user_id, 'seller', 'system', 'Your free trial is ending',
          'Set up automatic payment to keep your shop visible to customers.',
          '/business/billing', 'trial:' || v_row.seller_id || ':' || v_bucket);
        v_count := v_count + 1;
      end if;
    elsif v_row.state = 'past_due' then
      perform public.notify(v_row.user_id, 'seller', 'system', 'Subscription payment is overdue',
        'Pay now to keep your shop visible. It will be hidden after the grace period.',
        '/business/billing',
        'pastdue:' || v_row.seller_id || ':' || coalesce(v_row.paid_through, v_row.trial_ends_at)::date);
      v_count := v_count + 1;
    elsif v_row.state = 'suspended' then
      perform public.notify(v_row.user_id, 'seller', 'system', 'Your shop is hidden',
        'Customers cannot find your shop or place new orders until your subscription is paid.',
        '/business/billing',
        'suspended:' || v_row.seller_id || ':' || v_row.access_until::date);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.billing_reminders() from public, anon, authenticated;
grant execute on function public.billing_reminders() to service_role;

-- ---------- Gating ----------
-- The four functions below are unchanged from their last versions (nearby_sellers: 0014,
-- nearby_products and nearby_categories: 0008, place_order: 0015) except for one added
-- condition: the shop must be billable.

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
    and public.shop_is_billable(s.id)
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
      and public.shop_is_billable(s.id)
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
      and public.shop_is_billable(s.id)
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
  if not public.shop_is_billable(p_seller_id) then
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
