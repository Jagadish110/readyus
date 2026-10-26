import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { syncSubscription } from '../lib/billing.js';
import { confirmPaid, verifyWebhookSignature } from '../lib/cashfree.js';
import { asService } from '../lib/db.js';
import { databaseMessage } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

const eventSchema = z.object({
  type: z.string().optional(),
  data: z.object({ order: z.object({ order_id: z.string() }).optional() }).optional()
});

/** Cashfree nests the subscription id differently per event; find it wherever it sits. */
export function findSubscriptionId(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  const record = value as Record<string, unknown>;
  const direct = record.subscription_id;
  if (typeof direct === 'string' && /^[A-Za-z0-9_-]{3,250}$/.test(direct)) return direct;
  for (const child of Object.values(record)) {
    const found = findSubscriptionId(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Cashfree calls this when a payment succeeds. It is the source of truth: it works even if
   * the customer closes the tab before the browser reports back. In the Cashfree dashboard,
   * add this URL under Developers -> Webhooks and enable the payment success event.
   *
   * We check the signature, then ask Cashfree for the order's real status instead of trusting
   * the amounts in the webhook body.
   */
  app.post('/cashfree', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request) => {
    const signature = request.headers['x-webhook-signature'];
    const timestamp = request.headers['x-webhook-timestamp'];
    if (
      typeof signature !== 'string' ||
      typeof timestamp !== 'string' ||
      !request.rawBody ||
      !verifyWebhookSignature(request.rawBody, timestamp, signature)
    ) {
      throw new AppError(401, 'Invalid signature.');
    }

    const event = eventSchema.safeParse(request.body);
    const orderId = event.success ? event.data.data?.order?.order_id : undefined;

    // Subscription events: only used as a signal. The mandate and its charges are fetched
    // from Cashfree, so a forged or reordered body cannot change anything.
    if (event.success && event.data.type?.toUpperCase().startsWith('SUBSCRIPTION')) {
      const subscriptionId = findSubscriptionId(request.body);
      if (subscriptionId) {
        await asService((q) =>
          q.rows('insert into subscription_events (cashfree_subscription_id, event_type) values ($1, $2)', [subscriptionId, event.data.type])
        );
        await syncSubscription(subscriptionId, request.log);
      }
      return { ok: true };
    }

    // Only successful payments matter here; every other event is acknowledged and ignored.
    if (event.success && event.data.type === 'PAYMENT_SUCCESS_WEBHOOK' && orderId) {
      try {
        await confirmPaid(orderId);
      } catch (error) {
        // An order we do not know about is not retryable; anything else makes Cashfree retry.
        if (!databaseMessage(error).includes('ORDER_NOT_FOUND')) throw error;
      }
    }

    return { ok: true };
  });
};
