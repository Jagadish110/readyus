import type { ClassValue } from 'clsx';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Money is stored in paise. Render it, never compute with the rendered value. */
export function formatPaise(paise: number, symbol = '₹') {
  const rupees = paise / 100;
  return `${symbol}${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

export function formatRupees(amount: number, symbol = '₹') {
  return `${symbol}${Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: Number(amount) % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

export function formatDistance(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/**
 * Door-to-door estimate: the shop's own preparation time plus about four
 * minutes of riding per kilometre, rounded up to the next five.
 */
export function deliveryMinutes(distanceKm: number, prepMinutes: number) {
  const total = Math.max(prepMinutes, 10) + Math.ceil(distanceKm * 4);
  return Math.ceil(total / 5) * 5;
}

/** Percentage saved, or null when there is no genuine discount. */
export function discountPercent(price: number, mrp: number | null | undefined) {
  if (!mrp || mrp <= price) return null;
  return Math.round(((mrp - price) / mrp) * 100);
}
