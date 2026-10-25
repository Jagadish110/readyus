import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export class CashfreeError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const API_VERSION = '2023-08-01';
const BASE = config.CASHFREE_ENV === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';

type Options = { method?: 'PATCH' | 'PUT' };

/** Thin fetch wrapper with a timeout; the official SDK adds nothing we need. */
export async function cashfree<T>(path: string, body?: Record<string, unknown>, options: Options = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers: {
      'x-client-id': config.CASHFREE_APP_ID,
      'x-client-secret': config.CASHFREE_SECRET_KEY,
      'x-api-version': API_VERSION,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000)
  });

  const json = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new CashfreeError(json.message ?? 'Cashfree request failed', response.status);
  return json as T;
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Webhook signature: base64 HMAC-SHA256 of `timestamp + rawBody` with the secret key. */
export function verifyWebhookSignature(rawBody: string, timestamp: string, signature: string) {
  const expected = createHmac('sha256', config.CASHFREE_SECRET_KEY).update(timestamp + rawBody).digest('base64');
  return safeEqual(expected, signature);
}

/** Cashfree talks rupees with decimals; the database keeps paise. */
export const toRupees = (paise: number) => (paise / 100).toFixed(2);
export const toPaise = (rupees: number) => Math.round(rupees * 100);

export type CashfreePayment = { cf_payment_id: string | number; payment_status: string; payment_amount: number };

/** The successful payment on a Cashfree order, if any. */
export async function successfulPayment(cashfreeOrderId: string) {
  const payments = await cashfree<CashfreePayment[]>(`/pg/orders/${encodeURIComponent(cashfreeOrderId)}/payments`);
  return payments.find((item) => item.payment_status === 'SUCCESS') ?? null;
}

/** Maps a Cashfree Easy Split vendor status onto the few states a shop sees. */
export type PayoutStatus = 'created' | 'under_review' | 'needs_clarification' | 'activated' | 'rejected';

export function toPayoutStatus(value: string | undefined): PayoutStatus {
  switch (value?.toUpperCase()) {
    case 'ACTIVE':
      return 'activated';
    case 'REJECTED':
    case 'BLOCKED':
    case 'DELETED':
      return 'rejected';
    case 'BANK_DETAILS_INVALID':
    case 'ACTION_REQUIRED':
      return 'needs_clarification';
    case 'IN_BENE_CREATION':
    case 'BANK_DETAILS_VERIFICATION_PENDING':
    case 'BANK_DETAILS_PENDING':
    case 'UNDER_REVIEW':
      return 'under_review';
    default:
      return 'created';
  }
}
