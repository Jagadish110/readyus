import { describe, expect, it } from 'vitest';
import { asService, asUser } from '../src/lib/db.js';
import { assignRider, HAS_DB, makeAdmin, makeCustomer, makeRider, makeShop, orderRow, packedOrder, payOnline, placeOrder, stockOf } from './db/helpers.js';

const sql = (userId: string, text: string, values: unknown[] = []) => asUser(userId, (q) => q.rows(text, values));
const notices = (userId: string) =>
  asService((q) => q.rows<{ title: string; body: string }>('select title, body from notifications where user_id = $1 order by created_at', [userId]));
const refundList = () => asService((q) => q.rows<{ order_id: string; amount_paise: number }>('select * from orders_needing_refund()'));
const assignment = (orderId: string) => asService((q) => q.one<{ status: string; agent_id: string }>('select status, agent_id from delivery_assignments where order_id = $1', [orderId]));
const pickUp = (rider: string, orderId: string) => sql(rider, 'select pickup_delivery($1)', [orderId]);

describe.skipIf(!HAS_DB)('shop cancels after accepting (database)', () => {
  it('cancels, puts the stock back, frees the rider and tells everyone', async () => {
    const { shop, customer, orderId } = await packedOrder({ quantity: 2 });
    const rider = await assignRider(shop, orderId);
    expect(await stockOf(shop.productId)).toBe(8);

    await sql(shop.userId, 'select seller_cancel_order($1, $2)', [orderId, 'Ran out of rice']);

    const order = (await orderRow(orderId))!;
    expect(order.status).toBe('cancelled');
    expect(order.cancel_reason).toBe('Ran out of rice');
    expect(await stockOf(shop.productId)).toBe(10);
    expect((await assignment(orderId))!.status).toBe('cancelled');
    expect((await notices(customer.userId)).map((n) => n.title)).toContain('The shop cancelled your order');
    expect((await notices(rider)).map((n) => n.title)).toContain('Delivery cancelled');
    // The rider can no longer pick it up.
    await expect(pickUp(rider, orderId)).rejects.toThrow(/ASSIGNMENT_NOT_FOUND/);
  });

  it('queues a refund for an order that was paid online, and none for cash', async () => {
    const paid = await packedOrder({ online: true });
    const cash = await packedOrder();
    await sql(paid.shop.userId, 'select seller_cancel_order($1, $2)', [paid.orderId, 'Sorry']);
    await sql(cash.shop.userId, 'select seller_cancel_order($1, $2)', [cash.orderId, 'Sorry']);
    const list = await refundList();
    expect(list.find((r) => r.order_id === paid.orderId)?.amount_paise).toBe(10000);
    expect(list.some((r) => r.order_id === cash.orderId)).toBe(false);
    expect((await notices(paid.customer.userId)).find((n) => n.title === 'The shop cancelled your order')!.body).toContain('refunded');
  });

  it('works at every stage before pickup, and refuses afterwards or for anyone else', async () => {
    const waiting = await makeShop();
    const customer = await makeCustomer();
    const pending = await placeOrder(customer, waiting);
    await expect(sql(waiting.userId, 'select seller_cancel_order($1, $2)', [pending, 'x'])).rejects.toThrow(/ORDER_NOT_CANCELLABLE/);

    const { shop, orderId } = await packedOrder();
    const rider = await assignRider(shop, orderId);
    const other = await makeShop();
    await expect(sql(other.userId, 'select seller_cancel_order($1, $2)', [orderId, 'x'])).rejects.toThrow(/ORDER_NOT_FOUND/);
    await expect(sql(customer.userId, 'select seller_cancel_order($1, $2)', [orderId, 'x'])).rejects.toThrow(/SELLER_PROFILE_REQUIRED/);
    await expect(sql(rider, 'select seller_cancel_order($1, $2)', [orderId, 'x'])).rejects.toThrow(/SELLER_PROFILE_REQUIRED/);

    await pickUp(rider, orderId);
    await expect(sql(shop.userId, 'select seller_cancel_order($1, $2)', [orderId, 'x'])).rejects.toThrow(/ORDER_NOT_CANCELLABLE/);
  });
});

