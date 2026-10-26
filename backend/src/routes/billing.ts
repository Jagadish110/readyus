import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { cancelMandate, createMandate, getBilling, mandateInPlace, shopForOwner, syncSubscription } from '../lib/billing.js';
import { cashfreeConfigured, cashfreeMode } from '../lib/cashfree.js';
import { asService } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

const subscriptionIdOf = (sellerId: string) =>
  asService((q) =>
    q.one<{ id: string | null }>('select cashfree_subscription_id as id from subscriptions where seller_id = $1', [sellerId])
  ).then((row) => row?.id ?? null);

/** The shop owner's monthly subscription. Every route works on the caller's own shop only. */
export const billingRoutes: FastifyPluginAsync = async (app) => {
  /** Where the subscription stands, for the billing page and the banner. */
  app.get('/', async (request) => {
    const user = await requireUser(request);
    const shop = await shopForOwner(user.id);
    const billing = await getBilling(shop.id);
    return { billing, shopStatus: shop.status };
  });

  /**
   * Starts the automatic-payment approval. Returns a session for Cashfree's popup. The price
   * comes from the shop's own subscription row, never from the browser.
   */
  app.post('/subscribe', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    const shop = await shopForOwner(user.id);
    const billing = await getBilling(shop.id);

    if (!billing) throw new AppError(409, 'Billing starts once your shop is approved.', 'SHOP_NOT_APPROVED');
    if (!cashfreeConfigured()) throw new AppError(503, 'Online payments are not set up on the server yet.', 'PAYMENTS_NOT_CONFIGURED');
    if (!user.email) throw new AppError(400, 'Add an email address to your account first; the bank needs one for the mandate.');
    if (mandateInPlace(billing.mandate_status) && !billing.cancelled) {
      throw new AppError(409, 'Automatic payment is already set up.', 'ALREADY_SUBSCRIBED');
    }

    const mandate = await createMandate(shop.id, { name: shop.owner_name || shop.shop_name, phone: shop.phone, email: user.email }, billing);
    return { subscriptionSessionId: mandate.sessionId, mode: cashfreeMode };
  });

  /** Called when the popup closes: asks Cashfree what happened and records it. */
  app.post('/verify', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const shop = await shopForOwner(user.id);
    const id = await subscriptionIdOf(shop.id);
    const billing = id ? await syncSubscription(id, request.log) : await getBilling(shop.id);
    return { billing };
  });

  /** Stops future charges. What the shop already paid for stays valid until it runs out. */
  app.post('/cancel', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    const shop = await shopForOwner(user.id);
    const id = await subscriptionIdOf(shop.id);
    if (!id) throw new AppError(409, 'There is no automatic payment to cancel.');
    await cancelMandate(id);
    return { billing: await getBilling(shop.id) };
  });
};
