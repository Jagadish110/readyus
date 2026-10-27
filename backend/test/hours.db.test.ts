import { describe, expect, it } from 'vitest';
import { asAnon, asService, asUser } from '../src/lib/db.js';
import { HAS_DB, makeCustomer, makeShop, orderRow, payOnline, placeOrder } from './db/helpers.js';

const open = (sellerId: string) => asService((q) => q.one<{ o: boolean }>('select shop_is_open_now($1) as o', [sellerId])).then((r) => r!.o);
/** Sets the shop's hours relative to the current time in India, in minutes (negative = earlier). */
const hours = (sellerId: string, from: number, to: number) =>
  asService((q) =>
    q.rows(
      `update sellers set
         open_time = to_char((now() at time zone 'Asia/Kolkata')::time + make_interval(mins => $2), 'HH24:MI'),
         close_time = to_char((now() at time zone 'Asia/Kolkata')::time + make_interval(mins => $3), 'HH24:MI')
       where id = $1`,
      [sellerId, from, to]
    )
  );
const listed = (sellerId: string, openOnly = false) =>
  asAnon((q) =>
    q.rows<{ id: string; business_open: boolean; open_time: string; close_time: string }>(
      'select * from nearby_sellers(17.3855, 78.4880, 5, null, $1, null, 1000, 0)',
      [openOnly]
    )
  ).then((rows) => rows.find((row) => row.id === sellerId));

describe.skipIf(!HAS_DB)('opening hours (database)', () => {
  it('is open inside the hours and closed outside them, in India time', async () => {
    const shop = await makeShop();
    await hours(shop.sellerId, -60, 60);
    expect(await open(shop.sellerId)).toBe(true);
    await hours(shop.sellerId, 60, 120);
    expect(await open(shop.sellerId)).toBe(false);
    await hours(shop.sellerId, -180, -60);
    expect(await open(shop.sellerId)).toBe(false);
  });

  it('handles hours that cross midnight, and equal times meaning all day', async () => {
    const shop = await makeShop();
    // From 1 hour ago until 3 hours ago (next day): open now.
    await hours(shop.sellerId, -60, -180);
    expect(await open(shop.sellerId)).toBe(true);
    // Opens in 30 minutes, closed 30 minutes ago (so open the long way round, except for the hour around now): closed now.
    await hours(shop.sellerId, 30, -30);
    expect(await open(shop.sellerId)).toBe(false);
    await asService((q) => q.rows(`update sellers set open_time = '06:00', close_time = '06:00' where id = $1`, [shop.sellerId]));
    expect(await open(shop.sellerId)).toBe(true);
  });

  it('is closed whatever the hours say when the owner has switched orders off', async () => {
    const shop = await makeShop();
    await asService((q) => q.rows('update sellers set business_open = false where id = $1', [shop.sellerId]));
    expect(await open(shop.sellerId)).toBe(false);
  });

  it('does not lock a shop out because its hours cannot be read', async () => {
    const shop = await makeShop();
    await asService((q) => q.rows(`update sellers set open_time = 'soon', close_time = 'later' where id = $1`, [shop.sellerId]));
    expect(await open(shop.sellerId)).toBe(true);
  });

  it('shows a closed shop to customers with its hours, hides it from "open only", and refuses an order', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    await hours(shop.sellerId, 60, 120);

    const row = await listed(shop.sellerId);
    expect(row).toMatchObject({ business_open: false });
    expect(row!.open_time).toMatch(/^\d{2}:\d{2}$/);
    expect(await listed(shop.sellerId, true)).toBeUndefined();
    await expect(placeOrder(customer, shop)).rejects.toThrow(/SHOP_CLOSED/);

    await hours(shop.sellerId, -60, 60);
    expect(await listed(shop.sellerId, true)).toMatchObject({ business_open: true });
    await placeOrder(customer, shop);
  });

  it('does not stop orders that were already placed from being finished after closing time', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop);
    await hours(shop.sellerId, 60, 120);
    await asUser(shop.userId, (q) => q.rows('select seller_decide_order($1, true)', [orderId]));
    expect((await orderRow(orderId))!.status).toBe('accepted');
  });
});

describe.skipIf(!HAS_DB)('auto-accept (database)', () => {
  const on = (sellerId: string) => asService((q) => q.rows('update sellers set auto_accept = true where id = $1', [sellerId]));
  const events = (orderId: string) =>
    asService((q) => q.rows<{ status: string; note: string }>('select status, note from order_events where order_id = $1 order by created_at, id', [orderId]));

  it('accepts a cash order the moment it is placed', async () => {
    const shop = await makeShop();
    await on(shop.sellerId);
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop);

    const order = (await orderRow(orderId))!;
    expect(order.status).toBe('accepted');
    expect(order.accepted_at).not.toBeNull();
    expect((await events(orderId)).map((e) => e.status)).toEqual(['pending', 'accepted']);
    const notes = await asService((q) => q.rows<{ title: string }>('select title from notifications where user_id = $1', [customer.userId]));
    expect(notes.map((n) => n.title)).toContain('Order accepted');
  });

  it('waits for an online payment before accepting, then accepts', async () => {
    const shop = await makeShop();
    await on(shop.sellerId);
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop, { online: true });
    expect((await orderRow(orderId))!.status).toBe('payment_required');

    await payOnline(orderId);
    expect((await orderRow(orderId))!.status).toBe('accepted');
  });

  it('leaves orders alone when the shop has not asked for it', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const cash = await placeOrder(customer, shop);
    const online = await placeOrder(customer, shop, { online: true });
    await payOnline(online);
    expect((await orderRow(cash))!.status).toBe('pending');
    expect((await orderRow(online))!.status).toBe('payment_confirmed');
  });

  it('cannot be triggered from a browser, and does nothing twice', async () => {
    const shop = await makeShop();
    await on(shop.sellerId);
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop);
    await expect(asUser(customer.userId, (q) => q.rows('select maybe_auto_accept($1)', [orderId]))).rejects.toThrow(/permission denied/);
    await asService((q) => q.rows('select maybe_auto_accept($1)', [orderId]));
    expect((await events(orderId)).filter((e) => e.status === 'accepted')).toHaveLength(1);
  });
});
