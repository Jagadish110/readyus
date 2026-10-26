import { config } from '../config.js';
import { cashfree, toRupees } from './cashfree.js';
import { asService } from './db.js';
import { AppError } from './errors.js';

/**
 * The shop's monthly subscription at Cashfree Subscriptions (a recurring mandate the owner
 * approves once). Same rule as order payments: nothing the browser or a webhook body says is
 * believed. After any signal we ask Cashfree for the subscription and its payments, then record
 * the facts. Recording is idempotent, so the browser check, the webhook and the resync job can
 * all report the same charge.
 */

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

type CashfreeSubscription = {
  subscription_id?: string;
  subscription_status?: string;
  subscription_session_id?: string;
};

type CashfreeSubscriptionPayment = {
  cf_payment_id?: string | number;
  payment_id?: string | number;
  payment_status?: string;
  payment_type?: string;
  payment_amount?: number | string;
  payment_time?: string;
  payment_completion_time?: string;
  payment_initiated_date?: string;
};

export const getBilling = (sellerId: string) =>
  asService((q) => q.one<{ b: Billing | null }>('select billing_status($1) as b', [sellerId])).then((row) => row?.b ?? null);

/** Only the owner's own shop, found by who they are. */
export async function shopForOwner(userId: string) {
  const shop = await asService((q) =>
    q.one<{ id: string; shop_name: string; owner_name: string; phone: string; status: string }>(
      'select id, shop_name, owner_name, phone, status from sellers where user_id = $1',
      [userId]
    )
  );
  if (!shop) throw new AppError(404, 'Create your shop first.');
  return shop;
}

/** A mandate that is set up or waiting on the bank: nothing more for the owner to do. */
export const mandateInPlace = (status: string | null) => ['ACTIVE', 'BANK_APPROVAL_PENDING'].includes((status ?? '').toUpperCase());

/** Cashfree ids: letters, digits, underscore and hyphen. Unique per attempt, so a retry never collides. */
export const newSubscriptionId = (sellerId: string, now = Date.now()) => `sub_${sellerId.replace(/-/g, '')}_${now.toString(36)}`;

/**
 * Creates the mandate request. The charge starts when the free trial ends, so approving early
 * costs the shop nothing; if the trial is already over, the first charge is immediate.
 */
export async function createMandate(
  sellerId: string,
  owner: { name: string; phone: string; email: string },
  billing: Billing
) {
  const phone = owner.phone.replace(/\D/g, '').slice(-10);
  if (phone.length !== 10) throw new AppError(400, 'Add a 10-digit phone number to your shop details first.');

  const subscriptionId = newSubscriptionId(sellerId);
  const trialLeft = new Date(billing.trial_ends_at).getTime() > Date.now() + 60 * 60 * 1000;

  const created = await cashfree<CashfreeSubscription>('POST', '/subscriptions', {
    subscription_id: subscriptionId,
    customer_details: {
      customer_name: owner.name.replace(/[^A-Za-z0-9 .]/g, ' ').trim() || 'Shop owner',
      customer_email: owner.email,
      customer_phone: phone
    },
    plan_details: {
      plan_name: 'Localty monthly',
      plan_type: 'PERIODIC',
      plan_amount: toRupees(billing.price_paise),
      plan_currency: 'INR',
      plan_interval_type: 'MONTH',
      plan_intervals: 1
    },
    authorization_details: {
      authorization_amount: 1,
      payment_methods: ['upi', 'enach', 'card']
    },
    subscription_meta: { return_url: `${config.SITE_URL}/business/billing` },
    ...(trialLeft ? { subscription_first_charge_time: billing.trial_ends_at } : {})
  });

  if (!created.subscription_session_id) throw new AppError(502, 'Cashfree did not return a payment session. Please try again.');

  await asService((q) => q.rows('select attach_mandate($1, $2)', [sellerId, subscriptionId]));
  return { subscriptionId, sessionId: created.subscription_session_id };
}

/** A payment's id and time, tolerant of the field names Cashfree has used across API versions. */
export function readPayment(payment: CashfreeSubscriptionPayment, fallbackNow = new Date()) {
  const id = payment.cf_payment_id ?? payment.payment_id;
  const amount = Number(payment.payment_amount);
  const when = new Date(payment.payment_completion_time ?? payment.payment_time ?? payment.payment_initiated_date ?? '');
  return {
    id: id === undefined ? null : String(id),
    amountPaise: Number.isFinite(amount) ? Math.round(amount * 100) : null,
    paidAt: Number.isNaN(when.getTime()) ? fallbackNow : when
  };
}

/**
 * Asks Cashfree for the mandate's status and charges and records what it says. Returns the
 * shop's billing afterwards, or null if this subscription id is not one of ours.
 */
export async function syncSubscription(cashfreeSubscriptionId: string, log?: { warn: (obj: object, msg: string) => void }) {
  const live = await cashfree<CashfreeSubscription>('GET', `/subscriptions/${encodeURIComponent(cashfreeSubscriptionId)}`);

  const sellerId = await asService((q) =>
    q.one<{ s: string | null }>('select update_mandate_status($1, $2) as s', [cashfreeSubscriptionId, live.subscription_status ?? ''])
  ).then((row) => row?.s ?? null);
  if (!sellerId) return null;

  const payments = await cashfree<CashfreeSubscriptionPayment[] | { data?: CashfreeSubscriptionPayment[] }>(
    'GET',
    `/subscriptions/${encodeURIComponent(cashfreeSubscriptionId)}/payments`
  );
  const list = Array.isArray(payments) ? payments : (payments.data ?? []);

  // Oldest first, so each month stacks on the one before it.
  const charges = list
    .filter((payment) => (payment.payment_type ?? 'CHARGE').toUpperCase() === 'CHARGE' && (payment.payment_status ?? '').toUpperCase() === 'SUCCESS')
    .map((payment) => readPayment(payment))
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());

  for (const charge of charges) {
    if (!charge.id || charge.amountPaise === null) {
      log?.warn({ subscription: cashfreeSubscriptionId }, 'subscription payment without an id or amount was skipped');
      continue;
    }
    await asService((q) =>
      q.rows('select record_subscription_payment($1, $2, $3, $4)', [sellerId, charge.id, charge.amountPaise, charge.paidAt])
    );
  }

  return getBilling(sellerId);
}

export async function cancelMandate(cashfreeSubscriptionId: string) {
  await cashfree('POST', `/subscriptions/${encodeURIComponent(cashfreeSubscriptionId)}/manage`, {
    subscription_id: cashfreeSubscriptionId,
    action: 'CANCEL'
  });
  await asService((q) => q.rows('select update_mandate_status($1, $2)', [cashfreeSubscriptionId, 'CANCELLED']));
}
