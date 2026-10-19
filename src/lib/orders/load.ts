import { ordersDb, row, rows, type Db } from './db';
import type { OrderStatus } from './status';

export type OrderCore = {
  id: string;
  order_code: string;
  status: OrderStatus;
  payment_mode: 'full_prepaid' | 'normal_cod' | 'cod_partial_prepayment';
  required_online_paise: number;
  verified_prepaid_paise: number;
  subtotal_paise: number;
  delivery_fee_paise: number;
  platform_fee_paise: number;
  total_paise: number;
  delivery_address: {
    label?: string;
    recipient?: string;
    phone?: string;
    line1?: string;
    line2?: string;
    landmark?: string;
    city?: string;
    pincode?: string;
  };
  distance_km: number | string | null;
  customer_note: string;
  accept_deadline_at: string | null;
  accepted_at: string | null;
  delivered_at: string | null;
  cancel_reason: string;
  created_at: string;
  seller: {
    shop_name: string;
    phone: string | null;
    eta_minutes: number | null;
    upi_id: string | null;
    address: string | null;
  } | null;
};

export type OrderItem = {
  id: string;
  product_id: string | null;
  name: string;
  variant_label: string;
  quantity: number;
  unit_price_paise: number;
  line_total_paise: number;
};

export type OrderEvent = { status: OrderStatus; created_at: string; note: string };

export type MapInfo = {
  shop_lat: number;
  shop_lng: number;
  dest_lat: number;
  dest_lng: number;
  rider_name: string | null;
  rider_phone: string | null;
  rider_lat: number | null;
  rider_lng: number | null;
  rider_updated_at: string | null;
  delivery_status: 'claimed' | 'picked_up' | 'delivered' | 'cancelled' | null;
};

export type MyReview = { product_id: string | null; rating: number };

export type OrderView = {
  order: OrderCore;
  items: OrderItem[];
  events: OrderEvent[];
  map: MapInfo | null;
  code: string | null;
  reviews: MyReview[];
};

export const ORDER_COLUMNS =
  'id, order_code, status, payment_mode, required_online_paise, verified_prepaid_paise, ' +
  'subtotal_paise, delivery_fee_paise, platform_fee_paise, total_paise, delivery_address, ' +
  'distance_km, customer_note, accept_deadline_at, accepted_at, delivered_at, cancel_reason, ' +
  'created_at, seller:sellers(shop_name, phone, eta_minutes, upi_id, address)';

/** One customer order with everything its page shows. Works with either client. */
export async function loadOrder(client: object, id: string): Promise<OrderView | null> {
  const db: Db = ordersDb(client);

  const orderResult = await db.from('orders').select(ORDER_COLUMNS).eq('id', id).maybeSingle();
  const order = row<OrderCore>(orderResult);
  if (!order) return null;

  const [items, events, map, code, reviews] = await Promise.all([
    db
      .from('order_items')
      .select('id, product_id, name, variant_label, quantity, unit_price_paise, line_total_paise')
      .eq('order_id', id),
    db
      .from('order_events')
      .select('status, created_at, note')
      .eq('order_id', id)
      .order('created_at', { ascending: true }),
    db.rpc('order_map', { p_order: id }),
    db.rpc('order_delivery_code', { p_order: id }),
    db.from('reviews').select('product_id, rating').eq('order_id', id)
  ]);

  return {
    order,
    items: rows<OrderItem>(items),
    events: rows<OrderEvent>(events),
    map: row<MapInfo>(map),
    code: typeof code.data === 'string' ? code.data : null,
    reviews: rows<MyReview>(reviews)
  };
}
