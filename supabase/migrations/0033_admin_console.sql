-- Localty 0033: what an operator needs to run the platform.
-- Suspend a shop or a rider, look up orders and complaints, manage who is an admin.
-- Every function checks is_admin() itself, and each change leaves a row in audit_logs.

alter table public.sellers
  add column suspended_at timestamptz,
  add column suspended_reason text not null default '';

-- A suspended shop cannot trade, so it vanishes from search and cannot take orders.
create or replace function public.shop_can_trade(p_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.shop_is_billable(p_seller)
     and public.shop_is_compliant(p_seller)
     and not exists (select 1 from public.sellers s where s.id = p_seller and s.suspended_at is not null);
$$;

-- ---------- overview ----------

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return jsonb_build_object(
    'pending_shops',       (select count(*) from sellers where status = 'pending'),
    'pending_products',    (select count(*) from products where approval_status = 'pending'),
    'pending_documents',   (select count(*) from seller_documents where status = 'pending'),
    'shops_live',          (select count(*) from sellers s where s.status = 'approved' and public.shop_can_trade(s.id)),
    'shops_suspended',     (select count(*) from sellers where suspended_at is not null),
    'shops_unpaid',        (select count(*) from subscriptions s where public.subscription_state(s) in ('past_due', 'suspended')),
    'riders_active',       (select count(*) from delivery_agents where status = 'approved'),
    'orders_today',        (select count(*) from orders where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
    'orders_in_progress',  (select count(*) from orders where status in ('accepted', 'preparing', 'packed', 'assigned', 'out_for_delivery')),
    'open_issues',         (select count(*) from order_issues where status = 'open'),
    'refunds_waiting',     (select count(*) from orders_needing_refund())
  );
end;
$$;

-- ---------- shops ----------

create or replace function public.admin_shops(p_search text default '', p_limit integer default 50)
returns table (
  id uuid, shop_name text, owner_name text, phone text, city text, status approval_status,
  suspended_at timestamptz, suspended_reason text, plan_state text, can_trade boolean,
  fssai_status text, orders_30d bigint, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return query
  select s.id, s.shop_name, s.owner_name, s.phone, s.city, s.status,
         s.suspended_at, s.suspended_reason,
         public.subscription_state(sub),
         public.shop_can_trade(s.id),
         (select d.status from seller_documents d where d.seller_id = s.id and d.kind = 'fssai'),
         (select count(*) from orders o where o.seller_id = s.id and o.created_at > now() - interval '30 days'),
         s.created_at
  from sellers s
  left join subscriptions sub on sub.seller_id = s.id
  where coalesce(p_search, '') = ''
     or s.shop_name ilike '%' || p_search || '%'
     or s.owner_name ilike '%' || p_search || '%'
     or s.phone like '%' || p_search || '%'
  order by s.created_at desc
  limit least(greatest(p_limit, 1), 200);
end;
$$;

create or replace function public.admin_set_shop_suspended(p_seller uuid, p_suspend boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  if p_suspend and char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;

  update sellers
     set suspended_at = case when p_suspend then now() else null end,
         suspended_reason = case when p_suspend then trim(p_reason) else '' end
   where id = p_seller
  returning user_id into v_user;
  if not found then raise exception 'SELLER_NOT_FOUND'; end if;

  insert into audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), case when p_suspend then 'seller.suspend' else 'seller.unsuspend' end,
          'seller', p_seller::text, jsonb_build_object('reason', coalesce(p_reason, '')));

  perform public.notify(v_user, 'seller', 'approval',
    case when p_suspend then 'Your shop is paused' else 'Your shop is back' end,
    case when p_suspend then trim(p_reason) else 'Customers can find you again.' end,
    '/business', 'seller-suspend:' || p_seller::text || ':' || clock_timestamp()::text);
end;
$$;

-- ---------- riders ----------

create or replace function public.admin_riders(p_search text default '', p_limit integer default 50)
returns table (
  id uuid, full_name text, phone text, vehicle text, status approval_status, available boolean,
  shops bigint, deliveries bigint, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return query
  select a.id, a.full_name, a.phone, a.vehicle, a.status, a.available,
         (select count(*) from delivery_relationships r where r.agent_id = a.id and r.active),
         (select count(*) from delivery_assignments d where d.agent_id = a.id and d.status = 'delivered'),
         a.created_at
  from delivery_agents a
  where coalesce(p_search, '') = ''
     or a.full_name ilike '%' || p_search || '%'
     or a.phone like '%' || p_search || '%'
  order by a.created_at desc
  limit least(greatest(p_limit, 1), 200);
end;
$$;

-- A suspended rider is 'rejected': they cannot be assigned and cannot sign in to deliveries.
create or replace function public.admin_set_rider_suspended(p_agent uuid, p_suspend boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  if p_suspend and char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_suspend and exists (
    select 1 from delivery_assignments d where d.agent_id = p_agent and d.status in ('claimed', 'picked_up')
  ) then
    raise exception 'RIDER_HAS_ACTIVE_DELIVERY';
  end if;

  update delivery_agents
     set status = case when p_suspend then 'rejected'::approval_status else 'approved'::approval_status end,
         available = case when p_suspend then false else available end
   where id = p_agent and status = case when p_suspend then 'approved'::approval_status else 'rejected'::approval_status end
  returning user_id into v_user;
  if not found then raise exception 'RIDER_NOT_FOUND'; end if;

  insert into audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), case when p_suspend then 'rider.suspend' else 'rider.unsuspend' end,
          'rider', p_agent::text, jsonb_build_object('reason', coalesce(p_reason, '')));

  perform public.notify(v_user, 'delivery', 'delivery',
    case when p_suspend then 'Your delivery account is paused' else 'Your delivery account is back' end,
    case when p_suspend then trim(p_reason) else 'You can take deliveries again.' end,
    '/delivery', 'rider-suspend:' || p_agent::text || ':' || clock_timestamp()::text);
end;
$$;

-- ---------- orders ----------

create or replace function public.admin_orders(p_search text default '', p_status text default '', p_limit integer default 50)
returns table (
  id uuid, order_code text, status order_status, shop_name text, customer_name text,
  total_paise integer, verified_prepaid_paise integer, refunded_paise integer,
  open_issues bigint, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return query
  select o.id, o.order_code, o.status, s.shop_name, p.full_name,
         o.total_paise, o.verified_prepaid_paise, o.refunded_paise,
         (select count(*) from order_issues i where i.order_id = o.id and i.status = 'open'),
         o.created_at
  from orders o
  join sellers s on s.id = o.seller_id
  left join profiles p on p.id = o.customer_id
  where (coalesce(p_status, '') = '' or o.status::text = p_status)
    and (coalesce(p_search, '') = ''
         or o.order_code ilike '%' || p_search || '%'
         or s.shop_name ilike '%' || p_search || '%'
         or p.full_name ilike '%' || p_search || '%')
  order by o.created_at desc
  limit least(greatest(p_limit, 1), 200);
end;
$$;

-- One order, with everything an operator needs to settle a dispute.
create or replace function public.admin_order_detail(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id, 'order_code', o.order_code, 'status', o.status, 'payment_mode', o.payment_mode,
      'subtotal_paise', o.subtotal_paise, 'delivery_fee_paise', o.delivery_fee_paise, 'total_paise', o.total_paise,
      'verified_prepaid_paise', o.verified_prepaid_paise, 'refunded_paise', o.refunded_paise,
      'refund_target_paise', o.refund_target_paise, 'cash_collected_paise', o.cash_collected_paise,
      'cancel_reason', o.cancel_reason, 'created_at', o.created_at, 'delivered_at', o.delivered_at,
      'shop_name', s.shop_name, 'shop_phone', s.phone, 'customer_name', p.full_name,
      'customer_phone', o.delivery_address ->> 'phone', 'address', o.delivery_address
    ),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'variant_label', i.variant_label,
                'quantity', i.quantity, 'line_total_paise', i.line_total_paise) order by i.name)
              from order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'note', e.note, 'at', e.created_at)
                order by e.created_at) from order_events e where e.order_id = o.id), '[]'::jsonb),
    'issues', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'message', x.message,
                'status', x.status, 'resolution_note', x.resolution_note, 'created_at', x.created_at)
                order by x.created_at) from order_issues x where x.order_id = o.id), '[]'::jsonb),
    'rider', (select jsonb_build_object('name', a.full_name, 'phone', a.phone, 'status', d.status)
              from delivery_assignments d join delivery_agents a on a.id = d.agent_id where d.order_id = o.id)
  ) into v_result
  from orders o
  join sellers s on s.id = o.seller_id
  left join profiles p on p.id = o.customer_id
  where o.id = p_order;

  if v_result is null then raise exception 'ORDER_NOT_FOUND'; end if;
  return v_result;
