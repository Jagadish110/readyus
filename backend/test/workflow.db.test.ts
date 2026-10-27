import { describe, expect, it } from 'vitest';
import { asService, asUser } from '../src/lib/db.js';
import { agentOf, HAS_DB, makeCustomer, makeRider, makeShop, makeUser, orderRow, placeOrder } from './db/helpers.js';

/**
 * The whole journey as the real people do it, through the same database functions the API calls:
 * customer orders -> shop accepts and prepares -> shop assigns its own rider -> rider collects and
 * delivers with the customer's code.
 */
const sql = (userId: string, text: string, values: unknown[] = []) => asUser(userId, (q) => q.rows(text, values));
const statuses = (orderId: string) =>
  asService((q) => q.rows<{ status: string }>('select status from order_events where order_id = $1 order by created_at, id', [orderId])).then((rows) => rows.map((r) => r.status));
const notices = (userId: string) =>
  asService((q) => q.rows<{ title: string }>('select title from notifications where user_id = $1 order by created_at', [userId])).then((rows) => rows.map((r) => r.title));

async function packedOrder(opts: { online?: boolean } = {}) {
  const shop = await makeShop();
  const customer = await makeCustomer();
  const orderId = await placeOrder(customer, shop, { online: opts.online });
  if (opts.online) {
    await asService(async (q) => {
      await q.rows('update orders set cashfree_order_id = $2 where id = $1', [orderId, 'cf_' + orderId.slice(0, 8)]);
      await q.rows('select mark_order_paid($1, $2, $3)', ['cf_' + orderId.slice(0, 8), 'pay_' + orderId.slice(0, 8), 10000]);
    });
  }
  await sql(shop.userId, 'select seller_decide_order($1, true)', [orderId]);
  await sql(shop.userId, `select seller_set_stage($1, 'preparing')`, [orderId]);
  await sql(shop.userId, `select seller_set_stage($1, 'packed')`, [orderId]);
  return { shop, customer, orderId };
}

