-- Localty 0030: every order can now end.
--
-- Until now an order could only move forward or be declined while waiting. This adds the ways real
-- orders end badly, and the money consequences of each:
--
--   * seller_cancel_order      the shop cannot make it after accepting (stock back, refund, rider freed)
--   * report_delivery_failed   nobody could hand it over. Fault of the shop or rider: cancelled and
--                              refunded. Fault of the customer: 'delivery_failed', not refunded
--                              automatically (the food was made); an admin can still decide to refund.
--   * release_delivery         a rider hands an assignment back before pickup
--   * request_refund           a shop (or admin) returns all or part of an online payment later,
--                              for example a missing item
--   * confirm_cash_handover    cash a rider collected is confirmed as received by the shop
--   * report_order_issue       the customer says something went wrong; shop and admin see it

alter type public.order_status add value if not exists 'delivery_failed';

alter table public.orders
  -- How much of the online payment should have been returned in total. The refund job pays the difference.
  add column if not exists refund_target_paise integer not null default 0 check (refund_target_paise >= 0);

-- The orders table hides its columns by default (see 0015); the shop's order list reads this one.
grant select (refund_target_paise) on public.orders to authenticated;

alter table public.delivery_assignments
  add column if not exists cash_handed_over_at timestamptz,
  add column if not exists cash_handed_over_by uuid references public.profiles(id);

create index if not exists delivery_assignments_cash_idx
  on public.delivery_assignments (seller_id) where status = 'delivered' and cash_due_paise > 0 and cash_handed_over_at is null;

-- ---------- shop cancels after accepting ----------

create or replace function public.seller_cancel_order(p_order uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := public.current_seller_id();
  v_order public.orders;
  v_rider uuid;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'The shop could not complete this order');
begin
  if v_seller is null then raise exception 'SELLER_PROFILE_REQUIRED'; end if;

  select * into v_order from public.orders where id = p_order and seller_id = v_seller for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  -- Before the rider has the food. After pickup the order is the rider's: use a failed delivery.
  if v_order.status not in ('accepted', 'preparing', 'packed', 'assigned') then
    raise exception 'ORDER_NOT_CANCELLABLE';
  end if;

  update public.products p
     set stock = p.stock + oi.quantity
    from public.order_items oi
   where oi.order_id = p_order and oi.product_id = p.id;

  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
   where id = p_order;

  update public.delivery_assignments set status = 'cancelled'
   where order_id = p_order and status = 'claimed'
  returning agent_id into v_rider;

  insert into public.order_events (order_id, status, actor_id, actor_role, note)
  values (p_order, 'cancelled', auth.uid(), 'seller', v_reason);

  perform public.notify(v_order.customer_id, 'customer', 'order', 'The shop cancelled your order',
    v_reason || case when v_order.verified_prepaid_paise > 0 then '. Your payment is being refunded.' else '.' end,
    '/orders/' || p_order::text, 'seller-cancelled:' || p_order::text);

  if v_rider is not null then
    perform public.notify((select user_id from public.delivery_agents where id = v_rider), 'delivery', 'delivery',
      'Delivery cancelled', 'The shop cancelled ' || v_order.order_code || '. You do not need to collect it.',
      '/delivery', 'rider-cancelled:' || p_order::text);
  end if;
end;
$$;

-- ---------- a delivery that could not be completed ----------

