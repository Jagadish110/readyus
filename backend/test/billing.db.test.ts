import { describe, expect, it } from 'vitest';
import { asAnon, asService, asUser } from '../src/lib/db.js';
import { HAS_DB, makeCustomer, makeShop, orderRow, placeOrder } from './db/helpers.js';

type Billing = { state: string; trial_ends_at: string; paid_through: string | null; access_until: string; cancelled: boolean; mandate_status: string | null };

const billing = (sellerId: string) =>
  asService((q) => q.one<{ b: Billing }>('select billing_status($1) as b', [sellerId])).then((row) => row!.b);
const days = (n: number) => `now() + interval '${n} days'`;
const setSub = (sellerId: string, set: string) => asService((q) => q.rows(`update subscriptions set ${set} where seller_id = $1`, [sellerId]));
const pay = (sellerId: string, id: string, amount = 49900, at = new Date()) =>
  asService((q) => q.one<{ r: boolean }>('select record_subscription_payment($1, $2, $3, $4) as r', [sellerId, id, amount, at])).then((row) => row!.r);
const discoverable = (sellerId: string) =>
  asAnon((q) => q.rows<{ id: string }>('select id from nearby_sellers(17.3855, 78.4880, 5)')).then((rows) => rows.some((row) => row.id === sellerId));
const billable = (sellerId: string) =>
  asService((q) => q.one<{ b: boolean }>('select shop_is_billable($1) as b', [sellerId])).then((row) => row!.b);

describe.skipIf(!HAS_DB)('subscription state (database)', () => {
  it('starts a 30-day free trial when a shop is approved, and not before', async () => {
    const pending = await makeShop({ approved: false });
    expect(await billing(pending.sellerId)).toBeNull();

    await asService((q) => q.rows(`update sellers set status = 'approved', public_visible = true where id = $1`, [pending.sellerId]));
    const b = await billing(pending.sellerId);
    expect(b.state).toBe('trialing');
    const trialDays = (new Date(b.trial_ends_at).getTime() - Date.now()) / 86_400_000;
    expect(trialDays).toBeGreaterThan(29.9);
    expect(trialDays).toBeLessThan(30.1);
  });

  it('shows a trialing shop to customers and lets it take orders', async () => {
    const shop = await makeShop();
    expect(await discoverable(shop.sellerId)).toBe(true);
    const customer = await makeCustomer();
    await placeOrder(customer, shop);
  });

  it('moves through past_due to suspended on the clock alone, with no job running', async () => {
    const shop = await makeShop();
    await setSub(shop.sellerId, `trial_ends_at = ${days(-2)}`);
    expect((await billing(shop.sellerId)).state).toBe('past_due');
    expect(await discoverable(shop.sellerId)).toBe(true);

    await setSub(shop.sellerId, `trial_ends_at = ${days(-6)}`);
    expect((await billing(shop.sellerId)).state).toBe('suspended');
    expect(await billable(shop.sellerId)).toBe(false);
  });

  it('hides a suspended shop and refuses new orders, but finishes the orders it already has', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const existing = await placeOrder(customer, shop);

    await setSub(shop.sellerId, `trial_ends_at = ${days(-10)}`);

    expect(await discoverable(shop.sellerId)).toBe(false);
    const products = await asAnon((q) => q.rows<{ seller_id: string }>('select seller_id from nearby_products(17.3855, 78.4880, 5)'));
    expect(products.some((row) => row.seller_id === shop.sellerId)).toBe(false);
    const categories = await asAnon((q) => q.rows<{ category_key: string }>('select * from nearby_categories(17.3855, 78.4880, 5)'));
    expect(categories.some((row) => row.category_key === shop.category)).toBe(false);

    await expect(placeOrder(customer, shop)).rejects.toThrow(/SELLER_NOT_ACCEPTING_ORDERS/);

    await asUser(shop.userId, (q) => q.rows('select seller_decide_order($1, true)', [existing]));
    expect((await orderRow(existing))!.status).toBe('accepted');
  });

  it('comes back the moment a payment is recorded', async () => {
    const shop = await makeShop();
    await setSub(shop.sellerId, `trial_ends_at = ${days(-10)}`);
    expect(await discoverable(shop.sellerId)).toBe(false);

    expect(await pay(shop.sellerId, 'pay_back')).toBe(true);

    expect((await billing(shop.sellerId)).state).toBe('active');
    expect(await discoverable(shop.sellerId)).toBe(true);
  });

  it('can be switched off for everyone with billing_enforced', async () => {
    const shop = await makeShop();
    await setSub(shop.sellerId, `trial_ends_at = ${days(-30)}`);
    try {
      await asService((q) => q.rows('update platform_settings set billing_enforced = false'));
      expect(await billable(shop.sellerId)).toBe(true);
    } finally {
      await asService((q) => q.rows('update platform_settings set billing_enforced = true'));
    }
    expect(await billable(shop.sellerId)).toBe(false);
  });
});