describe.skipIf(!HAS_DB)('shop assigns a delivery partner (database)', () => {
  it('runs a cash order from placing to delivered', async () => {
    const { shop, customer, orderId } = await packedOrder();
    const rider = await makeRider(shop.sellerId);
    const agent = await agentOf(rider);

    await sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, agent]);
    expect((await orderRow(orderId))!.status).toBe('assigned');
    expect(await notices(rider)).toContain('New delivery for you');
    expect(await notices(customer.userId)).toContain('Delivery partner assigned');

    // The rider's own list shows exactly this delivery.
    const mine = await sql(rider, `select order_id, status from delivery_assignments where agent_id = current_agent_id()`);
    expect(mine).toEqual([{ order_id: orderId, status: 'claimed' }]);

    await sql(rider, 'select pickup_delivery($1)', [orderId]);
    const code = (await orderRow(orderId))!.delivery_code;
    const done = await sql(rider, 'select complete_delivery($1, $2) as r', [orderId, code]);
    expect(done).toEqual([{ r: 'OK' }]);

    const order = (await orderRow(orderId))!;
    expect(order.status).toBe('delivered');
    expect(order.cash_collected_paise + order.verified_prepaid_paise).toBe(order.total_paise);
    expect(await statuses(orderId)).toEqual(['pending', 'accepted', 'preparing', 'packed', 'assigned', 'out_for_delivery', 'delivered']);
  });

  it('runs an online-paid order and collects no cash', async () => {
    const { shop, orderId } = await packedOrder({ online: true });
    const rider = await makeRider(shop.sellerId);
    await sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, await agentOf(rider)]);
    const assignment = await asService((q) => q.one<{ cash_due_paise: number }>('select cash_due_paise from delivery_assignments where order_id = $1', [orderId]));
    expect(assignment!.cash_due_paise).toBe(0);

    await sql(rider, 'select pickup_delivery($1)', [orderId]);
    await sql(rider, 'select complete_delivery($1, $2)', [orderId, (await orderRow(orderId))!.delivery_code]);
    const order = (await orderRow(orderId))!;
    expect(order.cash_collected_paise).toBe(0);
    expect(order.verified_prepaid_paise).toBe(order.total_paise);
  });

  it('will not assign before the order is ready', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const rider = await makeRider(shop.sellerId);
    const orderId = await placeOrder(customer, shop);
    await sql(shop.userId, 'select seller_decide_order($1, true)', [orderId]);
    await expect(sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, await agentOf(rider)])).rejects.toThrow(/ORDER_NOT_READY/);
  });

  it('only assigns riders on this shop’s own team', async () => {
    const { shop, orderId } = await packedOrder();
    const other = await makeShop();
    const strangerRider = await makeRider(other.sellerId);
    await expect(sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, await agentOf(strangerRider)])).rejects.toThrow(/RIDER_NOT_IN_TEAM/);

    const removed = await makeRider(shop.sellerId);
    const removedAgent = await agentOf(removed);
    await asService((q) => q.rows('update delivery_relationships set active = false where agent_id = $1', [removedAgent]));
    await expect(sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, removedAgent])).rejects.toThrow(/RIDER_NOT_IN_TEAM/);
    expect((await orderRow(orderId))!.status).toBe('packed');
  });

  it('does not let another shop, a customer or a rider assign the order', async () => {
    const { shop, customer, orderId } = await packedOrder();
    const rider = await makeRider(shop.sellerId);
    const agent = await agentOf(rider);
    const other = await makeShop();
    await expect(sql(other.userId, 'select assign_delivery($1, $2)', [orderId, agent])).rejects.toThrow(/ORDER_NOT_FOUND|RIDER_NOT_IN_TEAM/);
    await expect(sql(customer.userId, 'select assign_delivery($1, $2)', [orderId, agent])).rejects.toThrow(/SELLER_PROFILE_REQUIRED/);
    await expect(sql(rider, 'select assign_delivery($1, $2)', [orderId, agent])).rejects.toThrow(/SELLER_PROFILE_REQUIRED/);
    expect((await orderRow(orderId))!.status).toBe('packed');
  });

  it('lets the shop change the rider until the food is picked up', async () => {
    const { shop, orderId } = await packedOrder();
    const first = await makeRider(shop.sellerId);
    const second = await makeRider(shop.sellerId);
    await sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, await agentOf(first)]);
    await sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, await agentOf(second)]);

    expect(await notices(first)).toContain('Delivery given to someone else');
    expect(await notices(second)).toContain('New delivery for you');
    // The first rider can no longer touch it.
    await expect(sql(first, 'select pickup_delivery($1)', [orderId])).rejects.toThrow(/ASSIGNMENT_NOT_FOUND/);

    await sql(second, 'select pickup_delivery($1)', [orderId]);
    await expect(sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, await agentOf(first)])).rejects.toThrow(/ORDER_ALREADY_PICKED_UP/);
    // Re-assigning the same rider is harmless.
    await expect(sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, await agentOf(second)])).rejects.toThrow(/ORDER_ALREADY_PICKED_UP/);
  });

  it('keeps a rider out of orders that were not assigned to them', async () => {
    const { shop, orderId } = await packedOrder();
    const assigned = await makeRider(shop.sellerId);
    const bystander = await makeRider(shop.sellerId);
    await sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, await agentOf(assigned)]);
    await expect(sql(bystander, 'select pickup_delivery($1)', [orderId])).rejects.toThrow(/ASSIGNMENT_NOT_FOUND/);
    expect(await sql(bystander, 'select 1 from delivery_assignments where order_id = $1', [orderId])).toHaveLength(0);
    // The old open-pool route is gone, so nobody can grab an order for themselves.
    await expect(sql(bystander, 'select claim_delivery($1)', [orderId])).rejects.toThrow(/does not exist/);
  });

  it('only a person with a delivery profile can be assigned', async () => {
    const { shop, orderId } = await packedOrder();
    const nobody = await makeUser('plain');
    await expect(sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, nobody])).rejects.toThrow(/RIDER_NOT_IN_TEAM/);
  });
});
