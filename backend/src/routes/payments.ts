import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { requireUser } from '../lib/auth.js';
import { asService } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { razorpay, verifyCheckoutSignature } from '../lib/razorpay.js';

const startSchema = z.object({ orderId: z.string().uuid() });

const verifySchema = z.object({
  razorpay_order_id: z.string().min(5).max(64),
  razorpay_payment_id: z.string().min(5).max(64),
  razorpay_signature: z.string().min(10).max(256)
});

type OrderRow = {
  id: string;
  order_code: string;
  customer_id: string;
  seller_id: string;
  status: string;
  required_online_paise: number;
  verified_prepaid_paise: number;
  razorpay_order_id: string | null;
};

const PAYABLE = ['payment_required', 'payment_rejected'];

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Starts an online payment for an order the caller owns. The amount comes from
   * our database, never from the browser, and the shop's share is routed to its
   * linked account so Localty never holds the money.
   */
  app.post('/orders', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { orderId } = startSchema.parse(request.body);

    const { order, accountId } = await asService(async (q) => {
      const found = await q.one<OrderRow>(
        `select id, order_code, customer_id, seller_id, status, required_online_paise,
                verified_prepaid_paise, razorpay_order_id
         from orders where id = $1`,
        [orderId]
      );
      // Someone else's order looks exactly like a missing one.
      if (!found || found.customer_id !== user.id) throw new AppError(404, 'Order not found.');
      if (!PAYABLE.includes(found.status) || found.required_online_paise <= 0 || found.verified_prepaid_paise > 0) {
        throw new AppError(409, 'This order is not waiting for payment.');
      }

      const account = await q.one<{ razorpay_account_id: string }>(
        `select razorpay_account_id from seller_payout_accounts where seller_id = $1 and status = 'activated'`,
        [found.seller_id]
      );
      if (!account) throw new AppError(409, 'This shop cannot take online payments yet.', 'SHOP_NOT_PAYOUT_READY');
      return { order: found, accountId: account.razorpay_account_id };
    });

    let razorpayOrderId = order.razorpay_order_id;

    // A retry reuses the same Razorpay order so a double tap cannot create two charges.
    if (!razorpayOrderId) {
      const created = await razorpay<{ id: string }>('/orders', {
        amount: order.required_online_paise,
        currency: 'INR',
        receipt: order.order_code,
        notes: { order_id: order.id },
        transfers: [
          {
            account: accountId,
            amount: order.required_online_paise,
            currency: 'INR',
            notes: { order_code: order.order_code },
            on_hold: false
          }
        ]
      });

      // If two taps raced, the first one to save wins and the other's Razorpay order is simply unused.
      razorpayOrderId = await asService(async (q) => {
        const saved = await q.one<{ razorpay_order_id: string }>(
          'update orders set razorpay_order_id = $2 where id = $1 and razorpay_order_id is null returning razorpay_order_id',
          [order.id, created.id]
        );
        if (saved) return saved.razorpay_order_id;
        const existing = await q.one<{ razorpay_order_id: string }>('select razorpay_order_id from orders where id = $1', [order.id]);
        return existing?.razorpay_order_id ?? created.id;
      });
    }

    return {
      keyId: config.RAZORPAY_KEY_ID,
      razorpayOrderId,
      amount: order.required_online_paise,
      orderCode: order.order_code
    };
  });

  /**
   * Called by the browser right after Checkout succeeds so the order updates
   * instantly. The webhook records the same payment, so a closed tab loses nothing.
   */
  app.post('/verify', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const body = verifySchema.parse(request.body);

    if (!verifyCheckoutSignature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)) {
      throw new AppError(400, 'Payment could not be verified.');
    }

    await asService(async (q) => {
      const order = await q.one<{ customer_id: string; required_online_paise: number }>(
        'select customer_id, required_online_paise from orders where razorpay_order_id = $1',
        [body.razorpay_order_id]
      );
      if (!order || order.customer_id !== user.id) throw new AppError(404, 'Order not found.');

      await q.rows('select mark_order_paid($1, $2, $3)', [
        body.razorpay_order_id,
        body.razorpay_payment_id,
        order.required_online_paise
      ]);
    });

    return { ok: true };
  });
};
