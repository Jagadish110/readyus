-- Localty 0037: production hardening found in the pre-launch audit.
--
-- The website and the backend never use Supabase's data API (the backend talks to Postgres directly),
-- but the API is reachable by anyone holding the public key, and a signed-in user can call it with their
-- own login. Row level security and column grants are therefore the real boundary, and these gaps let a
-- user step around checks the backend makes:
--
--   * Admin by email: admin_grant_admin looked the email up in profiles.email, which its owner can edit.
--     Someone could copy the address an admin was about to promote and be made admin instead. It now uses
--     the sign-in email Supabase verified, and profiles.email is no longer editable by its owner.
--   * Riders: a shop could add any rider to its team, re-add one it had removed, or point a link at another
--     rider, then read that rider's phone and live location. Riders now join only by redeeming an invite;
--     a shop can only take a rider off.
--   * Invites: a shop could mark its invites used or rewrite their codes. Only the server's insert remains.
--   * Licence check: a food shop could switch its own listing type to "items" and skip the FSSAI check.
--   * Prices: fees, minimums and size prices written without the app's form are now range-checked by the
--     database too, so checkout can trust them.
--   * Advisor fixes: the start_trial trigger function is not callable on its own, two functions get a fixed
--     search_path, and the unused upload_assets table is closed to direct writes.
--
-- Speed, for when the tables grow:
--   * Access rules read the caller (auth.uid(), current_seller_id(), current_agent_id(), is_admin()) once
--     per query instead of once per row. The rules themselves are unchanged.
--   * Indexes for foreign keys on tables that grow, so deleting a product or an account does not scan them.

-- ---------- Admin by verified email ----------

create or replace function public.admin_grant_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  -- The sign-in email, which Supabase confirmed and keeps unique; profiles.email is only a copy.
  select u.id into v_user
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
    and u.email_confirmed_at is not null
    and p.status = 'active';
  if v_user is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  insert into user_roles (user_id, role) values (v_user, 'admin') on conflict do nothing;
  insert into audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), 'admin.grant', 'user', v_user::text, '{}'::jsonb);
end;
$$;

revoke update (email) on public.profiles from authenticated;

-- ---------- Riders join by invite; a shop can only remove them ----------

drop policy if exists delivery_relationships_seller_write on public.delivery_relationships;
drop policy if exists delivery_relationships_admin_write on public.delivery_relationships;
drop policy if exists delivery_relationships_seller_remove on public.delivery_relationships;

create policy delivery_relationships_admin_write on public.delivery_relationships
  for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- The only write the backend makes as a shop: active = false, removed_at = now().
create policy delivery_relationships_seller_remove on public.delivery_relationships
  for update
  using (seller_id = (select public.current_seller_id()))
  with check (seller_id = (select public.current_seller_id()) and not active);

revoke insert, update, delete on public.delivery_relationships from authenticated;
grant update (active, removed_at) on public.delivery_relationships to authenticated;

-- ---------- Invites: the server's insert only ----------

revoke insert, update on public.delivery_invites from authenticated;
grant insert (seller_id, code, expires_at) on public.delivery_invites to authenticated;

-- ---------- Listing type changes go through review ----------

revoke update (listing_mode) on public.sellers from authenticated;

-- ---------- Range checks the app's forms already apply ----------

alter table public.sellers drop constraint if exists sellers_money_ranges;
alter table public.sellers add constraint sellers_money_ranges check (
  delivery_fee between 0 and 5000
  and free_delivery_above between 0 and 100000
  and min_order_amount between 0 and 100000
  and cod_prepayment_amount between 0 and 100000
  and eta_minutes between 1 and 600
);

-- A product's sizes, as the seller console writes them (see variantsField in seller-console.ts).
create or replace function public.variants_are_valid(p_variants jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_variants) = 'array'
    and jsonb_array_length(p_variants) <= 8
    and not exists (
      select 1
      from jsonb_array_elements(p_variants) as v
      where jsonb_typeof(v) is distinct from 'object'
         or jsonb_typeof(v -> 'price') is distinct from 'number'
         or (v ->> 'price')::numeric not between 0 and 1000000
         or (v ? 'mrp' and jsonb_typeof(v -> 'mrp') not in ('number', 'null'))
         or coalesce(v ->> 'id', '') !~ '^[a-z0-9]{1,16}$'
         or char_length(btrim(coalesce(v ->> 'label', ''))) not between 1 and 40
    );
$$;

alter table public.products drop constraint if exists products_variants_valid;
alter table public.products add constraint products_variants_valid check (public.variants_are_valid(variants));

-- ---------- Advisor fixes ----------

-- A trigger function; triggers fire without this grant.
revoke execute on function public.start_trial() from public, anon, authenticated;

alter function public.subscription_access_until(public.subscriptions) set search_path = public;
alter function public.subscription_state(public.subscriptions) set search_path = public;

revoke insert, update, delete on public.upload_assets from anon, authenticated;

-- ---------- Read the caller once per query, not once per row ----------

alter policy addresses_owner_all on public.addresses
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy audit_logs_admin_read on public.audit_logs
  using ((select public.is_admin()));
