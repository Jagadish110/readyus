import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { asService } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { cashfree, CashfreeError, safeEqual, toRupees } from '../lib/cashfree.js';

type Pending = { order_id: string; cashfree_order: string; vendor_id: string; amount_paise: number };

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
   * customer cancelled. The refund is split back to the shop's vendor account. Run it every few minutes from a scheduler.
   */
  app.post('/refunds/sweep', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    requireCron(request);

    const pending = await asService((q) => q.rows<Pending>('select * from orders_needing_refund()'));

    let refunded = 0;
    const failed: string[] = [];

    for (const item of pending) {
      try {
        // Our own id makes a retry after a crash return the same refund instead of a second one.
        const refundId = `refund_${item.order_id}`;
        const refund = await cashfree<{ cf_refund_id: string | number }>(
          `/pg/orders/${encodeURIComponent(item.cashfree_order)}/refunds`,
          {
            refund_amount: Number(toRupees(item.amount_paise)),
            refund_id: refundId,
            refund_note: 'Order not fulfilled',
            refund_splits: [{ vendor_id: item.vendor_id, amount: Number(toRupees(item.amount_paise)) }]
          }
        ).catch(async (cause) => {
          if (!(cause instanceof CashfreeError) || cause.status !== 409) throw cause;
          return cashfree<{ cf_refund_id: string | number }>(
            `/pg/orders/${encodeURIComponent(item.cashfree_order)}/refunds/${refundId}`
          );
        });
        await asService((q) =>
          q.rows('select record_refund($1, $2, $3)', [item.order_id, String(refund.cf_refund_id), item.amount_paise])
        );
        refunded += 1;
      } catch (cause) {
        request.log.error({ order: item.order_id, cause }, 'refund failed');
        failed.push(item.order_id);
      }
    }

    return { refunded, failed };
  });
};
