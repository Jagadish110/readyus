import type { NearbySeller } from '@/lib/database.types';
import { formatRupees } from '@/lib/utils';

/**
 * What a shop charges and requires, as customers see it. place_order (migration 0036) applies the
 * same rules when the order is placed, so these are previews of what the database will charge.
 */
export type ShopTerms = Pick<NearbySeller, 'min_order_amount' | 'delivery_fee' | 'free_delivery_above' | 'cod_available'>;

const num = (value: number | string | null | undefined) => Number(value ?? 0) || 0;

/** The delivery charge, in rupees, for food worth `subtotal` rupees. */
export function deliveryFeeFor(terms: ShopTerms, subtotal: number) {
  const fee = num(terms.delivery_fee);
  const freeAbove = num(terms.free_delivery_above);
  if (fee <= 0) return 0;
  return freeAbove > 0 && subtotal >= freeAbove ? 0 : fee;
}

/** "Free delivery", "₹30 delivery", or "₹30 delivery · free above ₹299". */
export function describeDelivery(terms: ShopTerms) {
  const fee = num(terms.delivery_fee);
  const freeAbove = num(terms.free_delivery_above);
  if (fee <= 0) return 'Free delivery';
  return freeAbove > 0 ? `${formatRupees(fee)} delivery · free above ${formatRupees(freeAbove)}` : `${formatRupees(fee)} delivery`;
}

/** How much more food would make delivery free, or null when it already is (or never will be). */
export function moreForFreeDelivery(terms: ShopTerms, subtotal: number) {
  const freeAbove = num(terms.free_delivery_above);
  if (num(terms.delivery_fee) <= 0 || freeAbove <= 0 || subtotal >= freeAbove) return null;
  return freeAbove - subtotal;
}

/** How much more is needed to reach the shop's minimum order, or null when it is met. */
export function shortOfMinimum(terms: ShopTerms, subtotal: number) {
  const minimum = num(terms.min_order_amount);
  return minimum > 0 && subtotal < minimum ? minimum - subtotal : null;
}
