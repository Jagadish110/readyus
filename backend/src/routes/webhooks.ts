import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { confirmPaid, verifyWebhookSignature } from '../lib/cashfree.js';
import { databaseMessage } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

const eventSchema = z.object({
  type: z.string().optional(),
  data: z.object({ order: z.object({ order_id: z.string() }).optional() }).optional()
});

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