create or replace function public.report_delivery_failed(p_order uuid, p_cause text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_agent uuid := public.current_agent_id();
  v_seller uuid := public.current_seller_id();
  v_by_rider boolean;
  v_label text;
  v_customer_fault boolean;
  v_text text;
  v_admin uuid;
begin
  if p_cause not in ('customer_unreachable', 'customer_refused', 'wrong_address', 'rider_problem', 'shop_problem') then
    raise exception 'UNKNOWN_CAUSE';
  end if;

  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status not in ('assigned', 'out_for_delivery') then raise exception 'ORDER_NOT_DELIVERABLE'; end if;

  v_by_rider := v_agent is not null and exists (
    select 1 from public.delivery_assignments where order_id = p_order and agent_id = v_agent and status in ('claimed', 'picked_up')
  );
  if not v_by_rider and not (v_seller is not null and v_order.seller_id = v_seller) then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  v_customer_fault := p_cause in ('customer_unreachable', 'customer_refused', 'wrong_address');
  v_label := case p_cause
    when 'customer_unreachable' then 'The customer could not be reached'
    when 'customer_refused' then 'The customer refused the order'
    when 'wrong_address' then 'The delivery address was wrong'
    when 'rider_problem' then 'The delivery partner had a problem'
    else 'The shop had a problem' end;
  v_text := v_label || case when nullif(trim(p_note), '') is not null then ': ' || trim(p_note) else '' end;

  update public.delivery_assignments set status = 'cancelled'
   where order_id = p_order and status in ('claimed', 'picked_up');

  -- The food was made and taken out, so a customer's own fault is not refunded automatically.
  update public.orders
     set status = case when v_customer_fault then 'delivery_failed'::order_status else 'cancelled'::order_status end,
         cancelled_at = now(), cancel_reason = v_text
   where id = p_order;

  insert into public.order_events (order_id, status, actor_id, actor_role, note)
  values (p_order, case when v_customer_fault then 'delivery_failed'::order_status else 'cancelled'::order_status end,
          auth.uid(), case when v_by_rider then 'delivery'::app_role else 'seller'::app_role end, v_text);

  perform public.notify(v_order.customer_id, 'customer', 'delivery', 'We could not deliver your order',
    v_text || case
      when not v_customer_fault and v_order.verified_prepaid_paise > 0 then '. Your payment is being refunded.'
      when v_customer_fault and v_order.verified_prepaid_paise > 0 then '. Contact the shop or report a problem if this is wrong.'
      else '.' end,
    '/orders/' || p_order::text, 'delivery-failed:' || p_order::text);

  if v_by_rider then
    perform public.notify((select user_id from public.sellers where id = v_order.seller_id), 'seller', 'delivery',
      'Delivery failed', v_order.order_code || ': ' || v_text, '/business/orders', 'delivery-failed-shop:' || p_order::text);
  end if;

  -- Money was taken and the customer is not at fault for the refund question: someone should look.
  if v_customer_fault and v_order.verified_prepaid_paise > 0 then
    for v_admin in select user_id from public.user_roles where role = 'admin' loop
      perform public.notify(v_admin, 'admin', 'payment', 'Delivery failed: decide on a refund',
        v_order.order_code || ' was paid online. ' || v_text, '/admin/orders', 'failed-review:' || p_order::text || ':' || v_admin::text);
    end loop;
  end if;
end;
$$;

-- ---------- a rider hands the order back before pickup ----------

create or replace function public.release_delivery(p_order uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid := public.current_agent_id();
  v_order public.orders;
  v_name text;
begin
  if v_agent is null then raise exception 'DELIVERY_PROFILE_REQUIRED'; end if;

  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  delete from public.delivery_assignments where order_id = p_order and agent_id = v_agent and status = 'claimed';
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;

  update public.orders set status = 'packed' where id = p_order;

  select full_name into v_name from public.delivery_agents where id = v_agent;
  insert into public.order_events (order_id, status, actor_id, actor_role, note)
  values (p_order, 'packed', auth.uid(), 'delivery', 'Delivery partner handed it back: ' || coalesce(nullif(trim(p_reason), ''), 'no reason given'));

  perform public.notify((select user_id from public.sellers where id = v_order.seller_id), 'seller', 'delivery',
    'Rider handed an order back',
    coalesce(v_name, 'A rider') || ' cannot deliver ' || v_order.order_code || ': ' || coalesce(nullif(trim(p_reason), ''), 'no reason given') || '. Please assign someone else.',
    '/business/orders', 'released:' || p_order::text || ':' || clock_timestamp()::text);
end;
$$;

-- ---------- refunds after the fact ----------

-- What the refund job should return: everything on an order that ended before delivery, or the amount
-- a shop or admin asked for. Rows the job has already paid in full drop out by themselves.
drop function if exists public.orders_needing_refund();
create function public.orders_needing_refund()
returns table (order_id uuid, cashfree_order text, vendor_id text, amount_paise integer)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         o.cashfree_order_id,
         a.cashfree_vendor_id,
         (case when o.status in ('rejected', 'cancelled_by_customer', 'cancelled', 'timed_out')
               then o.verified_prepaid_paise
               else least(o.refund_target_paise, o.verified_prepaid_paise) end) - o.refunded_paise
  from public.orders o
  join public.seller_payout_accounts a on a.seller_id = o.seller_id
  where o.payment_provider = 'cashfree'
    and o.cashfree_order_id is not null
    and (case when o.status in ('rejected', 'cancelled_by_customer', 'cancelled', 'timed_out')
              then o.verified_prepaid_paise
              else least(o.refund_target_paise, o.verified_prepaid_paise) end) > o.refunded_paise
  limit 50;
$$;

revoke execute on function public.orders_needing_refund() from public, anon, authenticated;
grant execute on function public.orders_needing_refund() to service_role;

create or replace function public.apply_refund_request(p_order uuid, p_amount_paise integer, p_reason text, p_role app_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_base integer;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'Refund requested');
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.verified_prepaid_paise <= 0 or v_order.payment_provider <> 'cashfree' then raise exception 'NOTHING_TO_REFUND'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  v_base := greatest(v_order.refund_target_paise, v_order.refunded_paise);
  if v_base + p_amount_paise > v_order.verified_prepaid_paise then raise exception 'REFUND_TOO_LARGE'; end if;

  update public.orders set refund_target_paise = v_base + p_amount_paise where id = p_order;

  insert into public.order_events (order_id, status, actor_id, actor_role, note)
  values (p_order, v_order.status, auth.uid(), p_role,
          'Refund of Rs ' || to_char(p_amount_paise / 100.0, 'FM999990.00') || ': ' || v_reason);

  insert into public.audit_logs (actor_id, action, entity, entity_id, data)
  values (auth.uid(), 'order.refund_requested', 'order', p_order::text,
          jsonb_build_object('amount_paise', p_amount_paise, 'reason', v_reason, 'by', p_role));
end;
$$;

create or replace function public.seller_request_refund(p_order uuid, p_amount_paise integer, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := public.current_seller_id();
begin
  if v_seller is null then raise exception 'SELLER_PROFILE_REQUIRED'; end if;
  if not exists (select 1 from public.orders where id = p_order and seller_id = v_seller) then raise exception 'ORDER_NOT_FOUND'; end if;
  perform public.apply_refund_request(p_order, p_amount_paise, p_reason, 'seller');
end;
$$;

create or replace function public.admin_request_refund(p_order uuid, p_amount_paise integer, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  perform public.apply_refund_request(p_order, p_amount_paise, p_reason, 'admin');
end;
$$;

-- ---------- cash held by riders ----------

create or replace function public.cash_with_riders()
returns table (assignment_id uuid, order_id uuid, order_code text, agent_id uuid, rider_name text, cash_paise integer, delivered_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select da.id, da.order_id, o.order_code, da.agent_id, a.full_name, da.cash_due_paise, da.delivered_at
  from public.delivery_assignments da
  join public.orders o on o.id = da.order_id
  join public.delivery_agents a on a.id = da.agent_id
  where da.seller_id = public.current_seller_id()
    and da.status = 'delivered' and da.cash_due_paise > 0 and da.cash_handed_over_at is null
  order by da.delivered_at;
$$;

-- Confirms one delivery's cash, or all of one rider's cash when p_order is null.
create or replace function public.confirm_cash_handover(p_agent uuid, p_order uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := public.current_seller_id();
  v_count integer;
begin
  if v_seller is null then raise exception 'SELLER_PROFILE_REQUIRED'; end if;
  update public.delivery_assignments
     set cash_handed_over_at = now(), cash_handed_over_by = auth.uid()
   where seller_id = v_seller and agent_id = p_agent and status = 'delivered'
     and cash_due_paise > 0 and cash_handed_over_at is null
     and (p_order is null or order_id = p_order);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- What a rider still has to hand over, per shop.
create or replace function public.my_cash_to_hand_over()
returns table (shop_name text, orders integer, cash_paise integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.shop_name, count(*)::int, sum(da.cash_due_paise)::int
  from public.delivery_assignments da
  join public.sellers s on s.id = da.seller_id
  where da.agent_id = public.current_agent_id()
    and da.status = 'delivered' and da.cash_due_paise > 0 and da.cash_handed_over_at is null
  group by s.shop_name
  order by s.shop_name;
$$;

-- ---------- "something went wrong" from the customer ----------

create table public.order_issues (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  reporter_id     uuid not null references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('missing_item', 'wrong_item', 'quality', 'late', 'not_delivered', 'payment', 'other')),
  message         text not null default '' check (char_length(message) <= 500),
  status          text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text not null default '',
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id)
);

create index order_issues_open_idx on public.order_issues (created_at) where status = 'open';
create index order_issues_order_idx on public.order_issues (order_id);

alter table public.order_issues enable row level security;
revoke all on public.order_issues from anon, authenticated;

create or replace function public.report_order_issue(p_order uuid, p_kind text, p_message text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_id uuid;
  v_admin uuid;
begin
  select * into v_order from public.orders where id = p_order and customer_id = auth.uid();
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status in ('pending', 'payment_required', 'payment_rejected') then raise exception 'ORDER_NOT_STARTED'; end if;
  if (select count(*) from public.order_issues where order_id = p_order and status = 'open') >= 3 then
    raise exception 'TOO_MANY_ISSUES';
  end if;

  insert into public.order_issues (order_id, reporter_id, kind, message)
  values (p_order, auth.uid(), p_kind, left(coalesce(trim(p_message), ''), 500))
  returning id into v_id;

  perform public.notify((select user_id from public.sellers where id = v_order.seller_id), 'seller', 'order',
    'A customer reported a problem', v_order.order_code || ': ' || replace(p_kind, '_', ' '), '/business/orders', 'issue:' || v_id::text);
  for v_admin in select user_id from public.user_roles where role = 'admin' loop
    perform public.notify(v_admin, 'admin', 'order', 'Order problem reported', v_order.order_code || ': ' || replace(p_kind, '_', ' '),
      '/admin/orders', 'issue-admin:' || v_id::text || ':' || v_admin::text);
  end loop;
  return v_id;
end;
$$;

create or replace function public.my_order_issues(p_order uuid)
returns table (id uuid, kind text, message text, status text, resolution_note text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.kind, i.message, i.status, i.resolution_note, i.created_at
  from public.order_issues i join public.orders o on o.id = i.order_id
  where i.order_id = p_order and o.customer_id = auth.uid() order by i.created_at desc;
$$;

create or replace function public.seller_order_issues()
returns table (id uuid, order_id uuid, order_code text, kind text, message text, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.order_id, o.order_code, i.kind, i.message, i.status, i.created_at
  from public.order_issues i join public.orders o on o.id = i.order_id
  where o.seller_id = public.current_seller_id() and (i.status = 'open' or i.resolved_at > now() - interval '7 days')
  order by (i.status = 'open') desc, i.created_at desc limit 30;
$$;

-- The shop (for its own orders) or an admin closes an issue and says what was done.
create or replace function public.resolve_order_issue(p_issue uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue public.order_issues;
  v_order public.orders;
begin
  select * into v_issue from public.order_issues where id = p_issue for update;
  if not found then raise exception 'ISSUE_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_issue.order_id;
  if not (public.is_admin() or (public.current_seller_id() is not null and v_order.seller_id = public.current_seller_id())) then
    raise exception 'ISSUE_NOT_FOUND';
  end if;

  update public.order_issues
     set status = 'resolved', resolution_note = left(coalesce(trim(p_note), ''), 500), resolved_at = now(), resolved_by = auth.uid()
   where id = p_issue;

  perform public.notify(v_issue.reporter_id, 'customer', 'order', 'Your problem was marked resolved',
    coalesce(nullif(trim(p_note), ''), 'The shop has looked into it.'), '/orders/' || v_issue.order_id::text, 'issue-resolved:' || p_issue::text);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'seller_cancel_order(uuid, text)', 'report_delivery_failed(uuid, text, text)', 'release_delivery(uuid, text)',
    'seller_request_refund(uuid, integer, text)', 'admin_request_refund(uuid, integer, text)', 'cash_with_riders()',
    'confirm_cash_handover(uuid, uuid)', 'my_cash_to_hand_over()', 'report_order_issue(uuid, text, text)',
    'my_order_issues(uuid)', 'seller_order_issues()', 'resolve_order_issue(uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Internal helper: never callable from a browser.
revoke execute on function public.apply_refund_request(uuid, integer, text, app_role) from public, anon, authenticated;