alter policy cart_owner_all on public.cart_items
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy categories_admin_write on public.categories
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
alter policy categories_public_read on public.categories
  using (((enabled AND visible) OR (select public.is_admin())));
alter policy delivery_agents_admin_write on public.delivery_agents
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
alter policy delivery_agents_self_insert on public.delivery_agents
  with check ((user_id = (select auth.uid())));
alter policy delivery_agents_self_read on public.delivery_agents
  using (((user_id = (select auth.uid())) OR (select public.is_admin()) OR (EXISTS ( SELECT 1
   FROM delivery_relationships dr
  WHERE ((dr.agent_id = delivery_agents.id) AND (dr.seller_id = (select public.current_seller_id())) AND dr.active)))));
alter policy delivery_agents_self_update on public.delivery_agents
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy delivery_assignments_read on public.delivery_assignments
  using (((agent_id = (select public.current_agent_id())) OR (seller_id = (select public.current_seller_id())) OR (select public.is_admin()) OR is_order_customer(order_id)));
alter policy delivery_invites_seller_all on public.delivery_invites
  using (((seller_id = (select public.current_seller_id())) OR (select public.is_admin())))
  with check (((seller_id = (select public.current_seller_id())) OR (select public.is_admin())));
alter policy delivery_relationships_read on public.delivery_relationships
  using (((seller_id = (select public.current_seller_id())) OR (agent_id = (select public.current_agent_id())) OR (select public.is_admin())));
alter policy favourite_products_owner on public.favourite_products
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy favourite_sellers_owner on public.favourite_sellers
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy notifications_owner_delete on public.notifications
  using ((user_id = (select auth.uid())));
alter policy notifications_owner_read on public.notifications
  using ((user_id = (select auth.uid())));
alter policy notifications_owner_update on public.notifications
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy order_events_participant_read on public.order_events
  using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_events.order_id) AND ((o.customer_id = (select auth.uid())) OR (o.seller_id = (select public.current_seller_id())) OR (select public.is_admin()))))));
alter policy order_items_participant_read on public.order_items
  using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND ((o.customer_id = (select auth.uid())) OR (o.seller_id = (select public.current_seller_id())) OR (EXISTS ( SELECT 1
           FROM delivery_assignments da
          WHERE ((da.order_id = o.id) AND (da.agent_id = (select public.current_agent_id()))))) OR (select public.is_admin()))))));
alter policy orders_admin_write on public.orders
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
alter policy orders_participant_read on public.orders
  using (((customer_id = (select auth.uid())) OR (seller_id = (select public.current_seller_id())) OR is_assigned_agent(id) OR (select public.is_admin())));
alter policy payments_participant_read on public.payments
  using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = payments.order_id) AND ((o.customer_id = (select auth.uid())) OR (o.seller_id = (select public.current_seller_id())) OR (select public.is_admin()))))));
alter policy platform_settings_admin_write on public.platform_settings
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
alter policy products_admin_write on public.products
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
alter policy products_public_read on public.products
  using ((((approval_status = 'approved'::approval_status) AND public_visible AND available) OR (seller_id = (select public.current_seller_id())) OR (select public.is_admin())));
alter policy products_seller_write on public.products
  using ((seller_id = (select public.current_seller_id())))
  with check ((seller_id = (select public.current_seller_id())));
alter policy profiles_admin_write on public.profiles
  using ((select public.is_admin()));
alter policy profiles_self_read on public.profiles
  using (((id = (select auth.uid())) OR (select public.is_admin())));
alter policy profiles_self_write on public.profiles
  using ((id = (select auth.uid())))
  with check ((id = (select auth.uid())));
alter policy reviews_admin_write on public.reviews
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
alter policy reviews_author_write on public.reviews
  using ((author_id = (select auth.uid())))
  with check (((author_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = reviews.order_id) AND (o.customer_id = (select auth.uid())) AND (o.status = 'delivered'::order_status))))));
alter policy sellers_admin_write on public.sellers
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
alter policy sellers_public_read on public.sellers
  using ((((status = 'approved'::approval_status) AND public_visible) OR (user_id = (select auth.uid())) OR (select public.is_admin())));
alter policy sellers_self_insert on public.sellers
  with check ((user_id = (select auth.uid())));
alter policy sellers_self_update on public.sellers
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy upload_assets_owner on public.upload_assets
  using (((owner_id = (select auth.uid())) OR (select public.is_admin())))
  with check ((owner_id = (select auth.uid())));
alter policy user_roles_admin_write on public.user_roles
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
alter policy user_roles_self_read on public.user_roles
  using (((user_id = (select auth.uid())) OR (select public.is_admin())));

-- ---------- Indexes for foreign keys on tables that grow ----------

create index if not exists order_items_product_idx on public.order_items (product_id);
create index if not exists cart_items_product_idx on public.cart_items (product_id);
create index if not exists favourite_products_product_idx on public.favourite_products (product_id);
create index if not exists favourite_sellers_seller_idx on public.favourite_sellers (seller_id);
create index if not exists order_events_actor_idx on public.order_events (actor_id);
create index if not exists reviews_author_idx on public.reviews (author_id);
create index if not exists delivery_invites_seller_idx on public.delivery_invites (seller_id);