describe.skipIf(!HAS_DB)('a delivery that fails (database)', () => {
  async function outForDelivery(online = false) {
    const ctx = await packedOrder({ online });
    const rider = await assignRider(ctx.shop, ctx.orderId);
    await pickUp(rider, ctx.orderId);
    return { ...ctx, rider };
  }

  it('is not refunded automatically when the customer is at fault, but an admin can decide to refund', async () => {
    const { shop, customer, orderId, rider } = await outForDelivery(true);
    const admin = await makeAdmin();
    await sql(rider, `select report_delivery_failed($1, 'customer_unreachable', 'Phone off')`, [orderId]);

    const order = (await orderRow(orderId))!;
    expect(order.status).toBe('delivery_failed');
    expect(order.cancel_reason).toBe('The customer could not be reached: Phone off');
    expect((await assignment(orderId))!.status).toBe('cancelled');
    expect((await refundList()).some((r) => r.order_id === orderId)).toBe(false);
    expect((await notices(shop.userId)).map((n) => n.title)).toContain('Delivery failed');
    expect((await notices(customer.userId)).map((n) => n.title)).toContain('We could not deliver your order');
    expect((await notices(admin)).map((n) => n.title)).toContain('Delivery failed: decide on a refund');

    await sql(admin, 'select admin_request_refund($1, $2, $3)', [orderId, 10000, 'Customer disputed']);
    expect((await refundList()).find((r) => r.order_id === orderId)?.amount_paise).toBe(10000);
  });

  it('is cancelled and refunded when the rider or the shop is at fault', async () => {
    const byRider = await outForDelivery(true);
    await sql(byRider.rider, `select report_delivery_failed($1, 'rider_problem', 'Bike broke down')`, [byRider.orderId]);
    expect((await orderRow(byRider.orderId))!.status).toBe('cancelled');
    expect((await refundList()).find((r) => r.order_id === byRider.orderId)?.amount_paise).toBe(10000);

    const byShop = await outForDelivery(true);
    await sql(byShop.shop.userId, `select report_delivery_failed($1, 'shop_problem', '')`, [byShop.orderId]);
    expect((await orderRow(byShop.orderId))!.status).toBe('cancelled');
    expect((await refundList()).some((r) => r.order_id === byShop.orderId)).toBe(true);
  });

  it('lets the shop report it too, and nobody else', async () => {
    const { shop, orderId, rider } = await outForDelivery();
    const stranger = await makeRider(shop.sellerId);
    const otherShop = await makeShop();
    await expect(sql(stranger, `select report_delivery_failed($1, 'wrong_address', '')`, [orderId])).rejects.toThrow(/ORDER_NOT_FOUND/);
    await expect(sql(otherShop.userId, `select report_delivery_failed($1, 'wrong_address', '')`, [orderId])).rejects.toThrow(/ORDER_NOT_FOUND/);
    await expect(sql(rider, `select report_delivery_failed($1, 'because', '')`, [orderId])).rejects.toThrow(/UNKNOWN_CAUSE/);
    await sql(shop.userId, `select report_delivery_failed($1, 'wrong_address', 'No such street')`, [orderId]);
    expect((await orderRow(orderId))!.status).toBe('delivery_failed');
  });

  it('cannot be reported on an order that is not being delivered', async () => {
    const { shop, orderId } = await packedOrder();
    await expect(sql(shop.userId, `select report_delivery_failed($1, 'wrong_address', '')`, [orderId])).rejects.toThrow(/ORDER_NOT_DELIVERABLE/);
  });
});

describe.skipIf(!HAS_DB)('what the shop’s order list reads (database)', () => {
  it('can read the refund columns of its own orders and nothing secret next to them', async () => {
    const { shop, orderId } = await packedOrder({ online: true });
    const rows = await sql(shop.userId, 'select refunded_paise, refund_target_paise, verified_prepaid_paise from orders where id = $1', [orderId]);
    expect(rows).toEqual([{ refunded_paise: 0, refund_target_paise: 0, verified_prepaid_paise: 10000 }]);
    await expect(sql(shop.userId, 'select delivery_code from orders where id = $1', [orderId])).rejects.toThrow(/permission denied/);
  });
});

