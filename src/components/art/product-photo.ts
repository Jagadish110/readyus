/**
 * Per-listing photography.
 *
 * `dish-map.ts` picks a generic dish for anything the catalogue throws at it;
 * this narrows that down where we have a photo of the actual item, so no two
 * listings on a page show the same picture. Files live in
 * public/food/products, sources in public/food/CREDITS.md.
 */

import type { PhotoKey } from './dish-photo';
import { dishForProduct } from './dish-map';

/** Fixture ids that have a photo of their own. */
export const PRODUCT_PHOTO_IDS = [
  'p-biryani-chicken',
  'p-biryani-mutton',
  'p-biryani-veg',
  'p-dessert-dkm',
  'p-tiffin-pesarattu',
  'p-bev-coffee',
  'p-bakery-osmania',
  'p-bakery-puff',
  'p-gro-rice',
  'p-gro-dal',
  'p-gro-oil',
  'p-hh-detergent',
  'p-veg-tomato',
  'p-veg-onion',
  'p-fruit-banana',
  'p-fruit-apple'
] as const;

export type ProductPhotoId = (typeof PRODUCT_PHOTO_IDS)[number];

const WITH_OWN_PHOTO = new Set<string>(PRODUCT_PHOTO_IDS);

/**
 * The photo for a listing: its own where one exists, otherwise the generic
 * dish `dish-map` chose.
 */
export function photoForProduct(product: {
  id: string;
  category_key?: string;
  name?: string;
}): PhotoKey {
  if (WITH_OWN_PHOTO.has(product.id)) return product.id as PhotoKey;
  return dishForProduct(product);
}
