-- Localty 0035: a declined shop that applies again goes back into the review queue.
--
-- apply_to_sell updated the details on re-application but left the shop 'rejected', so it never
-- showed on the admin Approvals page, and its notification key was reused, so no admin was told.
-- Now a rejected shop becomes 'pending' again with the old decline note cleared, and every
-- application (first or repeat) sends admins a fresh notification. Approved and pending shops keep
-- their status when they send updated details.

create or replace function public.apply_to_sell(
  p_shop_name text,
  p_owner_name text,
  p_phone text,
  p_category text,
  p_listing_mode listing_mode,
  p_address text,
  p_city text,
  p_pincode text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  insert into public.sellers (user_id, shop_name, owner_name, phone, category, listing_mode, address, city, pincode)
  values (auth.uid(), p_shop_name, p_owner_name, p_phone, p_category, p_listing_mode, p_address, p_city, p_pincode)
  on conflict (user_id) do update
    set shop_name = excluded.shop_name,
        owner_name = excluded.owner_name,
        phone = excluded.phone,
        category = excluded.category,
        listing_mode = excluded.listing_mode,
        address = excluded.address,
        city = excluded.city,
        pincode = excluded.pincode,
        status = case when public.sellers.status = 'rejected' then 'pending'::approval_status else public.sellers.status end,
        review_note = case when public.sellers.status = 'rejected' then '' else public.sellers.review_note end,
        reviewed_by = case when public.sellers.status = 'rejected' then null else public.sellers.reviewed_by end,
        reviewed_at = case when public.sellers.status = 'rejected' then null else public.sellers.reviewed_at end
  returning id into v_seller;

  insert into public.user_roles (user_id, role) values (auth.uid(), 'seller')
  on conflict do nothing;

  -- Tell every admin there is something to review, every time one arrives.
  insert into public.notifications (user_id, role, channel, title, body, href, dedupe_key)
  select ur.user_id, 'admin', 'approval',
         'New shop application',
         p_shop_name || ' applied to sell on Localty.',
         '/admin/approvals',
         'seller-application:' || v_seller::text || ':' || ur.user_id::text || ':' || clock_timestamp()::text
  from public.user_roles ur
  where ur.role = 'admin'
  on conflict (dedupe_key) do nothing;

  return v_seller;
end;
$$;

revoke execute on function public.apply_to_sell(text, text, text, text, listing_mode, text, text, text) from public, anon;
