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
