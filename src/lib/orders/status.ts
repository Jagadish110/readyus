import { deliveryMinutes } from '@/lib/utils';

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

export const TIMELINE = [
  { key: 'placed', label: 'Order placed', hint: 'Waiting for the shop to accept' },
  { key: 'accepted', label: 'Accepted', hint: 'The shop has your order' },
  { key: 'preparing', label: 'Preparing', hint: 'Being made or packed' },
  { key: 'ready', label: 'Ready', hint: 'Waiting for a delivery partner' },
  { key: 'picked_up', label: 'Picked up', hint: 'On its way to you' },
  { key: 'delivered', label: 'Delivered', hint: 'Enjoy' }
] as const;

/** Which timeline step an order has reached (0-based). */
export function stepOf(status: OrderStatus): number {
  switch (status) {
    case 'accepted':
      return 1;
    case 'preparing':
      return 2;
    case 'packed':
    case 'assigned':
      return 3;
    case 'out_for_delivery':
      return 4;
    case 'delivered':
      return 5;
    default:
      return 0;
  }
}

const ENDED = new Set<OrderStatus>(['rejected', 'cancelled_by_customer', 'cancelled', 'timed_out']);

export const isEnded = (status: OrderStatus) => ENDED.has(status);
export const isActive = (status: OrderStatus) => !ENDED.has(status) && status !== 'delivered';

/** Customers can back out until the shop starts working. */
export const canCancel = (status: OrderStatus) =>
  ['pending', 'payment_required', 'payment_rejected', 'accepted'].includes(status);

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Waiting for the shop',
  payment_required: 'Payment needed',
  customer_claimed_paid: 'Payment being checked',
  payment_confirmed: 'Payment confirmed',
  payment_rejected: 'Payment not found',
  accepted: 'Accepted',
  preparing: 'Preparing',
  packed: 'Ready for pickup',
  assigned: 'Rider assigned',
  out_for_delivery: 'On the way',
  delivered: 'Delivered',
  rejected: 'Declined by the shop',
  cancelled_by_customer: 'Cancelled',
  cancelled: 'Cancelled',
  timed_out: 'Shop did not respond'
};

export const STATUS_TONE: Record<
  OrderStatus,
  'leaf-soft' | 'warning' | 'danger' | 'success' | 'neutral'
> = {
  pending: 'warning',
  payment_required: 'warning',
  customer_claimed_paid: 'warning',
  payment_confirmed: 'leaf-soft',
  payment_rejected: 'danger',
  accepted: 'leaf-soft',
  preparing: 'leaf-soft',
  packed: 'leaf-soft',
  assigned: 'leaf-soft',
  out_for_delivery: 'leaf-soft',
  delivered: 'success',
  rejected: 'danger',
  cancelled_by_customer: 'neutral',
  cancelled: 'neutral',
  timed_out: 'neutral'
};

/**
 * When the order should arrive: the shop's preparation time plus riding time,
 * counted from the moment the shop accepted (or from placing, until then).
 */
export function etaFor(order: {
  accepted_at: string | null;
  created_at: string;
  distance_km: number | string | null;
}, prepMinutes: number) {
  const minutes = deliveryMinutes(Number(order.distance_km ?? 0), prepMinutes);
  const start = new Date(order.accepted_at ?? order.created_at).getTime();
  return { minutes, at: new Date(start + minutes * 60_000) };
}

export function formatClock(date: Date) {
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/** Whole minutes left until `target`, never below zero. */
export function minutesLeft(target: Date, now: number) {
  return Math.max(0, Math.ceil((target.getTime() - now) / 60_000));
}

export function timeAgo(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