describe.skipIf(!HAS_DB)('subscription payments (database)', () => {
  it('counts a charge once however many times it is reported', async () => {
    const shop = await makeShop();
    expect(await pay(shop.sellerId, 'p1')).toBe(true);
    const first = (await billing(shop.sellerId)).paid_through;
    expect(await pay(shop.sellerId, 'p1')).toBe(false);
    expect((await billing(shop.sellerId)).paid_through).toBe(first);
  });

  it('adds the paid month after the trial, so paying early loses no free days', async () => {
    const shop = await makeShop();
    const before = (await billing(shop.sellerId)).trial_ends_at;
    await pay(shop.sellerId, 'early');
    const paidThrough = new Date((await billing(shop.sellerId)).paid_through!).getTime();
    const trialEnd = new Date(before).getTime();
    // One calendar month after the trial ends: between 28 and 31 days later.
    expect((paidThrough - trialEnd) / 86_400_000).toBeGreaterThanOrEqual(28);
    expect((paidThrough - trialEnd) / 86_400_000).toBeLessThanOrEqual(31);
  });

  it('stacks consecutive months', async () => {
    const shop = await makeShop();
    await pay(shop.sellerId, 'm1');
    const one = new Date((await billing(shop.sellerId)).paid_through!).getTime();
    await pay(shop.sellerId, 'm2');
    const two = new Date((await billing(shop.sellerId)).paid_through!).getTime();
    expect((two - one) / 86_400_000).toBeGreaterThanOrEqual(28);
  });

  it('starts a lapsed shop’s month from the payment, not from the old end date', async () => {
    const shop = await makeShop();
    await setSub(shop.sellerId, `trial_ends_at = ${days(-90)}, paid_through = ${days(-60)}`);
    await pay(shop.sellerId, 'again');
    const days_ = (new Date((await billing(shop.sellerId)).paid_through!).getTime() - Date.now()) / 86_400_000;
    expect(days_).toBeGreaterThan(27);
    expect(days_).toBeLessThan(32);
  });

  it('refuses a charge below the shop’s price', async () => {
    const shop = await makeShop();
    await expect(pay(shop.sellerId, 'cheap', 100)).rejects.toThrow(/AMOUNT_MISMATCH/);
    expect((await billing(shop.sellerId)).paid_through).toBeNull();
  });

  it('keeps what a shop paid for after it cancels, without the grace days', async () => {
    const shop = await makeShop();
    await pay(shop.sellerId, 'c1');
    const paidThrough = (await billing(shop.sellerId)).paid_through!;
    await asService((q) => q.rows(`update subscriptions set cashfree_subscription_id = 'sub_c' where seller_id = $1`, [shop.sellerId]));
    await asService((q) => q.rows(`select update_mandate_status('sub_c', 'CANCELLED')`));

    const b = await billing(shop.sellerId);
    expect(b.cancelled).toBe(true);
    expect(b.state).toBe('active');
    expect(new Date(b.access_until).getTime()).toBe(new Date(paidThrough).getTime());

    await asService((q) => q.rows(`select update_mandate_status('sub_c', 'ACTIVE')`));
    expect((await billing(shop.sellerId)).cancelled).toBe(false);
  });

  it('does not touch another shop’s subscription', async () => {
    const a = await makeShop();
    const b = await makeShop();
    await pay(a.sellerId, 'only-a');
    expect((await billing(b.sellerId)).paid_through).toBeNull();
  });

  it('cannot be read or written by a signed-in user directly', async () => {
    const shop = await makeShop();
    await expect(asUser(shop.userId, (q) => q.rows('select * from subscriptions'))).rejects.toThrow(/permission denied/);
    await expect(asUser(shop.userId, (q) => q.rows(`update subscriptions set paid_through = now() + interval '1 year'`))).rejects.toThrow(/permission denied/);
    await expect(asUser(shop.userId, (q) => q.rows(`select record_subscription_payment($1, 'x', 49900, now())`, [shop.sellerId]))).rejects.toThrow(/permission denied/);
  });
});

describe.skipIf(!HAS_DB)('billing reminders and resync (database)', () => {
  const notices = (userId: string) =>
    asService((q) => q.rows<{ title: string }>(`select title from notifications where user_id = $1 order by created_at`, [userId]));

  it('sends each reminder once, however often the job runs', async () => {
    const shop = await makeShop();
    await setSub(shop.sellerId, `trial_ends_at = ${days(2)}`);
    await asService((q) => q.rows('select billing_reminders()'));
    await asService((q) => q.rows('select billing_reminders()'));
    expect((await notices(shop.userId)).map((n) => n.title)).toEqual(['Your free trial is ending']);
  });

  it('does not nag a shop whose automatic payment is already set up', async () => {
    const shop = await makeShop();
    await setSub(shop.sellerId, `trial_ends_at = ${days(2)}, mandate_status = 'ACTIVE'`);
    await asService((q) => q.rows('select billing_reminders()'));
    expect(await notices(shop.userId)).toHaveLength(0);
  });

  it('warns about an overdue payment and about suspension', async () => {
    const overdue = await makeShop();
    await setSub(overdue.sellerId, `trial_ends_at = ${days(-1)}`);
    const suspended = await makeShop();
    await setSub(suspended.sellerId, `trial_ends_at = ${days(-20)}`);
    await asService((q) => q.rows('select billing_reminders()'));
    expect((await notices(overdue.userId)).map((n) => n.title)).toEqual(['Subscription payment is overdue']);
    expect((await notices(suspended.userId)).map((n) => n.title)).toEqual(['Your shop is hidden']);
  });

  it('lists only mandates worth asking Cashfree about', async () => {
    const live = await makeShop();
    const done = await makeShop();
    await setSub(live.sellerId, `cashfree_subscription_id = 'sub_live', mandate_status = 'ACTIVE'`);
    await setSub(done.sellerId, `cashfree_subscription_id = 'sub_done', mandate_status = 'CANCELLED'`);
    const due = await asService((q) => q.rows<{ cashfree_subscription_id: string }>('select * from billing_syncable()'));
    const ids = due.map((row) => row.cashfree_subscription_id);
    expect(ids).toContain('sub_live');
    expect(ids).not.toContain('sub_done');
  });
});
