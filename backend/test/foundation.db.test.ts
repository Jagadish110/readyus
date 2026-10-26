import { describe, expect, it } from 'vitest';
import { asService, asUser } from '../src/lib/db.js';
import { HAS_DB, makeCustomer, makeRider, makeShop, orderRow, placeOrder, stockOf } from './db/helpers.js';

describe.skipIf(!HAS_DB)('order lifecycle (database)', () => {
  /** Takes an order from placed to picked up, the way the shop and the rider do. */
  async function outForDelivery() {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const rider = await makeRider(shop.sellerId);
    const orderId = await placeOrder(customer, shop);
    await asUser(shop.userId, (q) => q.rows('select seller_decide_order($1, true)', [orderId]));
    await asUser(shop.userId, (q) => q.rows(`select seller_set_stage($1, 'packed')`, [orderId]));
    await asUser(rider, (q) => q.rows('select claim_delivery($1)', [orderId]));
    await asUser(rider, (q) => q.rows('select pickup_delivery($1)', [orderId]));
    return { orderId, rider, shop };
  }

  const complete = (rider: string, orderId: string, code: string) =>
    asUser(rider, (q) => q.one<{ r: string }>('select complete_delivery($1, $2) as r', [orderId, code])).then((row) => row!.r);

  it('gives each order a six-digit code that is not the same every time', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const codes = new Set<string>();
    for (let i = 0; i < 8; i++) codes.add((await orderRow(await placeOrder(customer, shop)))!.delivery_code);
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(5);
  });

  it('delivers with the right code and records the cash', async () => {
    const { orderId, rider } = await outForDelivery();
    const { delivery_code } = (await orderRow(orderId))!;
    expect(await complete(rider, orderId, delivery_code)).toBe('OK');
    const order = (await orderRow(orderId))!;
    expect(order.status).toBe('delivered');
    expect(order.cash_collected_paise).toBe(10000);
  });

  it('locks after five wrong codes, even for the right one, then recovers', async () => {
    const { orderId, rider } = await outForDelivery();
    const { delivery_code } = (await orderRow(orderId))!;
    const wrong = delivery_code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) expect(await complete(rider, orderId, wrong)).toBe('INVALID_DELIVERY_CODE');
    expect(await complete(rider, orderId, delivery_code)).toBe('CODE_LOCKED');
    expect((await orderRow(orderId))!.status).toBe('out_for_delivery');

    await asService((q) => q.rows(`update orders set delivery_code_locked_until = now() - interval '1 minute' where id = $1`, [orderId]));
    expect(await complete(rider, orderId, delivery_code)).toBe('OK');
  });

  it('does not let the customer or a rider read the code through the orders table', async () => {
    const { orderId, rider } = await outForDelivery();
    await expect(asUser(rider, (q) => q.rows('select delivery_code from orders where id = $1', [orderId]))).rejects.toThrow(/permission denied/);
    await expect(asUser(rider, (q) => q.rows('select delivery_code_attempts from orders where id = $1', [orderId]))).rejects.toThrow(/permission denied/);
  });
});

describe.skipIf(!HAS_DB)('order expiry (database)', () => {
  const pay = (cashfreeOrder: string, orderId: string, amountPaise = 10000) =>
    asService(async (q) => {
      await q.rows('update orders set cashfree_order_id = $2 where id = $1', [orderId, cashfreeOrder]);
      return q.rows('select mark_order_paid($1, $2, $3)', [cashfreeOrder, `pay_${cashfreeOrder}`, amountPaise]);
    });

  it('starts the shop’s clock when the money arrives, not when the order was placed', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop, { online: true });
    await asService((q) => q.rows(`update orders set accept_deadline_at = now() - interval '20 minutes' where id = $1`, [orderId]));

    await pay('cf_a', orderId);

    const order = (await orderRow(orderId))!;
    expect(order.status).toBe('payment_confirmed');
    expect(new Date(order.accept_deadline_at).getTime()).toBeGreaterThan(Date.now());
    const closed = await asService((q) => q.one<{ n: number }>('select expire_stale_orders() as n'));
    expect(closed!.n).toBe(0);
  });

  it('refuses a payment for the wrong amount', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop, { online: true });
    await expect(pay('cf_b', orderId, 5000)).rejects.toThrow(/AMOUNT_MISMATCH/);
  });

  it('times out a paid order the shop ignored, returns its stock and queues the refund', async () => {
    const shop = await makeShop({ stock: 10 });
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop, { online: true, quantity: 2 });
    expect(await stockOf(shop.productId)).toBe(8);

    await asService((q) =>
      q.rows(`insert into seller_payout_accounts (seller_id, cashfree_vendor_id, status) values ($1, 'shop_test', 'activated')`, [shop.sellerId])
    );
    await pay('cf_c', orderId, 20000);
    await asService((q) => q.rows(`update orders set accept_deadline_at = now() - interval '1 minute' where id = $1`, [orderId]));

    const closed = await asService((q) => q.one<{ n: number }>('select expire_stale_orders() as n'));
    expect(closed!.n).toBe(1);
    expect((await orderRow(orderId))!.status).toBe('timed_out');
    expect(await stockOf(shop.productId)).toBe(10);

    const refunds = await asService((q) => q.rows<{ order_id: string; amount_paise: number }>('select * from orders_needing_refund()'));
    expect(refunds.find((row) => row.order_id === orderId)?.amount_paise).toBe(20000);

    // Running it again changes nothing.
    const again = await asService((q) => q.one<{ n: number }>('select expire_stale_orders() as n'));
    expect(again!.n).toBe(0);
    expect(await stockOf(shop.productId)).toBe(10);
  });

  it('cancels an order left unpaid for 30 minutes and frees its stock', async () => {
    const shop = await makeShop({ stock: 5 });
    const customer = await makeCustomer();
    const stale = await placeOrder(customer, shop, { online: true });
    const fresh = await placeOrder(customer, shop, { online: true });
    await asService((q) => q.rows(`update orders set created_at = now() - interval '31 minutes' where id = $1`, [stale]));
    expect(await stockOf(shop.productId)).toBe(3);

    await asService((q) => q.rows('select expire_stale_orders()'));

    expect((await orderRow(stale))!.status).toBe('cancelled');
    expect((await orderRow(fresh))!.status).toBe('payment_required');
    expect(await stockOf(shop.productId)).toBe(4);
  });

  it('leaves an unpaid cash order waiting for the shop, as before', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop);
    await asService((q) => q.rows(`update orders set accept_deadline_at = now() - interval '1 day', created_at = now() - interval '1 day' where id = $1`, [orderId]));
    await asService((q) => q.rows('select expire_stale_orders()'));
    expect((await orderRow(orderId))!.status).toBe('pending');
  });

  it('keeps a late payment for a closed order on the books so it gets refunded', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop, { online: true });
    await asService((q) =>
      q.rows(`insert into seller_payout_accounts (seller_id, cashfree_vendor_id, status) values ($1, 'shop_late', 'activated')`, [shop.sellerId])
    );
    await asService((q) => q.rows(`update orders set created_at = now() - interval '40 minutes' where id = $1`, [orderId]));
    await asService((q) => q.rows('select expire_stale_orders()'));
    expect((await orderRow(orderId))!.status).toBe('cancelled');

    await pay('cf_late', orderId);

    const order = (await orderRow(orderId))!;
    expect(order.status).toBe('cancelled');
    expect(order.verified_prepaid_paise).toBe(10000);
    const refunds = await asService((q) => q.rows<{ order_id: string }>('select * from orders_needing_refund()'));
    expect(refunds.some((row) => row.order_id === orderId)).toBe(true);
  });
});
