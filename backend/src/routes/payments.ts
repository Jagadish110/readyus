import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { requireUser } from '../lib/auth.js';
import { cashfree, successfulPayment, toPaise, toRupees } from '../lib/cashfree.js';
import { asService } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

const startSchema = z.object({ orderId: z.string().uuid() });
const verifySchema = z.object({ orderId: z.string().uuid() });

type OrderRow = {
  id: string;
  order_code: string;
  customer_id: string;
  seller_id: string;
  status: string;
  required_online_paise: number;
  verified_prepaid_paise: number;
  cashfree_order_id: string | null;
};

type CashfreeOrder = { order_id: string; payment_session_id: string };

const PAYABLE = ['payment_required', 'payment_rejected'];

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Starts an online payment for an order the caller owns. The amount comes from
   * our database, never from the browser, and the shop's share is split to its
   * Cashfree vendor account so ReadyUs never holds the money.
   */
  app.post('/orders', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { orderId } = startSchema.parse(request.body);

    const { order, vendorId, phone } = await asService(async (q) => {
      const found = await q.one<OrderRow>(
        `select id, order_code, customer_id, seller_id, status, required_online_paise,
                verified_prepaid_paise, cashfree_order_id
         from orders where id = $1`,
        [orderId]
      );
      // Someone else's order looks exactly like a missing one.
      if (!found || found.customer_id !== user.id) throw new AppError(404, 'Order not found.');
      if (!PAYABLE.includes(found.status) || found.required_online_paise <= 0 || found.verified_prepaid_paise > 0) {
        throw new AppError(409, 'This order is not waiting for payment.');
      }

      const account = await q.one<{ cashfree_vendor_id: string }>(
        `select cashfree_vendor_id from seller_payout_accounts where seller_id = $1 and status = 'activated'`,
        [found.seller_id]
      );
      if (!account) throw new AppError(409, 'This shop cannot take online payments yet.', 'SHOP_NOT_PAYOUT_READY');

      // Cashfree needs a contact number for the payer.
      const contact = await q.one<{ phone: string | null }>(
        `select coalesce(
                  nullif((select phone from profiles where id = $1), ''),
                  (select phone from addresses where user_id = $1 and phone <> '' order by created_at desc limit 1)
                ) as phone`,
        [user.id]
      );
      const digits = (contact?.phone ?? '').replace(/\D/g, '').slice(-10);
      if (digits.length !== 10) throw new AppError(409, 'Add a phone number to your address to pay online.');

      return { order: found, vendorId: account.cashfree_vendor_id, phone: digits };
    });

    let cashfreeOrderId = order.cashfree_order_id;
    let sessionId: string;

    // A retry reuses the same Cashfree order so a double tap cannot create two charges.
    if (cashfreeOrderId) {
      sessionId = (await cashfree<CashfreeOrder>(`/pg/orders/${encodeURIComponent(cashfreeOrderId)}`)).payment_session_id;
    } else {
      const amount = Number(toRupees(order.required_online_paise));
      const created = await cashfree<CashfreeOrder>('/pg/orders', {
        order_id: order.order_code,
        order_amount: amount,
        order_currency: 'INR',
        customer_details: { customer_id: user.id, customer_phone: phone, ...(user.email ? { customer_email: user.email } : {}) },
        order_meta: config.CASHFREE_RETURN_URL
          ? { return_url: `${config.CASHFREE_RETURN_URL}?order_id={order_id}` }
          : undefined,
        order_note: order.id,
        order_splits: [{ vendor_id: vendorId, amount }]
      });
      sessionId = created.payment_session_id;

      // If two taps raced, the first one to save wins; both used the same order_code so Cashfree rejects the second.
      cashfreeOrderId = await asService(async (q) => {
        const saved = await q.one<{ cashfree_order_id: string }>(
          'update orders set cashfree_order_id = $2 where id = $1 and cashfree_order_id is null returning cashfree_order_id',
          [order.id, created.order_id]
        );
        if (saved) return saved.cashfree_order_id;
        const existing = await q.one<{ cashfree_order_id: string }>('select cashfree_order_id from orders where id = $1', [order.id]);
        return existing?.cashfree_order_id ?? created.order_id;
      });
    }

    return {
      mode: config.CASHFREE_ENV,
      paymentSessionId: sessionId,
      cashfreeOrderId,
      amount: order.required_online_paise,
      orderCode: order.order_code
    };
  });

  /**
   * Called by the browser right after Checkout closes so the order updates
   * instantly. Nothing from the browser is trusted: we ask Cashfree whether the
   * order was paid. The webhook records the same payment, so a closed tab loses nothing.
   */
  app.post('/verify', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { orderId } = verifySchema.parse(request.body);

    const order = await asService((q) =>
      q.one<{ customer_id: string; cashfree_order_id: string | null }>(
        'select customer_id, cashfree_order_id from orders where id = $1',
        [orderId]
      )
    );
    if (!order || order.customer_id !== user.id || !order.cashfree_order_id) throw new AppError(404, 'Order not found.');

    const payment = await successfulPayment(order.cashfree_order_id);
    if (!payment) throw new AppError(409, 'Payment is not confirmed yet.');

    await asService((q) =>
      q.rows('select mark_order_paid($1, $2, $3)', [
        order.cashfree_order_id,
        String(payment.cf_payment_id),
        toPaise(payment.payment_amount)
      ])
    );

    return { ok: true };
  });
};
