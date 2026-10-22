import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

type Options = { version?: 'v1' | 'v2'; method?: 'PATCH' };

const authorization = `Basic ${Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64')}`;

/** Thin fetch wrapper with a timeout; the official SDK adds nothing we need. */
export async function razorpay<T>(path: string, body?: Record<string, unknown>, options: Options = {}): Promise<T> {
  const response = await fetch(`https://api.razorpay.com/${options.version ?? 'v1'}${path}`, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000)
  });

  const json = (await response.json().catch(() => ({}))) as { error?: { description?: string } };
  if (!response.ok) throw new RazorpayError(json.error?.description ?? 'Razorpay request failed', response.status);
  return json as T;
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Signature Checkout returns to the browser: HMAC(order_id|payment_id) with the key secret. */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const expected = createHmac('sha256', config.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

/** Webhook signature: HMAC of the raw, unparsed body with the webhook secret. */
export function verifyWebhookSignature(rawBody: string, signature: string) {
  return safeEqual(createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex'), signature);
}

/** Maps Razorpay's activation_status onto the few states a shop sees. */
export type PayoutStatus = 'created' | 'under_review' | 'needs_clarification' | 'activated' | 'rejected';

export function toPayoutStatus(value: string | undefined): PayoutStatus {
  switch (value) {
    case 'activated':
      return 'activated';
    case 'needs_clarification':
      return 'needs_clarification';
    case 'rejected':
    case 'suspended':
      return 'rejected';
    case 'under_review':
    case 'requested':
      return 'under_review';
    default:
      return 'created';
  }
}
