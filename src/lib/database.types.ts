/**
 * Hand-authored to match supabase/migrations. Once a project is connected,
 * regenerate with:
 *   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts
 */

export type AppRole = 'customer' | 'seller' | 'delivery' | 'admin';
export type ListingMode = 'food' | 'items';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type PaymentMode = 'full_prepaid' | 'normal_cod' | 'cod_partial_prepayment';
export type PaymentKind = 'full_online' | 'cod_prepayment' | 'cod_cash' | 'refund';
export type DeliveryStatus = 'claimed' | 'picked_up' | 'delivered' | 'cancelled';

export type OrderStatus =
  | 'pending'
  | 'payment_required'
  | 'customer_claimed_paid'
  | 'payment_confirmed'
  | 'payment_rejected'
  | 'accepted'
  | 'preparing'
  | 'packed'
  | 'assigned'
  | 'out_for_delivery'
  | 'delivered'
  | 'rejected'
  | 'cancelled_by_customer'
  | 'cancelled'
  | 'timed_out';

export type ProductVariant = {
  id: string;
  label: string;
  price: number;
  mrp?: number | null;
  stock?: number | null;
};

export type NearbySeller = {
  id: string;
  shop_name: string;
  category: string;
  listing_mode: ListingMode;
  description: string;
  address: string;
  city: string;
  photo_url: string | null;
  banner_url: string | null;
  rating: number;
  rating_count: number;
  business_open: boolean;
  /** 'HH:MM', India time. Absent on sample data. */
  open_time?: string;
  close_time?: string;
  eta_minutes: number;
  min_order_amount: number;
  delivery_fee: number;
  free_delivery_above: number;
  cod_available: boolean;
  distance_km: number;
};

export type NearbyProduct = {
  id: string;
  seller_id: string;
  seller_name: string;
  name: string;
  description: string;
  category_key: string;
  listing_mode: ListingMode;
  price: number;
  mrp: number | null;
  unit: string;
  stock: number;
  min_order_qty: number;
  images: string[];
  veg_type: string;
  variants: ProductVariant[];
  rating: number;
  rating_count: number;
  business_open: boolean;
  eta_minutes: number;
  distance_km: number;
};

export type NearbyCategory = {
  category_key: string;
  name: string;
  product_count: number;
};

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  status: 'active' | 'suspended' | 'disabled';
  search_radius_km: number;
  created_at: string;
  updated_at: string;
};

export type Address = {
  id: string;
  user_id: string;
  label: string;
  recipient: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  pincode: string;
  is_default: boolean;
  created_at: string;
};

export type Seller = {
  id: string;
  user_id: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  category: string;
  listing_mode: ListingMode;
  description: string;
  address: string;
  city: string;
  pincode: string;
  service_radius_km: number;
  open_time: string;
  close_time: string;
  business_open: boolean;
  auto_accept: boolean;
  eta_minutes: number;
  status: ApprovalStatus;
  public_visible: boolean;
  review_note: string;
  min_order_amount: number;
  delivery_fee: number;
  free_delivery_above: number;
  cod_available: boolean;
  cod_prepayment_required: boolean;
  cod_prepayment_amount: number;
  upi_id: string;
  upi_qr_url: string | null;
  photo_url: string | null;
  banner_url: string | null;
  rating: number;
  rating_count: number;
  created_at: string;
};

export type Product = {
  id: string;
  seller_id: string;
  name: string;
  description: string;
  category_key: string;
  listing_mode: ListingMode;
  price: number;
  mrp: number | null;
  unit: string;
  stock: number;
  min_order_qty: number;
  images: string[];
  veg_type: string;
  spice_level: string;
  prep_minutes: number | null;
  tags: string[];
  variants: ProductVariant[];
  available: boolean;
  public_visible: boolean;
  approval_status: ApprovalStatus;
  review_note: string;
  rating: number;
  rating_count: number;
  created_at: string;
};

export type Order = {
  id: string;
  order_code: string;
  customer_id: string;
  seller_id: string;
  status: OrderStatus;
  payment_mode: PaymentMode;
  subtotal_paise: number;
  delivery_fee_paise: number;
  platform_fee_paise: number;
  total_paise: number;
  required_online_paise: number;
  verified_prepaid_paise: number;
  cash_collected_paise: number;
  refunded_paise: number;
  delivery_address: Record<string, unknown>;
  distance_km: number | null;
  customer_note: string;
  delivery_code: string;
  accept_deadline_at: string | null;
  accepted_at: string | null;
  packed_at: string | null;
  delivered_at: string | null;
  cancel_reason: string;
  created_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  name: string;
  variant_label: string;
  image_url: string | null;
  quantity: number;
  unit_price_paise: number;
  line_total_paise: number;
};

export type Notification = {
  id: string;
  user_id: string;
  role: AppRole;
  channel: 'order' | 'approval' | 'payment' | 'delivery' | 'system';
  title: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

/**
 * Structural type consumed by the Supabase clients. Kept permissive on the
 * table map so hand-written queries compile before generation runs.
 */
export type Database = {
  public: {
    Tables: Record<string, { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> }>;
    Views: Record<string, { Row: Record<string, unknown> }>;
    Functions: {
      nearby_sellers: {
        Args: {
          p_lat: number;
          p_lng: number;
          p_radius_km?: number;
          p_mode?: ListingMode | null;
          p_open_only?: boolean;
          p_search?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: NearbySeller[];
      };
      nearby_products: {
        Args: {
          p_lat: number;
          p_lng: number;
          p_radius_km?: number;
          p_mode?: ListingMode | null;
          p_category?: string | null;
          p_search?: string | null;
          p_sort?: string;
          p_seller_id?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: NearbyProduct[];
      };
      nearby_categories: {
        Args: {
          p_lat: number;
          p_lng: number;
          p_radius_km?: number;
          p_mode?: ListingMode | null;
        };
        Returns: NearbyCategory[];
      };
    };
    CompositeTypes: Record<string, never>;
    Enums: {
      app_role: AppRole;
      listing_mode: ListingMode;
      approval_status: ApprovalStatus;
      order_status: OrderStatus;
      payment_mode: PaymentMode;
      payment_kind: PaymentKind;
      delivery_status: DeliveryStatus;
    };
  };
};