describe.skipIf(!HAS_DB)('a rider hands an order back (database)', () => {
  it('puts it back to packed so the shop can choose someone else', async () => {
    const { shop, orderId } = await packedOrder();
    const first = await assignRider(shop, orderId);
    await sql(first, `select release_delivery($1, 'Puncture')`, [orderId]);

    expect((await orderRow(orderId))!.status).toBe('packed');
    expect(await assignment(orderId)).toBeNull();
    expect((await notices(shop.userId)).find((n) => n.title === 'Rider handed an order back')!.body).toContain('Puncture');

    const second = await makeRider(shop.sellerId);
    const agent = await asService((q) => q.one<{ id: string }>('select id from delivery_agents where user_id = $1', [second]));
    await sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, agent!.id]);
    expect((await orderRow(orderId))!.status).toBe('assigned');
  });

  it('is not possible after pickup, or for someone else’s order', async () => {
    const { shop, orderId } = await packedOrder();
    const rider = await assignRider(shop, orderId);
    const other = await makeRider(shop.sellerId);
    await expect(sql(other, `select release_delivery($1, '')`, [orderId])).rejects.toThrow(/ASSIGNMENT_NOT_FOUND/);
    await pickUp(rider, orderId);
    await expect(sql(rider, `select release_delivery($1, '')`, [orderId])).rejects.toThrow(/ASSIGNMENT_NOT_FOUND/);
  });
});

describe.skipIf(!HAS_DB)('refunds after the fact (database)', () => {
  async function delivered() {
    const ctx = await packedOrder({ online: true, quantity: 3 }); // Rs 300, all paid online
    const rider = await assignRider(ctx.shop, ctx.orderId);
    await pickUp(rider, ctx.orderId);
    await sql(rider, 'select complete_delivery($1, $2)', [ctx.orderId, (await orderRow(ctx.orderId))!.delivery_code]);
    return ctx;
  }

  it('lets a shop return part of an online payment, in steps, never more than was paid', async () => {
    const { shop, orderId } = await delivered();
    await sql(shop.userId, 'select seller_request_refund($1, $2, $3)', [orderId, 10000, 'One item missing']);
    expect((await refundList()).find((r) => r.order_id === orderId)?.amount_paise).toBe(10000);

    await sql(shop.userId, 'select seller_request_refund($1, $2, $3)', [orderId, 15000, 'Cold as well']);
    expect((await refundList()).find((r) => r.order_id === orderId)?.amount_paise).toBe(25000);

    await expect(sql(shop.userId, 'select seller_request_refund($1, $2, $3)', [orderId, 10000, 'Too much'])).rejects.toThrow(/REFUND_TOO_LARGE/);
    await expect(sql(shop.userId, 'select seller_request_refund($1, $2, $3)', [orderId, 0, ''])).rejects.toThrow(/INVALID_AMOUNT/);
  });

  it('drops out of the list once the refund job has paid it, and counts what was already returned', async () => {
    const { shop, orderId } = await delivered();
    await sql(shop.userId, 'select seller_request_refund($1, $2, $3)', [orderId, 10000, 'Missing item']);
    await asService((q) => q.rows('select record_refund($1, $2, $3)', [orderId, 'rf_manual_' + orderId.slice(0, 6), 10000]));
    expect((await refundList()).some((r) => r.order_id === orderId)).toBe(false);
    // Another request adds on top of what is already refunded.
    await sql(shop.userId, 'select seller_request_refund($1, $2, $3)', [orderId, 20000, 'Rest']);
    expect((await refundList()).find((r) => r.order_id === orderId)?.amount_paise).toBe(20000);
    await expect(sql(shop.userId, 'select seller_request_refund($1, $2, $3)', [orderId, 1, 'x'])).rejects.toThrow(/REFUND_TOO_LARGE/);
  });

  it('is refused for another shop, a customer, and an order that was paid in cash', async () => {
    const { customer, orderId } = await delivered();
    const other = await makeShop();
    await expect(sql(other.userId, 'select seller_request_refund($1, $2, $3)', [orderId, 100, ''])).rejects.toThrow(/ORDER_NOT_FOUND/);
    await expect(sql(customer.userId, 'select seller_request_refund($1, $2, $3)', [orderId, 100, ''])).rejects.toThrow(/SELLER_PROFILE_REQUIRED/);
    await expect(sql(customer.userId, 'select admin_request_refund($1, $2, $3)', [orderId, 100, ''])).rejects.toThrow(/ADMIN_ONLY/);

    const cash = await packedOrder();
    await expect(sql(cash.shop.userId, 'select seller_request_refund($1, $2, $3)', [cash.orderId, 100, ''])).rejects.toThrow(/NOTHING_TO_REFUND/);
  });
});

