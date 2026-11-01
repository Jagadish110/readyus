-- Localty 0036: each shop sets its own delivery charge, free-delivery amount, minimum order and ways to pay.
--
--   * sellers.delivery_fee is now charged (it was stored but ignored), except when the order reaches
--     sellers.free_delivery_above (0 means never free). The fee is part of the order total, so an online
--     order's split sends it to the shop along with the food, because the shop's own riders deliver.
--   * sellers.prepaid_available (new) lets a shop switch online payment off; cod_available already covers
--     cash on delivery. A shop must keep at least one of the two on.
--   * A customer who picks a way to pay the shop does not offer gets a clear refusal instead of a silent
--     switch to online payment.
--   * The minimum order check (min_order_amount) is unchanged: it was already enforced.

alter table public.sellers add column if not exists prepaid_available boolean not null default true;

alter table public.sellers drop constraint if exists sellers_some_way_to_pay;
alter table public.sellers add constraint sellers_some_way_to_pay check (prepaid_available or cod_available);

-- Sellers update their own row column by column (see the grants in 0011); the new switch joins cod_available.
grant update (prepaid_available) on public.sellers to authenticated;

create or replace function public.place_order(
  p_address_id uuid,
  p_seller_id uuid,
  p_pay_online boolean default false,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_addr     public.addresses;
  v_seller   public.sellers;
  v_settings public.platform_settings;
  v_order    uuid;
  v_subtotal integer := 0;
  v_delivery integer := 0;
  v_platform integer := 0;
  v_total    integer := 0;
  v_required integer := 0;
  v_mode     payment_mode;
  v_distance numeric;
  v_item     record;
  v_price    numeric;
  v_stock    integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_addr from public.addresses where id = p_address_id and user_id = v_user;
  if not found then raise exception 'ADDRESS_NOT_FOUND'; end if;

  select * into v_seller from public.sellers where id = p_seller_id for update;
  if not found then raise exception 'SELLER_NOT_FOUND'; end if;
  if v_seller.status <> 'approved' or not v_seller.public_visible then
    raise exception 'SELLER_UNAVAILABLE';
  end if;
  -- A shop whose subscription has lapsed takes no new orders; orders already placed carry on.
  if not public.shop_can_trade(p_seller_id) then
    raise exception 'SELLER_NOT_ACCEPTING_ORDERS';
  end if;
  -- Closed (switched off, or outside its opening hours in India): browsing is fine, ordering is not.
  if not public.shop_is_open_now(p_seller_id) then
    raise exception 'SHOP_CLOSED';
  end if;
  if v_seller.location is null then raise exception 'SELLER_LOCATION_REQUIRED'; end if;

  -- The way to pay must be one this shop offers.
  if p_pay_online and not v_seller.prepaid_available then
    raise exception 'PREPAID_NOT_OFFERED';
  end if;
  if not p_pay_online and not v_seller.cod_available then
    raise exception 'COD_NOT_OFFERED';
  end if;

  -- The radius rule is re-checked at purchase time, not just at browse time.
  v_distance := round((st_distance(v_seller.location, v_addr.location) / 1000)::numeric, 2);
  if v_distance > v_seller.service_radius_km then
    raise exception 'OUTSIDE_DELIVERY_RADIUS';
  end if;

  select * into v_settings from public.platform_settings where id;

  -- Price every line from the products table, locking rows against races.
  for v_item in
    select ci.product_id, ci.variant_id, ci.quantity, p.name, p.price, p.stock,
           p.min_order_qty, p.images, p.variants, p.available, p.approval_status, p.public_visible
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    where ci.user_id = v_user and ci.seller_id = p_seller_id
    for update of p
  loop
    if not v_item.available or v_item.approval_status <> 'approved' or not v_item.public_visible then
      raise exception 'PRODUCT_UNAVAILABLE:%', v_item.name;
    end if;
    if v_item.quantity < v_item.min_order_qty then
      raise exception 'BELOW_MIN_QUANTITY:%', v_item.name;
    end if;

    v_price := v_item.price;
    v_stock := v_item.stock;

    -- A chosen variant overrides the base price and stock.
    if v_item.variant_id <> '' then
      select coalesce((value ->> 'price')::numeric, v_item.price),
             coalesce((value ->> 'stock')::integer, v_item.stock)
        into v_price, v_stock
      from jsonb_array_elements(v_item.variants)
      where value ->> 'id' = v_item.variant_id
      limit 1;
      if not found then raise exception 'VARIANT_NOT_FOUND:%', v_item.name; end if;
    end if;

    if v_stock < v_item.quantity then
      raise exception 'INSUFFICIENT_STOCK:%', v_item.name;
    end if;

    v_subtotal := v_subtotal + round(v_price * 100)::integer * v_item.quantity;
  end loop;

  if v_subtotal = 0 then raise exception 'CART_EMPTY'; end if;

  if v_seller.min_order_amount > 0 and v_subtotal < round(v_seller.min_order_amount * 100) then
    raise exception 'BELOW_MIN_ORDER';
  end if;

  -- The shop's own delivery charge, waived once the food reaches its free-delivery amount.
  v_delivery := case
    when v_seller.free_delivery_above > 0 and v_subtotal >= round(v_seller.free_delivery_above * 100) then 0
    else round(coalesce(v_seller.delivery_fee, 0) * 100)::integer
  end;

  -- No platform fee at launch; platform_settings.platform_fee_paise stays unused.
  v_platform := 0;
  v_total := v_subtotal + v_delivery + v_platform;

  -- Resolve the one business mode this order will keep for life.
  if p_pay_online then
    v_mode := 'full_prepaid';
    v_required := v_total;
  elsif v_seller.cod_prepayment_required and v_seller.cod_prepayment_amount > 0 then
    v_required := least(round(v_seller.cod_prepayment_amount * 100)::integer, v_total);
    -- A prepayment at or above the total collapses to a fully prepaid order.
    v_mode := case when v_required >= v_total then 'full_prepaid' else 'cod_partial_prepayment' end;
  else
    v_mode := 'normal_cod';
    v_required := 0;
  end if;

  insert into public.orders (
    customer_id, seller_id, status, payment_mode, cod_available_at_checkout,
    subtotal_paise, delivery_fee_paise, platform_fee_paise, total_paise, required_online_paise,
    delivery_address, delivery_location, distance_km, customer_note,
    accept_deadline_at
  ) values (
    v_user, p_seller_id,
    case when v_required > 0 then 'payment_required'::order_status else 'pending'::order_status end,
    v_mode, v_seller.cod_available,
    v_subtotal, v_delivery, v_platform, v_total, v_required,
    to_jsonb(v_addr) - 'location', v_addr.location, v_distance, p_note,
    now() + make_interval(secs => v_settings.order_accept_window_seconds)
  )
  returning id into v_order;

  -- Snapshot the lines and decrement stock.
  insert into public.order_items (order_id, product_id, name, variant_label, image_url, quantity, unit_price_paise, line_total_paise)
  select v_order, ci.product_id, p.name,
         coalesce((
           select value ->> 'label' from jsonb_array_elements(p.variants)
           where value ->> 'id' = ci.variant_id limit 1
         ), ''),
         p.images[1],
         ci.quantity,
         round(coalesce((
           select (value ->> 'price')::numeric from jsonb_array_elements(p.variants)
           where value ->> 'id' = ci.variant_id limit 1
         ), p.price) * 100)::integer,
         round(coalesce((
           select (value ->> 'price')::numeric from jsonb_array_elements(p.variants)
           where value ->> 'id' = ci.variant_id limit 1
         ), p.price) * 100)::integer * ci.quantity
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.user_id = v_user and ci.seller_id = p_seller_id;

  update public.products p
     set stock = p.stock - ci.quantity
    from public.cart_items ci
   where ci.product_id = p.id and ci.user_id = v_user and ci.seller_id = p_seller_id;

  delete from public.cart_items where user_id = v_user and seller_id = p_seller_id;

  insert into public.order_events (order_id, status, actor_id, actor_role, note)
  values (v_order, 'pending', v_user, 'customer', 'Order placed');

  perform public.notify(
    v_seller.user_id, 'seller', 'order', 'New order received',
    'Order is waiting for your decision.', '/business/orders/' || v_order::text,
    'order-placed:' || v_order::text
  );

  perform public.maybe_auto_accept(v_order);

  return v_order;
end;
$$;

-- "Can this shop take online payment?" now also respects the shop's own switch.
create or replace function public.shops_accepting_online(p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.seller_id
  from public.seller_payout_accounts a
  join public.sellers s on s.id = a.seller_id
  where a.seller_id = any (p_ids) and a.status = 'activated' and s.prepaid_available;
$$;

revoke execute on function public.shops_accepting_online(uuid[]) from public;
grant execute on function public.shops_accepting_online(uuid[]) to anon, authenticated;
