-- The small part of Supabase the migrations rely on, so they can run on a plain
-- Postgres + PostGIS (CI and local tests). Never applied to a real Supabase project.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  -- Columns Supabase's own seed data fills in.
  instance_id uuid,
  aud text,
  role text,
  raw_app_meta_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Supabase reads the caller from the JWT claims the backend sets per transaction.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;

create publication supabase_realtime;

grant usage on schema public, auth, storage to anon, authenticated, service_role;

-- Supabase hands every new public table, sequence and function to these roles; the migrations then
-- revoke what must stay private. Without this the tests would not notice a table left too open.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
