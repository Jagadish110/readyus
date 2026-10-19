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
