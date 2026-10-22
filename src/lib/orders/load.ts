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
  accepted_at: string | null;
  delivered_at: string | null;
  cancel_reason: string;
  created_at: string;
  seller: {
    id: string;
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
