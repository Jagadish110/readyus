-- Localty 0032: a customer can ask for their account to be erased, and an unused table goes.
--
-- Order records must be kept (accounting, disputes, the shop's own books), but they do not need to
-- identify the customer afterwards. Erasing keeps the order, its items and amounts, and removes what
-- says who the customer was and where they live.

-- The first version of notifications planned device tokens here; Web Push (0029) replaced it.
drop table if exists public.notification_devices;

create or replace function public.anonymize_customer(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.sellers where user_id = p_user) then raise exception 'HAS_SHOP'; end if;
  if exists (select 1 from public.delivery_agents where user_id = p_user) then raise exception 'HAS_DELIVERY_PROFILE'; end if;
  if exists (
    select 1 from public.orders
    where customer_id = p_user
      and status not in ('delivered', 'rejected', 'cancelled_by_customer', 'cancelled', 'timed_out', 'delivery_failed')
  ) then
    raise exception 'ACTIVE_ORDERS';
  end if;
  -- Money still on its way back must finish first, or the refund job would have nobody to tell.
  if exists (
    select 1 from public.orders
    where customer_id = p_user and refund_target_paise > refunded_paise
      and status in ('delivered', 'delivery_failed')
  ) then
    raise exception 'REFUND_PENDING';
  end if;

  -- Keep the order; keep only the town and pincode of where it went, and a point precise to about a kilometre.
  update public.orders
     set delivery_address = jsonb_build_object('city', delivery_address -> 'city', 'pincode', delivery_address -> 'pincode'),
         delivery_location = st_setsrid(st_snaptogrid(delivery_location::geometry, 0.01), 4326)::geography,
         customer_note = ''
   where customer_id = p_user;

  delete from public.addresses where user_id = p_user;
  delete from public.cart_items where user_id = p_user;
  delete from public.favourite_sellers where user_id = p_user;
  delete from public.favourite_products where user_id = p_user;
  delete from public.notifications where user_id = p_user;
  delete from public.push_subscriptions where user_id = p_user;
  delete from public.reviews where author_id = p_user;
  delete from public.order_issues where reporter_id = p_user;

  update public.profiles
     set full_name = 'Deleted user', phone = null, email = null, avatar_url = null, status = 'disabled'
   where id = p_user;
  delete from public.user_roles where user_id = p_user and role <> 'customer';

  insert into public.audit_logs (actor_id, action, entity, entity_id, data)
  values (null, 'account.erased', 'profile', p_user::text, '{}'::jsonb);
end;
$$;

revoke execute on function public.anonymize_customer(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_customer(uuid) to service_role;
