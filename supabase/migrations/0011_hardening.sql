-- ReadyUs 0011: close privilege gaps left by 0009 and 0010.
--
-- 1. An owner's RLS policy lets them write any column of their own row, which
--    included approval state: a seller could set their own shop to approved.
--    Column grants fix that for the `authenticated` role; security-definer
--    functions and the service role are unaffected, so admin review still works.
-- 2. Postgres grants EXECUTE on new functions to PUBLIC. Internal helpers and
--    anything that needs a signed-in user are narrowed explicitly.

-- ---------- Table privileges ----------

-- TRUNCATE ignores row level security, so nobody but the owner gets it.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
-- The public site only ever reads; every write needs an account.
revoke insert, update, delete on all tables in schema public from anon;

-- Profiles: status is an admin decision, not a user setting.
revoke insert, update on public.profiles from authenticated;
grant update (full_name, phone, email, avatar_url, search_radius_km, last_seen_at)
  on public.profiles to authenticated;

-- Sellers: approval, visibility, review fields and ratings are server-owned.
revoke insert, update on public.sellers from authenticated;
grant insert (
  user_id, shop_name, owner_name, phone, category, listing_mode, description,
  address, city, pincode, location, service_radius_km, open_time, close_time,
  eta_minutes, min_order_amount, delivery_fee, free_delivery_above,
  cod_available, cod_prepayment_required, cod_prepayment_amount,
  upi_id, upi_qr_url, photo_url, banner_url
) on public.sellers to authenticated;
grant update (
  shop_name, owner_name, phone, category, listing_mode, description,
  address, city, pincode, location, service_radius_km, open_time, close_time,
  business_open, auto_accept, eta_minutes, min_order_amount, delivery_fee,
  free_delivery_above, cod_available, cod_prepayment_required,
  cod_prepayment_amount, upi_id, upi_qr_url, photo_url, banner_url
) on public.sellers to authenticated;

-- Products: approval and ratings are not the seller's to set.
revoke insert, update on public.products from authenticated;
grant insert (
  seller_id, name, description, category_key, listing_mode, price, mrp, unit,
  stock, min_order_qty, images, veg_type, spice_level, prep_minutes, tags,
  variants, available
) on public.products to authenticated;
grant update (
  name, description, category_key, listing_mode, price, mrp, unit,
  stock, min_order_qty, images, veg_type, spice_level, prep_minutes, tags,
  variants, available
) on public.products to authenticated;

-- Delivery partners: eligibility comes from a seller's invite, never self-set.
revoke insert, update on public.delivery_agents from authenticated;
grant insert (user_id, full_name, phone, vehicle) on public.delivery_agents to authenticated;
grant update (full_name, phone, vehicle, available, location, location_updated_at)
  on public.delivery_agents to authenticated;

-- Recipients may mark a notification read, nothing else.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------- Function privileges ----------

-- Internal: only other functions (as owner) or the service role call these.
revoke execute on function public.notify(uuid, app_role, notification_channel, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.expire_stale_orders() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
grant execute on function public.expire_stale_orders() to service_role;

-- Need a signed-in user: already granted to authenticated in 0010.
revoke execute on function public.apply_to_sell(text, text, text, text, listing_mode, text, text, text) from public, anon;
revoke execute on function public.apply_to_deliver(text, text, text) from public, anon;
revoke execute on function public.redeem_delivery_invite(text) from public, anon;
revoke execute on function public.place_order(uuid, uuid, boolean, text) from public, anon;
revoke execute on function public.claim_payment(uuid, text) from public, anon;
revoke execute on function public.verify_payment(uuid, boolean) from public, anon;
revoke execute on function public.seller_decide_order(uuid, boolean, text) from public, anon;
revoke execute on function public.seller_set_stage(uuid, order_status) from public, anon;
revoke execute on function public.available_deliveries() from public, anon;
revoke execute on function public.claim_delivery(uuid) from public, anon;
revoke execute on function public.pickup_delivery(uuid) from public, anon;
revoke execute on function public.complete_delivery(uuid, text) from public, anon;
revoke execute on function public.cancel_order(uuid, text) from public, anon;
revoke execute on function public.review_seller(uuid, boolean, text) from public, anon;
revoke execute on function public.review_product(uuid, boolean, text) from public, anon;

-- The RLS policies call these as the querying role, so they stay executable.
grant execute on function public.has_role(app_role) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.current_seller_id() to anon, authenticated;
grant execute on function public.current_agent_id() to anon, authenticated;

-- The updated_at trigger does not need to resolve anything from search_path.
alter function public.touch_updated_at() set search_path = '';
