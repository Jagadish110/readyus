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