end;
$$;

-- ---------- admins ----------

create or replace function public.admin_list_admins()
returns table (user_id uuid, email text, full_name text, granted_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return query
  select r.user_id, p.email, p.full_name, r.granted_at
  from user_roles r join profiles p on p.id = r.user_id
  where r.role = 'admin' order by r.granted_at;
end;
$$;

-- The person must already have an account: they sign up first, then an admin promotes them.
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
  select id into v_user from profiles where lower(email) = lower(trim(p_email)) and status = 'active';
  if v_user is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  insert into user_roles (user_id, role) values (v_user, 'admin') on conflict do nothing;
  insert into audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), 'admin.grant', 'user', v_user::text, '{}'::jsonb);
end;
$$;

create or replace function public.admin_revoke_admin(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  if p_user = auth.uid() then raise exception 'CANNOT_REMOVE_SELF'; end if;
  delete from user_roles where user_id = p_user and role = 'admin';
  if not found then raise exception 'NOT_AN_ADMIN'; end if;
  insert into audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), 'admin.revoke', 'user', p_user::text, '{}'::jsonb);
end;
$$;

revoke execute on function
  public.admin_overview(), public.admin_shops(text, integer), public.admin_set_shop_suspended(uuid, boolean, text),
  public.admin_riders(text, integer), public.admin_set_rider_suspended(uuid, boolean, text),
  public.admin_orders(text, text, integer), public.admin_order_detail(uuid),
  public.admin_list_admins(), public.admin_grant_admin(text), public.admin_revoke_admin(uuid)
  from public, anon;
grant execute on function
  public.admin_overview(), public.admin_shops(text, integer), public.admin_set_shop_suspended(uuid, boolean, text),
  public.admin_riders(text, integer), public.admin_set_rider_suspended(uuid, boolean, text),
  public.admin_orders(text, text, integer), public.admin_order_detail(uuid),
  public.admin_list_admins(), public.admin_grant_admin(text), public.admin_revoke_admin(uuid)
  to authenticated;
