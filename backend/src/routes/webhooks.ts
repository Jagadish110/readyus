import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { toPaise, verifyWebhookSignature } from '../lib/cashfree.js';
import { asService, databaseMessage } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

const eventSchema = z.object({
  type: z.string(),
  data: z
    .object({
      order: z.object({ order_id: z.string() }).optional(),
      payment: z
        .object({
          cf_payment_id: z.union([z.string(), z.number()]),
          payment_amount: z.number()
        })
        .optional()
    })
    .optional()
});

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Cashfree calls this when a payment succeeds. It is the source of truth:
   * it works even if the customer closes the tab before the browser reports back.
   * In the dashboard enable the PAYMENT_SUCCESS_WEBHOOK event; it is signed with
   * the same secret key as the API.
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
    if (!event.success) return { ok: true }; // signed but not an event we use

    const orderId = event.data.data?.order?.order_id;
    const payment = event.data.data?.payment;
    if (event.data.type === 'PAYMENT_SUCCESS_WEBHOOK' && orderId && payment) {
      try {
        await asService((q) =>
          q.rows('select mark_order_paid($1, $2, $3)', [orderId, String(payment.cf_payment_id), toPaise(payment.payment_amount)])
        );
      } catch (error) {
        // An order we do not know about is not retryable; anything else makes Cashfree retry.
        if (!databaseMessage(error).includes('ORDER_NOT_FOUND')) throw error;
      }
    }

    return { ok: true };
  });
};
