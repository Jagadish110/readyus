import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { asService, databaseMessage } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { verifyWebhookSignature } from '../lib/razorpay.js';

const eventSchema = z.object({
  event: z.string(),
  payload: z
    .object({
      payment: z
        .object({
          entity: z.object({
            id: z.string(),
            order_id: z.string().nullable().optional(),
            amount: z.number().int()
          })
        })
        .optional()
    })
    .optional()
});

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Razorpay calls this when a payment is captured. It is the source of truth:
   * it works even if the customer closes the tab before the browser reports back.
   * In the dashboard enable `payment.captured` and use RAZORPAY_WEBHOOK_SECRET.
   */
  app.post('/razorpay', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request) => {
    const signature = request.headers['x-razorpay-signature'];
    if (typeof signature !== 'string' || !request.rawBody || !verifyWebhookSignature(request.rawBody, signature)) {
      throw new AppError(401, 'Invalid signature.');
    }

    const event = eventSchema.safeParse(request.body);
    if (!event.success) return { ok: true }; // signed but not an event we use

    const payment = event.data.payload?.payment?.entity;
    if (event.data.event === 'payment.captured' && payment?.order_id) {
      try {
        await asService((q) => q.rows('select mark_order_paid($1, $2, $3)', [payment.order_id, payment.id, payment.amount]));
      } catch (error) {
        // An order we do not know about is not retryable; anything else makes Razorpay retry.
        if (!databaseMessage(error).includes('ORDER_NOT_FOUND')) throw error;
      }
    }

    return { ok: true };
  });
};
