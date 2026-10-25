import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { cashfree, CashfreeError, toRupees } from '../lib/cashfree.js';
import { asService } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

type Pending = { order_id: string; cashfree_order: string; vendor_id: string; amount_paise: number };
type Refund = { cf_refund_id?: string | number; refund_id?: string; refund_status?: string };

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Scheduled jobs prove themselves with `Authorization: Bearer $CRON_SECRET`. */
function requireCron(request: FastifyRequest) {
  const header = request.headers.authorization ?? '';
  if (!header.startsWith('Bearer ') || !safeEqual(header.slice(7), config.CRON_SECRET)) {
    throw new AppError(401, 'Unauthorized.');
  }
}

/** A refund Cashfree has refused or abandoned must not be recorded as money returned. */
const FAILED = /^(CANCELLED|FAILED|REJECTED)$/i;

export const internalRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Returns online payments for orders the shop declined, timed out or the customer cancelled.
   * The refund names the shop's vendor so Easy Split takes the money back from that shop.
   * Run it every few minutes from a scheduler.
   */
  app.post('/refunds/sweep', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    requireCron(request);

    const pending = await asService((q) => q.rows<Pending>('select * from orders_needing_refund()'));

    let refunded = 0;
    const failed: string[] = [];

    for (const item of pending) {
      // Stable per order and amount, so a retry after a crash finds the refund it already made.
      const refundId = `rf${item.order_id.replace(/-/g, '').slice(0, 20)}_${item.amount_paise}`;
      const amount = toRupees(item.amount_paise);
      const path = `/orders/${encodeURIComponent(item.cashfree_order)}/refunds`;
      const base = { refund_id: refundId, refund_amount: amount, refund_note: 'Order not fulfilled', refund_speed: 'STANDARD' };

      try {
        let refund: Refund;
        try {
          refund = await cashfree<Refund>('POST', path, { ...base, refund_splits: [{ vendor_id: item.vendor_id, amount }] });
        } catch (error) {
          if (!(error instanceof CashfreeError)) throw error;
          if (/already (exist|present)|duplicate/i.test(error.message)) {
            // We made this refund on an earlier run but did not get to record it.
            refund = await cashfree<Refund>('GET', `${path}/${encodeURIComponent(refundId)}`);
          } else if (/split|vendor/i.test(error.message)) {
            // Not a split order after all: refund plainly.
            refund = await cashfree<Refund>('POST', path, base);
          } else {
            throw error;
          }
        }

        if (refund.refund_status && FAILED.test(refund.refund_status)) throw new Error(`refund ${refund.refund_status}`);

        await asService((q) =>
          q.rows('select record_refund($1, $2, $3)', [item.order_id, String(refund.cf_refund_id ?? refundId), item.amount_paise])
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
