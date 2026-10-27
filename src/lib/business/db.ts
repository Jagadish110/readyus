import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The checked-in Database type does not describe tables to supabase-js yet, so
 * the seller area talks to it through this minimal local shape (same approach
 * as the account and approvals pages). Row types live next to their callers.
 */
type Outcome = { data: unknown; error: { message: string } | null };
export type Query = PromiseLike<Outcome> & {
  select: (columns?: string) => Query;
  eq: (column: string, value: string) => Query;
  in: (column: string, values: string[]) => Query;
  order: (column: string, opts: { ascending: boolean }) => Query;
  maybeSingle: () => Query;
  single: () => Query;
};
export type Table = {
  select: (columns: string) => Query;
  insert: (values: Record<string, unknown>) => Query;
  update: (values: Record<string, unknown>) => Query;
};
export type LooseDb = {
  from: (table: string) => Table;
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File,
        opts: { contentType: string; upsert: boolean }
      ) => PromiseLike<{ error: { message: string } | null }>;
      remove: (paths: string[]) => PromiseLike<unknown>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
};

export const loose = (client: SupabaseClient<never, never, never> | object) =>
  client as unknown as LooseDb;

export type ShopRow = {
  id: string;
  shop_name: string;
  listing_mode: 'food' | 'items';
  status: 'pending' | 'approved' | 'rejected';
  public_visible: boolean;
  review_note: string;
  business_open: boolean;
  auto_accept: boolean;
  service_radius_km: number | string;
  open_time: string;
  close_time: string;
};

export type ProductRow = {
  id: string;
  name: string;
  description: string;
  category_key: string;
  listing_mode: 'food' | 'items';
  price: number | string;
  mrp: number | string | null;
  unit: string;
  stock: number;
  images: string[];
  veg_type: string;
  spice_level: string;
  prep_minutes: number | null;
  available: boolean;
  approval_status: 'pending' | 'approved' | 'rejected';
  review_note: string;
  rating: number | string;
  rating_count: number;
};

export const SHOP_COLUMNS =
  'id, shop_name, listing_mode, status, public_visible, review_note, business_open, auto_accept, service_radius_km, open_time, close_time';

export const PRODUCT_COLUMNS =
  'id, name, description, category_key, listing_mode, price, mrp, unit, stock, images, veg_type, spice_level, prep_minutes, available, approval_status, review_note, rating, rating_count';

export const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'danger' } as const;
export const STATUS_LABEL = { pending: 'In review', approved: 'Approved', rejected: 'Declined' } as const;
