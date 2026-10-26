import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { asService } from './db.js';
import { AppError } from './errors.js';

/**
 * Cashfree Payment Gateway + Easy Split.
 *
 * Easy Split makes each shop a "vendor". An online order is created with a split that
 * sends the shop's whole share to its vendor id, so Localty never holds the money.
 * Amounts are in rupees at Cashfree and in paise everywhere in our own database.
 */
const REAL_BASE = config.CASHFREE_ENV === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
// Tests may swap in a fake Cashfree; a production server can never be pointed anywhere else.
const BASE = config.NODE_ENV !== 'production' && config.CASHFREE_BASE_URL ? config.CASHFREE_BASE_URL.replace(/\/$/, '') : REAL_BASE;

export const cashfreeMode = config.CASHFREE_ENV;
export const cashfreeConfigured = () => Boolean(config.CASHFREE_APP_ID && config.CASHFREE_SECRET_KEY);

export class CashfreeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

function credentials() {
  const id = config.CASHFREE_APP_ID;
  const key = config.CASHFREE_SECRET_KEY;
  if (!id || !key) throw new AppError(503, 'Online payments are not set up on the server yet.', 'PAYMENTS_NOT_CONFIGURED');
  return { id, key };
}

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paise: number) => Number((paise / 100).toFixed(2));

/** Thin fetch wrapper with a timeout; Cashfree's SDK adds nothing we need. */
export async function cashfree<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: Record<string, unknown>): Promise<T> {
  const { id, key } = credentials();
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-client-id': id,
      'x-client-secret': key,
      'x-api-version': config.CASHFREE_API_VERSION,
      // Cashfree requires a unique key on writes (it makes a retried request safe). A fresh one per
      // call is correct here: our own checks (stable order and refund ids) are what prevent duplicates.
      ...(method === 'GET' ? {} : { 'x-idempotency-key': randomUUID() })
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000)
  });

  const json = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
  if (!response.ok) {
    throw new CashfreeError(json.message ?? 'Cashfree request failed', response.status, json.code);
  }
  return json as T;
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Cashfree signs the webhook with HMAC-SHA256 over (timestamp + the raw body), using the
 * secret key, base64 encoded. The raw bytes matter: re-serialised JSON would not match.
 */
export function verifyWebhookSignature(rawBody: string, timestamp: string, signature: string): boolean {
  const key = config.CASHFREE_SECRET_KEY;
  if (!key || !timestamp || !signature) return false;

  // A captured webhook cannot be replayed later: reject stale timestamps when we can read them.
  const sent = Number(timestamp);
  if (Number.isFinite(sent) && sent > 0) {
    const sentMs = sent > 1e12 ? sent : sent * 1000;
    if (Math.abs(Date.now() - sentMs) > 30 * 60 * 1000) return false;
  }

  const expected = createHmac('sha256', key).update(timestamp + rawBody).digest('base64');
  return safeEqual(expected, signature);
}

// ---------------------------------------------------------------- orders

type CashfreeOrder = {
  order_id: string;
  order_status: string; // ACTIVE | PAID | EXPIRED | TERMINATED | TERMINATION_REQUESTED
  order_amount: number;
  payment_session_id?: string;
};

type CashfreePayment = { cf_payment_id: string | number; payment_status: string };

export const getOrder = (cashfreeOrderId: string) =>
  cashfree<CashfreeOrder>('GET', `/orders/${encodeURIComponent(cashfreeOrderId)}`);

/**
 * Asks Cashfree directly whether an order is paid and, if so, records it. Called by both
 * the browser's "I paid" check and the webhook, so nothing the browser or the webhook body
 * claims is trusted: the status and amount come from Cashfree, server to server.
 */
export async function confirmPaid(cashfreeOrderId: string): Promise<{ paid: boolean; status: string }> {
  const order = await getOrder(cashfreeOrderId);
  if (order.order_status !== 'PAID') return { paid: false, status: order.order_status };

  const payments = await cashfree<CashfreePayment[]>('GET', `/orders/${encodeURIComponent(cashfreeOrderId)}/payments`);
  const success = payments.find((payment) => payment.payment_status === 'SUCCESS');
  if (!success) return { paid: false, status: 'NO_SUCCESSFUL_PAYMENT' };

  await asService((q) =>
    q.rows('select mark_order_paid($1, $2, $3)', [cashfreeOrderId, String(success.cf_payment_id), toPaise(order.order_amount)])
  );
  return { paid: true, status: 'PAID' };
}

// ---------------------------------------------------------------- vendors (shops)

export type PayoutStatus = 'created' | 'under_review' | 'needs_clarification' | 'activated' | 'rejected';

/** Maps Easy Split's vendor status onto the few states a shop sees. */
export function toPayoutStatus(vendorStatus: string | undefined): PayoutStatus {
  switch ((vendorStatus ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'activated';
    case 'IN_BANK_VALIDATION':
    case 'IN_BENE_CREATION':
    case 'IN_KYC_REVIEW':
    case 'IN_REVIEW':
      return 'under_review';
    case 'BANK_VALIDATION_FAILED':
    case 'BENE_CREATION_FAILED':
    case 'ACTION_REQUIRED':
      return 'needs_clarification';
    case 'BLOCKED':
    case 'DELETED':
    case 'REJECTED':
      return 'rejected';
    default:
      return 'created';
  }
}

/** The shape of a vendor in Cashfree's responses (only the parts we read). */
export type CashfreeVendor = {
  vendor_id?: string;
  status?: string;
  remarks?: string;
  related_docs?: Array<{ doc_name?: string; doc_value?: string; status?: string; remarks?: string }>;
};

/** A readable reason when Cashfree needs something more from the shop. */
export function vendorProblem(vendor: CashfreeVendor): string {
  // Cashfree lists every document it knows about; one a shop never gave (like a GSTIN for an
  // individual) comes back empty and is not a problem, so only documents with a value or a
  // complaint are worth showing.
  const docs = (vendor.related_docs ?? [])
    .filter((doc) => doc.status && !/^(verified|success|approved|active)$/i.test(doc.status) && (doc.remarks || doc.doc_value))
    .map((doc) => (doc.doc_name ?? 'document') + (doc.remarks ? ` (${doc.remarks})` : ''));
  return [vendor.remarks, ...docs].filter(Boolean).join('; ');
}