describe.skipIf(!HAS_DB)('cash held by riders (database)', () => {
  async function cashDelivered(shop?: { userId: string; sellerId: string; productId: string }) {
    const ctx = shop
      ? await (async () => {
          const customer = await makeCustomer();
          const orderId = await placeOrder(customer, shop);
          await sql(shop.userId, 'select seller_decide_order($1, true)', [orderId]);
          await sql(shop.userId, `select seller_set_stage($1, 'packed')`, [orderId]);
          return { shop, customer, orderId };
        })()
      : await packedOrder();
    const rider = await assignRider(ctx.shop, ctx.orderId);
    await pickUp(rider, ctx.orderId);
    await sql(rider, 'select complete_delivery($1, $2)', [ctx.orderId, (await orderRow(ctx.orderId))!.delivery_code]);
    return { ...ctx, rider };
  }
  const agentOf = (userId: string) => asService((q) => q.one<{ id: string }>('select id from delivery_agents where user_id = $1', [userId])).then((r) => r!.id);

  it('shows the shop what each rider still owes, and the rider what to hand over', async () => {
    const { shop, rider, orderId } = await cashDelivered();
    const owed = await sql(shop.userId, 'select order_id, cash_paise, rider_name from cash_with_riders()');
    expect(owed).toEqual([{ order_id: orderId, cash_paise: 10000, rider_name: 'Rider' }]);
    const mine = await sql(rider, 'select shop_name, orders, cash_paise from my_cash_to_hand_over()');
    expect(mine).toEqual([{ shop_name: 'Test Kitchen', orders: 1, cash_paise: 10000 }]);
  });

  it('is cleared when the shop confirms receipt, for one order or all of a rider’s', async () => {
    const first = await cashDelivered();
    const second = await cashDelivered(first.shop);
    const agent = await agentOf(first.rider);
    expect(await sql(first.shop.userId, 'select cash_paise from cash_with_riders()')).toHaveLength(2);

    const one = await sql(first.shop.userId, 'select confirm_cash_handover($1, $2) as n', [agent, first.orderId]);
    expect(one).toEqual([{ n: 1 }]);
    expect(await sql(first.shop.userId, 'select order_id from cash_with_riders()')).toEqual([{ order_id: second.orderId }]);
    // Confirming the same order again changes nothing.
    expect(await sql(first.shop.userId, 'select confirm_cash_handover($1, $2) as n', [agent, first.orderId])).toEqual([{ n: 0 }]);

    const secondAgent = await agentOf(second.rider);
    expect(await sql(first.shop.userId, 'select confirm_cash_handover($1) as n', [secondAgent])).toEqual([{ n: 1 }]);
    expect(await sql(first.shop.userId, 'select * from cash_with_riders()')).toHaveLength(0);
    expect(await sql(first.rider, 'select * from my_cash_to_hand_over()')).toHaveLength(0);
  });

  it('is private to the shop that is owed, and only that shop can confirm it', async () => {
    const { shop, rider } = await cashDelivered();
    const other = await makeShop();
    expect(await sql(other.userId, 'select * from cash_with_riders()')).toHaveLength(0);
    expect(await sql(other.userId, 'select confirm_cash_handover($1) as n', [await agentOf(rider)])).toEqual([{ n: 0 }]);
    await expect(sql(rider, 'select confirm_cash_handover($1)', [await agentOf(rider)])).rejects.toThrow(/SELLER_PROFILE_REQUIRED/);
    expect(await sql(shop.userId, 'select * from cash_with_riders()')).toHaveLength(1);
  });

  it('does not list orders paid online (nothing was collected)', async () => {
    const ctx = await packedOrder({ online: true });
    const rider = await assignRider(ctx.shop, ctx.orderId);
    await pickUp(rider, ctx.orderId);
    await sql(rider, 'select complete_delivery($1, $2)', [ctx.orderId, (await orderRow(ctx.orderId))!.delivery_code]);
    expect(await sql(ctx.shop.userId, 'select * from cash_with_riders()')).toHaveLength(0);
  });
});

