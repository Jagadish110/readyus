import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { asService } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { razorpay, safeEqual } from '../lib/razorpay.js';

type Pending = { order_id: string; razorpay_payment: string; amount_paise: number };

/** Scheduled jobs prove themselves with `Authorization: Bearer $CRON_SECRET`. */
function requireCron(request: FastifyRequest) {
  const header = request.headers.authorization ?? '';
  if (!header.startsWith('Bearer ') || !safeEqual(header.slice(7), config.CRON_SECRET)) {
    throw new AppError(401, 'Unauthorized.');
  }
}

export const internalRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Returns online payments for orders the shop declined, timed out or the
   * customer cancelled. `reverse_all` pulls the money back from the shop's
   * linked account in the same call. Run it every few minutes from a scheduler.
   */
  app.post('/refunds/sweep', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    requireCron(request);

    const pending = await asService((q) => q.rows<Pending>('select * from orders_needing_refund()'));

    let refunded = 0;
    const failed: string[] = [];

    for (const item of pending) {
      try {
        const refund = await razorpay<{ id: string }>(`/payments/${item.razorpay_payment}/refund`, {
          amount: item.amount_paise,
          reverse_all: 1,
          notes: { order_id: item.order_id }
        });
        await asService((q) => q.rows('select record_refund($1, $2, $3)', [item.order_id, refund.id, item.amount_paise]));
        refunded += 1;
      } catch (cause) {
        request.log.error({ order: item.order_id, cause }, 'refund failed');
        failed.push(item.order_id);
      }
    }

    return { refunded, failed };
  });
};
