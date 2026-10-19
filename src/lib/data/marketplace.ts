import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { NearbyCategory, NearbyProduct, NearbySeller, ListingMode } from '@/lib/database.types';
import {
  FIXTURE_CATEGORY_LABELS,
  FIXTURE_PRODUCTS,
  FIXTURE_SELLERS
} from './fixtures';

/**
 * Thin RPC wrapper.
 *
 * The checked-in `Database` type is hand-authored, so supabase-js cannot infer
 * function argument types from it yet. Once `supabase gen types` has run
 * against a real project, this cast can be dropped and `.rpc()` called
 * directly with full inference.
 */
async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const supabase = await createClient();
  // Called as a method, not pulled off the client: `rpc` reads `this.rest`, so
  // a detached reference throws before it ever reaches the network.
  const client = supabase as unknown as {
    rpc: (
      name: string,
      params: Record<string, unknown>
    ) => Promise<{ data: T[] | null; error: { message: string } | null }>;
  };

  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data ?? [];
}

export type MarketplaceQuery = {
  lat: number;
  lng: number;
  radiusKm: number;
  mode?: ListingMode;
  category?: string;
  search?: string;
  sellerId?: string;
  sort?: 'distance' | 'price_asc' | 'price_desc' | 'rating' | 'newest';
  openOnly?: boolean;
  limit?: number;
};

/** True while the app is running on fixtures rather than a live project. */
export function usingFixtures() {
  return !isSupabaseConfigured();
}

function matchesSearch(haystack: string[], search?: string) {
  if (!search?.trim()) return true;
  const needle = search.trim().toLowerCase();
  return haystack.some((value) => value.toLowerCase().includes(needle));
}

function fixtureSellers(query: MarketplaceQuery): NearbySeller[] {
  return FIXTURE_SELLERS.filter((seller) => {
    if (seller.distance_km > query.radiusKm) return false;
    if (query.mode && seller.listing_mode !== query.mode) return false;
    if (query.openOnly && !seller.business_open) return false;
    return matchesSearch([seller.shop_name, seller.category, seller.description], query.search);
  }).sort((a, b) => a.distance_km - b.distance_km);
}

function fixtureProducts(query: MarketplaceQuery): NearbyProduct[] {
  const eligible = new Set(fixtureSellers({ ...query, search: undefined }).map((s) => s.id));

  const rows = FIXTURE_PRODUCTS.filter((product) => {
    if (!eligible.has(product.seller_id)) return false;
    if (query.sellerId && product.seller_id !== query.sellerId) return false;
    if (query.category && product.category_key !== query.category) return false;
    return matchesSearch([product.name, product.description, product.category_key, product.seller_name], query.search);
  });

  const sorted = [...rows];
  switch (query.sort) {
    case 'price_asc':
      sorted.sort((a, b) => a.price - b.price);
      break;
    case 'price_desc':
      sorted.sort((a, b) => b.price - a.price);
      break;
    case 'rating':
      sorted.sort((a, b) => b.rating - a.rating);
      break;
    default:
      sorted.sort((a, b) => a.distance_km - b.distance_km || b.rating - a.rating);
  }

  return query.limit ? sorted.slice(0, query.limit) : sorted;
}

export async function getNearbySellers(query: MarketplaceQuery): Promise<NearbySeller[]> {
  if (usingFixtures()) return fixtureSellers(query);

  return callRpc<NearbySeller>('nearby_sellers', {
    p_lat: query.lat,
    p_lng: query.lng,
    p_radius_km: query.radiusKm,
    p_mode: query.mode ?? null,
    p_open_only: query.openOnly ?? false,
    p_search: query.search ?? null,
    p_limit: query.limit ?? 40,
    p_offset: 0
  });
}

export async function getNearbyProducts(query: MarketplaceQuery): Promise<NearbyProduct[]> {
  if (usingFixtures()) return fixtureProducts(query);

  return callRpc<NearbyProduct>('nearby_products', {
    p_lat: query.lat,
    p_lng: query.lng,
    p_radius_km: query.radiusKm,
    p_mode: query.mode ?? null,
    p_category: query.category ?? null,
    p_search: query.search ?? null,
    p_sort: query.sort ?? 'distance',
    p_seller_id: query.sellerId ?? null,
    p_limit: query.limit ?? 40,
    p_offset: 0
  });
}

export async function getNearbyCategories(query: MarketplaceQuery): Promise<NearbyCategory[]> {
  if (usingFixtures()) {
    const counts = new Map<string, number>();
    for (const product of fixtureProducts({ ...query, category: undefined, search: undefined })) {
      counts.set(product.category_key, (counts.get(product.category_key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({
        category_key: key,
        name: FIXTURE_CATEGORY_LABELS[key] ?? key,
        product_count: count
      }))
      .sort((a, b) => b.product_count - a.product_count);
  }

  return callRpc<NearbyCategory>('nearby_categories', {
    p_lat: query.lat,
    p_lng: query.lng,
    p_radius_km: query.radiusKm,
    p_mode: query.mode ?? null
  });
}

export async function getSellerById(id: string, query: MarketplaceQuery) {
  const sellers = await getNearbySellers({ ...query, limit: 100, search: undefined });
  return sellers.find((seller) => seller.id === id) ?? null;
}

export async function getProductById(id: string, query: MarketplaceQuery) {
  const products = await getNearbyProducts({ ...query, limit: 200, search: undefined, category: undefined });
  return products.find((product) => product.id === id) ?? null;
}