describe.skipIf(!HAS_DB)('customer problems (database)', () => {
  it('reaches the shop and the admins, can be resolved by the shop, and tells the customer', async () => {
    const { shop, customer, orderId } = await packedOrder();
    const admin = await makeAdmin();
    const [{ id }] = (await sql(customer.userId, `select report_order_issue($1, 'missing_item', 'No raita') as id`, [orderId])) as Array<{ id: string }>;

    expect((await notices(shop.userId)).map((n) => n.title)).toContain('A customer reported a problem');
    expect((await notices(admin)).map((n) => n.title)).toContain('Order problem reported');
    expect(await sql(shop.userId, 'select id, status, message from seller_order_issues()')).toEqual([{ id, status: 'open', message: 'No raita' }]);

    await sql(shop.userId, 'select resolve_order_issue($1, $2)', [id, 'Sent a refund of Rs 20']);
    expect((await sql(customer.userId, 'select status, resolution_note from my_order_issues($1)', [orderId]))[0]).toEqual({ status: 'resolved', resolution_note: 'Sent a refund of Rs 20' });
    expect((await notices(customer.userId)).map((n) => n.title)).toContain('Your problem was marked resolved');
  });

  it('lets an admin resolve any issue, but not another shop or customer', async () => {
    const { customer, orderId } = await packedOrder();
    const admin = await makeAdmin();
    const other = await makeShop();
    const stranger = await makeCustomer();
    const [{ id }] = (await sql(customer.userId, `select report_order_issue($1, 'late', '') as id`, [orderId])) as Array<{ id: string }>;
    await expect(sql(other.userId, 'select resolve_order_issue($1, $2)', [id, ''])).rejects.toThrow(/ISSUE_NOT_FOUND/);
    await expect(sql(stranger.userId, 'select resolve_order_issue($1, $2)', [id, ''])).rejects.toThrow(/ISSUE_NOT_FOUND/);
    await expect(sql(stranger.userId, `select report_order_issue($1, 'late', '')`, [orderId])).rejects.toThrow(/ORDER_NOT_FOUND/);
    await sql(admin, 'select resolve_order_issue($1, $2)', [id, 'Checked']);
  });

  it('is not possible before the shop has started, and is limited to three open at a time', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const waiting = await placeOrder(customer, shop);
    await expect(sql(customer.userId, `select report_order_issue($1, 'late', '')`, [waiting])).rejects.toThrow(/ORDER_NOT_STARTED/);

    await sql(shop.userId, 'select seller_decide_order($1, true)', [waiting]);
    for (let i = 0; i < 3; i++) await sql(customer.userId, `select report_order_issue($1, 'late', '')`, [waiting]);
    await expect(sql(customer.userId, `select report_order_issue($1, 'late', '')`, [waiting])).rejects.toThrow(/TOO_MANY_ISSUES/);
    await expect(sql(customer.userId, `select report_order_issue($1, 'rude', '')`, [waiting])).rejects.toThrow();
  });

  it('keeps the table itself private', async () => {
    const { customer } = await packedOrder();
    await expect(sql(customer.userId, 'select * from order_issues')).rejects.toThrow(/permission denied/);
  });
});
