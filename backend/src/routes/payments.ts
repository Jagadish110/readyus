import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { requireUser } from '../lib/auth.js';
import { cashfree, CashfreeError, cashfreeMode, confirmPaid, getOrder, toRupees } from '../lib/cashfree.js';
import { asService } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

const orderSchema = z.object({ orderId: z.string().uuid() });

type OrderRow = {
  id: string;
  order_code: string;
  customer_id: string;
  seller_id: string;
  status: string;
  required_online_paise: number;
  verified_prepaid_paise: number;
  cashfree_order_id: string | null;
  phone: string | null;
};

type CreatedOrder = { order_id: string; payment_session_id: string };

const PAYABLE = ['payment_required', 'payment_rejected'];

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Starts an online payment for an order the caller owns. The amount comes from our
   * database, never from the browser, and the shop's whole share is split to its Cashfree
   * vendor so Localty never holds the money.
   */
  app.post('/orders', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { orderId } = orderSchema.parse(request.body);

    const { order, vendorId } = await asService(async (q) => {
      const found = await q.one<OrderRow>(
        `select id, order_code, customer_id, seller_id, status, required_online_paise,
                verified_prepaid_paise, cashfree_order_id, delivery_address ->> 'phone' as phone
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
      return { order: found, vendorId: account.cashfree_vendor_id };
    });

    const phone = (order.phone ?? '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) {
      throw new AppError(400, 'Add a 10-digit phone number to your delivery address before paying online.');
    }

    // A retry reuses the same Cashfree order while it is still open, so a double tap or a
    // failed card cannot create two charges for one order.
    let cashfreeOrderId = order.cashfree_order_id;
    let sessionId: string | null = null;

    if (cashfreeOrderId) {
      const existing = await getOrder(cashfreeOrderId).catch(() => null);
      if (existing?.order_status === 'PAID') {
        await confirmPaid(cashfreeOrderId);
        throw new AppError(409, 'This order is already paid.');
      }
      if (existing?.order_status === 'ACTIVE' && existing.payment_session_id) sessionId = existing.payment_session_id;
    }

    if (!sessionId) {
      // First attempt uses the order code; a later one (the old order expired) gets a fresh suffix.
      const newId = cashfreeOrderId ? `${order.order_code}-${Date.now().toString(36)}` : order.order_code;
      const notifyUrl = config.PUBLIC_API_URL?.startsWith('https://') ? `${config.PUBLIC_API_URL}/v1/webhooks/cashfree` : undefined;

      const body = {
        order_id: newId,
        order_amount: toRupees(order.required_online_paise),
        order_currency: 'INR',
        customer_details: {
          customer_id: user.id,
          customer_phone: phone,
          ...(user.email ? { customer_email: user.email } : {})
        },
        order_meta: {
          return_url: `${config.SITE_URL}/orders/${order.id}`,
          ...(notifyUrl ? { notify_url: notifyUrl } : {})
        },
        order_note: `Localty ${order.order_code}`,
        // The shop's whole share goes to its vendor; there is no commission at launch.
        order_splits: [{ vendor_id: vendorId, amount: toRupees(order.required_online_paise) }]
      };

      try {
        const created = await cashfree<CreatedOrder>('POST', '/orders', body);
        cashfreeOrderId = created.order_id;
        sessionId = created.payment_session_id;
      } catch (error) {
        // Two taps at once: the second finds the first one's order and uses it.
        if (error instanceof CashfreeError && /already (exist|present)|duplicate/i.test(error.message)) {
          const existing = await getOrder(newId);
          if (existing.order_status !== 'ACTIVE' || !existing.payment_session_id) throw error;
          cashfreeOrderId = newId;
          sessionId = existing.payment_session_id;
        } else {
          throw error;
        }
      }

      await asService((q) => q.rows('update orders set cashfree_order_id = $2 where id = $1', [order.id, cashfreeOrderId]));
    }

    return {
      paymentSessionId: sessionId,
      mode: cashfreeMode,
      amount: order.required_online_paise,
      orderCode: order.order_code
    };
  });

  /**
   * Called by the browser after the payment window closes so the order updates at once.
   * It does not carry anything we trust: the server asks Cashfree whether the order is
   * paid. The webhook does the same check, so a closed tab loses nothing.
   */
  app.post('/verify', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { orderId } = orderSchema.parse(request.body);

    const order = await asService((q) =>
      q.one<{ customer_id: string; cashfree_order_id: string | null }>(
        'select customer_id, cashfree_order_id from orders where id = $1',
        [orderId]
      )
    );
    if (!order || order.customer_id !== user.id) throw new AppError(404, 'Order not found.');
    if (!order.cashfree_order_id) return { ok: true, paid: false, status: 'NOT_STARTED' };

    const result = await confirmPaid(order.cashfree_order_id);
    return { ok: true, ...result };
  });
};
