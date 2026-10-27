import 'server-only';

import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { NearbyCategory, NearbyProduct, NearbySeller, ListingMode } from '@/lib/database.types';
import {
  FIXTURE_CATEGORY_LABELS,
  FIXTURE_PRODUCTS,
  FIXTURE_SELLERS
} from './fixtures';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

type Params = Record<string, string | number | boolean | null | undefined>;

/**
 * Reads the public shop catalogue from the Localty backend. Guests can browse,
 * so no login is needed; the backend serves these as an anonymous visitor.
 */
async function callApi<T>(path: string, params: Params): Promise<T[]> {
  const url = new URL(`${API_URL}/v1/public${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`catalogue ${path}: ${response.status}`);
  return ((await response.json()) as { rows: T[] }).rows;
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

  return callApi<NearbySeller>('/sellers', {
    lat: query.lat,
    lng: query.lng,
    radiusKm: query.radiusKm,
    mode: query.mode,
    openOnly: query.openOnly ?? false,
    search: query.search,
    limit: query.limit ?? 40
  });
}

export async function getNearbyProducts(query: MarketplaceQuery): Promise<NearbyProduct[]> {
  if (usingFixtures()) return fixtureProducts(query);

  return callApi<NearbyProduct>('/products', {
    lat: query.lat,
    lng: query.lng,
    radiusKm: query.radiusKm,
    mode: query.mode,
    category: query.category,
    search: query.search,
    sort: query.sort ?? 'distance',
    sellerId: query.sellerId,
    limit: query.limit ?? 40
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

  return callApi<NearbyCategory>('/categories', {
    lat: query.lat,
    lng: query.lng,
    radiusKm: query.radiusKm,
    mode: query.mode
  });
}

/** The shop's reviewed, unexpired FSSAI number, shown to customers; null when there is none to show. */
export async function getFssaiNumber(sellerId: string): Promise<string | null> {
  if (usingFixtures()) return null;
  try {
    const rows = await callApi<{ seller_id: string; fssai_number: string }>('/licences', { ids: sellerId });
    return rows[0]?.fssai_number ?? null;
  } catch {
    // A missing licence line must never stop the menu from loading.
    return null;
  }
}

export async function getSellerById(id: string, query: MarketplaceQuery) {
  const sellers = await getNearbySellers({ ...query, limit: 100, search: undefined });
  return sellers.find((seller) => seller.id === id) ?? null;
}

export async function getProductById(id: string, query: MarketplaceQuery) {
  const products = await getNearbyProducts({ ...query, limit: 200, search: undefined, category: undefined });
  return products.find((product) => product.id === id) ?? null;
}
