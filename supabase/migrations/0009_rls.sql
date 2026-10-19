-- ReadyUs 0009: row level security.
-- In the single-app architecture, RLS is what keeps roles apart. The browser
-- is never trusted; every rule below is evaluated in the database.

alter table public.profiles              enable row level security;
alter table public.user_roles            enable row level security;
alter table public.addresses             enable row level security;
alter table public.categories            enable row level security;
alter table public.sellers               enable row level security;
alter table public.products              enable row level security;
alter table public.cart_items            enable row level security;
alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;
alter table public.order_events          enable row level security;
alter table public.payments              enable row level security;
alter table public.delivery_agents       enable row level security;
alter table public.delivery_relationships enable row level security;
alter table public.delivery_invites      enable row level security;
alter table public.delivery_assignments  enable row level security;
alter table public.reviews               enable row level security;
alter table public.favourite_products    enable row level security;
alter table public.favourite_sellers     enable row level security;
alter table public.notifications         enable row level security;
alter table public.notification_devices  enable row level security;
alter table public.platform_settings     enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.upload_assets         enable row level security;

-- ---------- Profiles and roles ----------

create policy profiles_self_read on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy profiles_self_write on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_admin_write on public.profiles
  for update using (public.is_admin());

create policy user_roles_self_read on public.user_roles
  for select using (user_id = auth.uid() or public.is_admin());

-- Roles are never granted from the browser. Seller and delivery roles are
-- added by security-definer functions; admin is granted by an admin only.
create policy user_roles_admin_write on public.user_roles
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Addresses ----------

create policy addresses_owner_all on public.addresses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Categories ----------

create policy categories_public_read on public.categories
  for select using (enabled and visible or public.is_admin());

create policy categories_admin_write on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Sellers ----------

-- Approved shops are public. A seller always sees their own row, approved or not.
create policy sellers_public_read on public.sellers
  for select using (
    (status = 'approved' and public_visible)
    or user_id = auth.uid()
    or public.is_admin()
  );

create policy sellers_self_insert on public.sellers
  for insert with check (user_id = auth.uid());

create policy sellers_self_update on public.sellers
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy sellers_admin_write on public.sellers
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Products ----------

create policy products_public_read on public.products
  for select using (
    (approval_status = 'approved' and public_visible and available)
    or seller_id = public.current_seller_id()
    or public.is_admin()
  );

create policy products_seller_write on public.products
  for all
  using (seller_id = public.current_seller_id())
  with check (seller_id = public.current_seller_id());

create policy products_admin_write on public.products
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Cart ----------

create policy cart_owner_all on public.cart_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Orders ----------

-- Each party sees only the orders they are part of.
create policy orders_participant_read on public.orders
  for select using (
    customer_id = auth.uid()
    or seller_id = public.current_seller_id()
    or exists (
      select 1 from public.delivery_assignments da
      where da.order_id = orders.id and da.agent_id = public.current_agent_id()
    )
    or public.is_admin()
  );

-- Orders are created through place_order(), never by direct insert.
create policy orders_admin_write on public.orders
  for all using (public.is_admin()) with check (public.is_admin());

create policy order_items_participant_read on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          o.customer_id = auth.uid()
          or o.seller_id = public.current_seller_id()
          or exists (
            select 1 from public.delivery_assignments da
            where da.order_id = o.id and da.agent_id = public.current_agent_id()
          )
          or public.is_admin()
        )
    )
  );

create policy order_events_participant_read on public.order_events
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_events.order_id
        and (
          o.customer_id = auth.uid()
          or o.seller_id = public.current_seller_id()
          or public.is_admin()
        )
    )
  );

create policy payments_participant_read on public.payments
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = payments.order_id
        and (o.customer_id = auth.uid() or o.seller_id = public.current_seller_id() or public.is_admin())
    )
  );

-- ---------- Delivery ----------

create policy delivery_agents_self_read on public.delivery_agents
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    -- A seller can see the partners in their own fleet.
    or exists (
      select 1 from public.delivery_relationships dr
      where dr.agent_id = delivery_agents.id
        and dr.seller_id = public.current_seller_id()
        and dr.active
    )
  );

create policy delivery_agents_self_insert on public.delivery_agents
  for insert with check (user_id = auth.uid());

create policy delivery_agents_self_update on public.delivery_agents
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy delivery_agents_admin_write on public.delivery_agents
  for all using (public.is_admin()) with check (public.is_admin());

create policy delivery_relationships_read on public.delivery_relationships
  for select using (
    seller_id = public.current_seller_id()
    or agent_id = public.current_agent_id()
    or public.is_admin()
  );

create policy delivery_relationships_seller_write on public.delivery_relationships
  for all
  using (seller_id = public.current_seller_id() or public.is_admin())
  with check (seller_id = public.current_seller_id() or public.is_admin());

create policy delivery_invites_seller_all on public.delivery_invites
  for all
  using (seller_id = public.current_seller_id() or public.is_admin())
  with check (seller_id = public.current_seller_id() or public.is_admin());

create policy delivery_assignments_read on public.delivery_assignments
  for select using (
    agent_id = public.current_agent_id()
    or seller_id = public.current_seller_id()
    or public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = delivery_assignments.order_id and o.customer_id = auth.uid()
    )
  );

-- ---------- Reviews ----------

create policy reviews_public_read on public.reviews
  for select using (true);

-- A review requires a delivered order that belongs to the author.
create policy reviews_author_write on public.reviews
  for all
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = reviews.order_id
        and o.customer_id = auth.uid()
        and o.status = 'delivered'
    )
  );

create policy reviews_admin_write on public.reviews
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Favourites ----------

create policy favourite_products_owner on public.favourite_products
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy favourite_sellers_owner on public.favourite_sellers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Notifications ----------

create policy notifications_owner_read on public.notifications
  for select using (user_id = auth.uid());

-- Recipients may only mark read or delete; they can never create one.
create policy notifications_owner_update on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notifications_owner_delete on public.notifications
  for delete using (user_id = auth.uid());

create policy notification_devices_owner on public.notification_devices
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Platform ----------

create policy platform_settings_public_read on public.platform_settings
  for select using (true);

create policy platform_settings_admin_write on public.platform_settings
  for update using (public.is_admin()) with check (public.is_admin());

create policy audit_logs_admin_read on public.audit_logs
  for select using (public.is_admin());

create policy upload_assets_owner on public.upload_assets
  for all using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid());
