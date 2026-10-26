import { serverApi } from '@/lib/api/server';

export type BillingState = 'trialing' | 'active' | 'past_due' | 'suspended';

export type Billing = {
  state: BillingState;
  price_paise: number;
  trial_ends_at: string;
  paid_through: string | null;
  access_until: string;
  cancelled: boolean;
  mandate_status: string | null;
  grace_days: number;
};

/** The owner's subscription, or null when the shop is not approved yet or the server is down. */
export async function loadBilling(): Promise<Billing | null> {
  const result = await serverApi<{ billing: Billing | null }>('/v1/seller/billing');
  return result.ok ? result.data.billing : null;
}

/** A mandate that is set up or waiting on the bank: nothing more for the owner to do. */
export const mandateInPlace = (billing: Billing) =>
  ['ACTIVE', 'BANK_APPROVAL_PENDING'].includes((billing.mandate_status ?? '').toUpperCase()) && !billing.cancelled;

/** Whole days from now until `iso`, never below zero. */
export function daysUntil(iso: string, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
}

export const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
