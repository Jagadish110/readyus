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
