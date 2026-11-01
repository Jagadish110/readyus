-- Localty 0040: the shop accepts first, then the customer pays.
--
-- Before: an online order was created as payment_required, the customer paid at once, and only then did the
-- shop accept or decline. A declined or unanswered order meant a refund.
--
-- Now every order starts as pending and goes to the shop:
--   * The shop accepts (by hand, or automatically when auto_accept is on). An order with money to pay online
--     moves to payment_required, with accepted_at set, and the customer is told to pay.
--   * The payment moves it straight to accepted: the shop already said yes, so it goes to the kitchen.
--   * An accepted order left unpaid for 15 minutes is cancelled, its stock returned, and both sides told.
--   * Cash orders are unchanged: accepting moves them to accepted.
--
-- Orders already waiting for payment under the old flow (payment_required with no accepted_at) still work:
-- paying them moves them to payment_confirmed for the shop to accept, as before.

-- ---------- Accepting, by hand or automatically ----------

create or replace function public.accept_order(p_order uuid, p_actor uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status not in ('pending', 'payment_confirmed') then raise exception 'ORDER_NOT_DECIDABLE'; end if;

  -- clock_timestamp(), not now(): with auto-accept the order was placed in this same transaction, and the
  -- timeline must show "placed" before "accepted".
  insert into public.order_events (order_id, status, actor_id, actor_role, note, created_at)
  values (p_order, 'accepted', p_actor, 'seller', p_note, clock_timestamp());

  if v_order.required_online_paise > v_order.verified_prepaid_paise then
    -- The shop said yes; now the customer pays. The kitchen starts once the money is in.
    update public.orders
       set status = 'payment_required', accepted_at = now()
     where id = p_order;

    perform public.notify(v_order.customer_id, 'customer', 'payment', 'Order accepted: pay now',
      'The shop accepted your order. Pay now so they can start preparing it.',
      '/orders/' || p_order::text, 'order-accepted:' || p_order::text);
  else
    update public.orders set status = 'accepted', accepted_at = now() where id = p_order;

    perform public.notify(v_order.customer_id, 'customer', 'order', 'Order accepted',
      'The shop accepted your order.', '/orders/' || p_order::text, 'order-accepted:' || p_order::text);
  end if;
end;
$function$;

revoke execute on function public.accept_order(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_order(uuid, uuid, text) to service_role;

create or replace function public.maybe_auto_accept(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found or v_order.status not in ('pending', 'payment_confirmed') then return; end if;
  if not coalesce((select auto_accept from public.sellers where id = v_order.seller_id), false) then return; end if;

  perform public.accept_order(p_order, null, 'Accepted automatically');
end;
$function$;

create or replace function public.seller_decide_order(p_order uuid, p_accept boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.orders;
  v_seller uuid := public.current_seller_id();
begin
  select * into v_order from public.orders where id = p_order and seller_id = v_seller for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status not in ('pending', 'payment_confirmed') then raise exception 'ORDER_NOT_DECIDABLE'; end if;

  if p_accept then
    perform public.accept_order(p_order, auth.uid(), 'Order accepted');
  else
    update public.products p
       set stock = p.stock + oi.quantity
      from public.order_items oi
     where oi.order_id = p_order and oi.product_id = p.id;

    update public.orders
       set status = 'rejected', cancelled_at = now(), cancel_reason = p_reason
     where id = p_order;

    insert into public.order_events (order_id, status, actor_id, actor_role, note)
    values (p_order, 'rejected', auth.uid(), 'seller', p_reason);

    perform public.notify(v_order.customer_id, 'customer', 'order', 'Order declined',
      coalesce(nullif(p_reason, ''), 'The shop could not take this order.'),
      '/orders/' || p_order::text, 'order-rejected:' || p_order::text);
  end if;
end;
$function$;

-- ---------- Paying an accepted order sends it to the kitchen ----------

create or replace function public.mark_order_paid(p_cashfree_order text, p_cashfree_payment text, p_amount_paise integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.orders;
  v_window integer;
  v_waiting boolean;
  v_accepted boolean;
begin
  select * into v_order from public.orders
   where cashfree_order_id = p_cashfree_order
   for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if p_amount_paise <> v_order.required_online_paise then
    raise exception 'AMOUNT_MISMATCH';
  end if;

  -- Already recorded.
  if v_order.verified_prepaid_paise >= v_order.required_online_paise then
    return false;
  end if;

  v_waiting := v_order.status in ('payment_required', 'payment_rejected', 'customer_claimed_paid');
  -- Accepted before paying (this flow). An order from before 0040 was paid first and still needs accepting.
  v_accepted := v_order.accepted_at is not null;

  select order_accept_window_seconds into v_window from public.platform_settings where id;

  insert into public.payments (order_id, kind, provider, amount_paise, reference, verified_at, idempotency_key)
  values (
    v_order.id,
    (case when v_order.payment_mode = 'full_prepaid' then 'full_online' else 'cod_prepayment' end)::payment_kind,
    'cashfree',
    p_amount_paise,
    p_cashfree_payment,
    now(),
    'cf:' || p_cashfree_payment
  )
  on conflict (idempotency_key) do nothing;

  -- A payment that lands after the order ended (cancelled, unpaid too long) is still recorded,
  -- so orders_needing_refund sends it back.
  update public.orders
     set verified_prepaid_paise = required_online_paise,
         payment_provider = 'cashfree',
         accept_deadline_at = case
           when v_waiting and not v_accepted then now() + make_interval(secs => v_window)
           else accept_deadline_at
         end,
         status = case
           when v_waiting and v_accepted then 'accepted'::order_status
           when v_waiting then 'payment_confirmed'::order_status
           else status
         end
   where id = v_order.id;

  if v_waiting then
    insert into public.order_events (order_id, status, actor_role, note)
    values (v_order.id, 'payment_confirmed', 'customer', 'Paid online');

    if v_accepted then
      perform public.notify(
        (select user_id from public.sellers where id = v_order.seller_id),
        'seller', 'payment', 'Order paid: start preparing',
        'The customer has paid ' || v_order.order_code || '. The money is on its way to your account.',
        '/business/orders/' || v_order.id::text,
        'paid-online:' || v_order.id::text
      );
      perform public.notify(v_order.customer_id, 'customer', 'payment', 'Payment received',
        'Thank you. The shop is preparing your order.',
        '/orders/' || v_order.id::text, 'payment-ok:' || v_order.id::text);
    else
      perform public.notify(
        (select user_id from public.sellers where id = v_order.seller_id),
        'seller', 'payment', 'Order paid online',
        'The customer has paid. The money is on its way to your account. Accept the order to start.',
        '/business/orders/' || v_order.id::text,
        'paid-online:' || v_order.id::text
      );
      perform public.maybe_auto_accept(v_order.id);
    end if;
  end if;

  return true;
end;
$function$;

revoke execute on function public.mark_order_paid(text, text, integer) from public, anon, authenticated;
grant execute on function public.mark_order_paid(text, text, integer) to service_role;

-- A UPI payment the shop confirms by hand works the same way.
create or replace function public.verify_payment(p_order uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.orders;
  v_seller uuid := public.current_seller_id();
begin
  select * into v_order from public.orders where id = p_order and seller_id = v_seller for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'customer_claimed_paid' then raise exception 'NO_CLAIM_TO_VERIFY'; end if;

  if p_accept then
    update public.payments
       set verified_by = auth.uid(), verified_at = now()
     where order_id = p_order and verified_at is null;

    update public.orders
       set status = case when accepted_at is not null then 'accepted'::order_status else 'payment_confirmed'::order_status end,
           verified_prepaid_paise = v_order.required_online_paise
     where id = p_order;

    insert into public.order_events (order_id, status, actor_id, actor_role, note)
    values (p_order, 'payment_confirmed', auth.uid(), 'seller', 'Payment verified');

    perform public.notify(v_order.customer_id, 'customer', 'payment', 'Payment confirmed',
      case when v_order.accepted_at is not null
        then 'Your payment was verified. The shop is preparing your order.'
        else 'Your payment was verified. The shop will accept your order shortly.' end,
      '/orders/' || p_order::text, 'payment-ok:' || p_order::text);
  else
    update public.orders set status = 'payment_rejected' where id = p_order;

    insert into public.order_events (order_id, status, actor_id, actor_role, note)
    values (p_order, 'payment_rejected', auth.uid(), 'seller', 'Payment could not be verified');

    perform public.notify(v_order.customer_id, 'customer', 'payment', 'Payment not verified',
      'The shop could not find your payment. You can try again.',
      '/orders/' || p_order::text, 'payment-no:' || p_order::text);
  end if;
end;
$function$;

-- ---------- Accepted but never paid ----------

create or replace function public.expire_stale_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count integer := 0;
  v_row record;
begin
  for v_row in
    select id, customer_id, seller_id, status, order_code, accepted_at
    from public.orders
    where (
            -- Old flow: paid first, and the shop never answered.
            status in ('pending', 'payment_confirmed')
            and verified_prepaid_paise > 0
            and accept_deadline_at < now()
          )
       or (
            status in ('payment_required', 'payment_rejected')
            and case
                  -- Accepted, then not paid: the shop is holding the order, so the wait is short.
                  when accepted_at is not null then accepted_at < now() - interval '15 minutes'
                  else created_at < now() - interval '30 minutes'
                end
          )
    for update skip locked
  loop
    update public.products p
       set stock = p.stock + oi.quantity
      from public.order_items oi
     where oi.order_id = v_row.id and oi.product_id = p.id;

    if v_row.status in ('pending', 'payment_confirmed') then
      update public.orders
         set status = 'timed_out', cancelled_at = now(),
             cancel_reason = 'The shop did not respond in time'
       where id = v_row.id;

      insert into public.order_events (order_id, status, note)
      values (v_row.id, 'timed_out', 'The shop did not answer in time');

      perform public.notify(v_row.customer_id, 'customer', 'order', 'Order timed out',
        'The shop did not respond in time. Your payment is being refunded.',
        '/orders/' || v_row.id::text, 'timeout:' || v_row.id::text);
    else
      update public.orders
         set status = 'cancelled', cancelled_at = now(),
             cancel_reason = 'Payment was not completed'
       where id = v_row.id;

      insert into public.order_events (order_id, status, note)
      values (v_row.id, 'cancelled', 'Payment was not completed');

      perform public.notify(v_row.customer_id, 'customer', 'order', 'Order cancelled',
        'The order was cancelled because the payment was not completed.',
        '/orders/' || v_row.id::text, 'unpaid:' || v_row.id::text);

      if v_row.accepted_at is not null then
        perform public.notify((select user_id from public.sellers where id = v_row.seller_id), 'seller', 'order',
          'Order cancelled: not paid',
          v_row.order_code || ' was not paid in time. Do not prepare it.',
          '/business/orders/' || v_row.id::text, 'unpaid-seller:' || v_row.id::text);
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke execute on function public.expire_stale_orders() from public, anon, authenticated;
grant execute on function public.expire_stale_orders() to service_role;

-- ---------- The shop can drop an order it accepted that is still unpaid ----------

create or replace function public.seller_cancel_order(p_order uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $function$
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
  -- An order the shop accepted can also be dropped while it waits for the customer's payment.
  if not (
    v_order.status in ('accepted', 'preparing', 'packed', 'assigned')
    or (v_order.status in ('payment_required', 'payment_rejected', 'customer_claimed_paid') and v_order.accepted_at is not null)
  ) then
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
$function$;

-- ---------- place_order: every order starts with the shop ----------
-- As in 0039, except that the order is created as pending whatever the way to pay, and the shop's alert says
-- when the customer will pay online after it accepts.

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
as $function$
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
  v_label    text;
  v_unit     integer;
  v_extra_id text;
  v_extra    jsonb;
  v_cost     integer;
  v_extras   jsonb;
  v_lines    jsonb := '[]'::jsonb;
  v_short    text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_addr from public.addresses where id = p_address_id and user_id = v_user;
  if not found then raise exception 'ADDRESS_NOT_FOUND'; end if;

  select * into v_seller from public.sellers where id = p_seller_id for update;
  if not found then raise exception 'SELLER_NOT_FOUND'; end if;
  if v_seller.status <> 'approved' or not v_seller.public_visible then
    raise exception 'SELLER_UNAVAILABLE';
  end if;
  if not public.shop_can_trade(p_seller_id) then
    raise exception 'SELLER_NOT_ACCEPTING_ORDERS';
  end if;
  if not public.shop_is_open_now(p_seller_id) then
    raise exception 'SHOP_CLOSED';
  end if;
  if v_seller.location is null then raise exception 'SELLER_LOCATION_REQUIRED'; end if;

  if p_pay_online and not v_seller.prepaid_available then
    raise exception 'PREPAID_NOT_OFFERED';
  end if;
  if not p_pay_online and not v_seller.cod_available then
    raise exception 'COD_NOT_OFFERED';
  end if;

  v_distance := round((st_distance(v_seller.location, v_addr.location) / 1000)::numeric, 2);
  if v_distance > v_seller.service_radius_km then
    raise exception 'OUTSIDE_DELIVERY_RADIUS';
  end if;

  select * into v_settings from public.platform_settings where id;

  for v_item in
    select ci.product_id, ci.variant_id, ci.extra_ids, ci.quantity, p.name, p.price, p.stock,
           p.min_order_qty, p.images, p.variants, p.extra_ids as offered_extras, p.combo_items,
           p.available, p.approval_status, p.public_visible
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
    v_label := '';

    if v_item.variant_id <> '' then
      select coalesce((value ->> 'price')::numeric, v_item.price),
             coalesce((value ->> 'stock')::integer, v_item.stock),
             coalesce(value ->> 'label', '')
        into v_price, v_stock, v_label
      from jsonb_array_elements(v_item.variants)
      where value ->> 'id' = v_item.variant_id
      limit 1;
      if not found then raise exception 'VARIANT_NOT_FOUND:%', v_item.name; end if;
    end if;

    if v_stock < v_item.quantity then
      raise exception 'INSUFFICIENT_STOCK:%', v_item.name;
    end if;

    -- Each extra must be one this dish offers and the shop still sells, and costs its price for this size.
    v_unit := round(v_price * 100)::integer;
    v_extras := '[]'::jsonb;
    foreach v_extra_id in array (select array(select distinct unnest(v_item.extra_ids))) loop
      if not (v_extra_id = any (v_item.offered_extras)) then
        raise exception 'EXTRA_NOT_FOUND:%', v_item.name;
      end if;
      select value into v_extra from jsonb_array_elements(v_seller.extras) where value ->> 'id' = v_extra_id limit 1;
      if not found then raise exception 'EXTRA_NOT_FOUND:%', v_item.name; end if;
      v_cost := round(public.extra_price(v_extra, v_label) * 100)::integer;
      v_unit := v_unit + v_cost;
      v_extras := v_extras || jsonb_build_object('label', v_extra ->> 'label', 'price_paise', v_cost);
    end loop;

    v_subtotal := v_subtotal + v_unit * v_item.quantity;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_item.product_id,
      'name', v_item.name,
      'variant_label', v_label,
      'image_url', v_item.images[1],
      'quantity', v_item.quantity,
      'unit_price_paise', v_unit,
      'combo_items', nullif(v_item.combo_items, '[]'::jsonb),
      'extras', nullif(v_extras, '[]'::jsonb)
    );
  end loop;

  if v_subtotal = 0 then raise exception 'CART_EMPTY'; end if;

  -- Lines of one dish share its stock, so their total must fit.
  select p.name into v_short
  from (select product_id, sum(quantity) as quantity
        from public.cart_items
        where user_id = v_user and seller_id = p_seller_id
        group by product_id) c
  join public.products p on p.id = c.product_id
  where p.stock < c.quantity
  limit 1;
  if found then raise exception 'INSUFFICIENT_STOCK:%', v_short; end if;

  if v_seller.min_order_amount > 0 and v_subtotal < round(v_seller.min_order_amount * 100) then
    raise exception 'BELOW_MIN_ORDER';
  end if;

  v_delivery := case
    when v_seller.free_delivery_above > 0 and v_subtotal >= round(v_seller.free_delivery_above * 100) then 0
    else round(coalesce(v_seller.delivery_fee, 0) * 100)::integer
  end;

  v_platform := 0;
  v_total := v_subtotal + v_delivery + v_platform;

  if p_pay_online then
    v_mode := 'full_prepaid';
    v_required := v_total;
  elsif v_seller.cod_prepayment_required and v_seller.cod_prepayment_amount > 0 then
    v_required := least(round(v_seller.cod_prepayment_amount * 100)::integer, v_total);
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
    -- Every order starts with the shop. Money is taken only after the shop accepts (see accept_order).
    'pending'::order_status,
    v_mode, v_seller.cod_available,
    v_subtotal, v_delivery, v_platform, v_total, v_required,
    to_jsonb(v_addr) - 'location', v_addr.location, v_distance, p_note,
    now() + make_interval(secs => v_settings.order_accept_window_seconds)
  )
  returning id into v_order;

  insert into public.order_items (order_id, product_id, name, variant_label, image_url, quantity, unit_price_paise, line_total_paise, combo_items, extras)
  select v_order, l.product_id, l.name, l.variant_label, l.image_url, l.quantity, l.unit_price_paise,
         l.unit_price_paise * l.quantity, l.combo_items, l.extras
  from jsonb_to_recordset(v_lines) as l(
    product_id uuid, name text, variant_label text, image_url text, quantity integer,
    unit_price_paise integer, combo_items jsonb, extras jsonb
  );

  -- One update per dish with the total of its lines: UPDATE ... FROM uses only one joined row per target.
  update public.products p
     set stock = p.stock - c.quantity
    from (select product_id, sum(quantity)::integer as quantity
          from public.cart_items
          where user_id = v_user and seller_id = p_seller_id
          group by product_id) c
   where c.product_id = p.id;

  delete from public.cart_items where user_id = v_user and seller_id = p_seller_id;

  insert into public.order_events (order_id, status, actor_id, actor_role, note)
  values (v_order, 'pending', v_user, 'customer', 'Order placed');

  perform public.notify(
    v_seller.user_id, 'seller', 'order', 'New order received',
    case when v_required > 0
      then 'Accept it and the customer pays online before you start.'
      else 'Order is waiting for your decision.' end,
    '/business/orders/' || v_order::text,
    'order-placed:' || v_order::text
  );

  perform public.maybe_auto_accept(v_order);

  return v_order;
end;
$function$;
