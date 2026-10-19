/**
 * Which photograph stands in for a product or a shop.
 *
 * Sellers do not upload photos yet, so every listing borrows one of the stock
 * dishes in `dish-photo.tsx`. The landing page and the marketplace screens
 * share this map so the same biryani plate represents the same shop everywhere.
 *
 * Fixture ids get an exact match; anything coming from Supabase falls back to
 * its category, then to a keyword in its name, then to a hash of its id — the
 * last step only so a catalogue of unknown items looks varied instead of being
 * eight copies of the same plate. Every step is deterministic, which keeps the
 * server and the client markup identical.
 */

import type { DishKey } from './dish-photo';

/** Catalogue category → photograph. */
const ART_BY_CATEGORY: Record<string, DishKey> = {
  biryani: 'biryani',
  kebabs: 'kebab',
  tiffins: 'dosa',
  desserts: 'sweet',
  bakery: 'sweet',
  beverages: 'chai',
  staples: 'kirana',
  household: 'kirana',
  vegetables: 'veg',
  fruits: 'veg'
};

/** Overrides where one category covers several very different dishes. */
const ART_BY_PRODUCT: Record<string, DishKey> = {
  'p-tiffin-idli': 'idli',
  'p-bev-coffee': 'chai',
  'p-bev-irani': 'chai',
  'p-veg-tomato': 'veg',
  'p-veg-onion': 'veg',
  'p-fruit-banana': 'veg',
  'p-fruit-apple': 'veg'
};

const ART_BY_SELLER: Record<string, DishKey> = {
  'seed-paradise': 'biryani',
  'seed-lakshmi': 'idli',
  'seed-charminar': 'chai',
  'seed-balaji': 'kirana',
  'seed-freshfarm': 'veg'
};

/** Matched against a shop's category and name, longest-tail words first. */
const KEYWORDS: Array<readonly [string, DishKey]> = [
  ['biryani', 'biryani'],
  ['kebab', 'kebab'],
  ['tandoor', 'kebab'],
  ['grill', 'kebab'],
  ['barbec', 'kebab'],
  ['idli', 'idli'],
  ['tiffin', 'dosa'],
  ['dosa', 'dosa'],
  ['south indian', 'dosa'],
  ['sweet', 'sweet'],
  ['mithai', 'sweet'],
  ['dessert', 'sweet'],
  ['bakery', 'sweet'],
  ['cake', 'sweet'],
  ['chai', 'chai'],
  ['tea', 'chai'],
  ['coffee', 'chai'],
  ['cafe', 'chai'],
  ['juice', 'chai'],
  ['beverage', 'chai'],
  ['vegetable', 'veg'],
  ['fruit', 'veg'],
  ['veg', 'veg'],
  ['farm', 'veg'],
  ['organic', 'veg'],
  ['kirana', 'kirana'],
  ['grocer', 'kirana'],
  ['provision', 'kirana'],
  ['supermarket', 'kirana'],
  ['staple', 'kirana'],
  ['household', 'kirana'],
  ['store', 'kirana']
];

const SPREAD: DishKey[] = ['biryani', 'dosa', 'kebab', 'idli', 'sweet', 'chai', 'veg', 'kirana'];

function keywordMatch(...haystacks: Array<string | undefined>): DishKey | null {
  const text = haystacks.filter(Boolean).join(' ').toLowerCase();
  if (!text) return null;
  for (const [word, key] of KEYWORDS) {
    if (text.includes(word)) return key;
  }
  return null;
}

/** Stable per-id pick, so an unknown catalogue still looks like a catalogue. */
function spread(id: string): DishKey {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return SPREAD[Math.abs(hash) % SPREAD.length];
}

export function dishForProduct(product: {
  id: string;
  category_key?: string;
  name?: string;
}): DishKey {
  return (
    ART_BY_PRODUCT[product.id] ??
    (product.category_key ? ART_BY_CATEGORY[product.category_key] : undefined) ??
    keywordMatch(product.category_key, product.name) ??
    spread(product.id)
  );
}

export function dishForSeller(seller: {
  id: string;
  category?: string;
  shop_name?: string;
}): DishKey {
  return (
    ART_BY_SELLER[seller.id] ??
    (seller.category ? ART_BY_CATEGORY[seller.category] : undefined) ??
    keywordMatch(seller.category, seller.shop_name) ??
    spread(seller.id)
  );
}
