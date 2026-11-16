import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { asService, asUser } from '../src/lib/db.js';
import { HAS_DB, makeCustomer, makeShop, placeOrder } from './db/helpers.js';

// The route asks Supabase who is calling; stood in for here.
let caller = '';
vi.mock('../src/lib/auth.js', () => ({ requireUser: async () => ({ id: caller, email: 'x@example.test' }) }));
vi.mock('../src/lib/supabase.js', () => ({ supabase: { storage: { from: () => ({}) } } }));

async function app() {
  const server = Fastify();
  await server.register((await import('../src/routes/seller-console.js')).sellerConsoleRoutes, { prefix: '/v1/seller' });
  return server;
}

type Row = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_pin: { lat: number; lng: number } | null;
  delivery_address: Record<string, string>;
  order_items: Array<{ name: string; image_url: string | null; unit_price_paise: number; line_total_paise: number }>;
  customer_id?: string;
};

describe.skipIf(!HAS_DB)('shop can call the customer (database)', () => {
  it('sees the phone and map pin while the order is in progress, and loses them once it ends', async () => {
    const server = await app();
    const shop = await makeShop();
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop);

    caller = shop.userId;
    const live = (await server.inject({ method: 'GET', url: '/v1/seller/orders' })).json().orders as Row[];
    const mine = live.find((o) => o.id === orderId)!;
    expect(mine.customer_phone).toBe('9123456780');
    // The test address is near 17.3855, 78.4880.
    expect(mine.customer_pin!.lat).toBeCloseTo(17.3855, 3);
    expect(mine.customer_pin!.lng).toBeCloseTo(78.488, 3);

    await asUser(shop.userId, (q) => q.rows('select seller_decide_order($1, false, $2)', [orderId, 'Closed early']));
    const after = (await server.inject({ method: 'GET', url: '/v1/seller/orders' })).json().orders as Row[];
    const ended = after.find((o) => o.id === orderId)!;
    expect(ended.customer_phone).toBeNull();
    expect(ended.customer_pin).toBeNull();
  });

  it('lists an order as waiting until the shop accepts or declines it, and only to its own shop', async () => {
    const server = await app();
    const shop = await makeShop();
    const other = await makeShop();
    const customer = await makeCustomer();
    const first = await placeOrder(customer, shop);
    const second = await placeOrder(customer, shop);
    const waiting = async () =>
      ((await server.inject({ method: 'GET', url: '/v1/seller/orders/waiting' })).json().waiting as Array<{ id: string }>).map((o) => o.id);

    caller = other.userId;
    expect(await waiting()).toEqual([]);

    caller = shop.userId;
    expect(await waiting()).toEqual([first, second]);

    await asUser(shop.userId, (q) => q.rows('select seller_decide_order($1, true, $2)', [first, '']));
    expect(await waiting()).toEqual([second]);

    await asUser(shop.userId, (q) => q.rows('select seller_decide_order($1, false, $2)', [second, 'Closed early']));
    expect(await waiting()).toEqual([]);
  });

  it('never shows one shop the customers of another', async () => {
    const server = await app();
    const shop = await makeShop();
    const other = await makeShop();
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop);

    caller = other.userId;
    const orders = (await server.inject({ method: 'GET', url: '/v1/seller/orders' })).json().orders as Row[];
    expect(orders.some((o) => o.id === orderId)).toBe(false);
  });

  it('heads the order with the customer account name, and shows the full address and item prices', async () => {
    const server = await app();
    const shop = await makeShop();
    const customer = await makeCustomer();
    // What Google sign-in leaves in the profile.
    await asService((q) => q.rows(`update profiles set full_name = 'Arpit Kumar' where id = $1`, [customer.userId]));
    const orderId = await placeOrder(customer, shop, { quantity: 2 });

    caller = shop.userId;
    const order = ((await server.inject({ method: 'GET', url: '/v1/seller/orders' })).json().orders as Row[]).find((o) => o.id === orderId)!;
    expect(order.customer_name).toBe('Arpit Kumar');
    // The customer's id is used to look the name up, never sent to the shop.
    expect(order.customer_id).toBeUndefined();
    expect(order.delivery_address.line1).toBe('12 Test Street');
    expect(order.order_items[0]).toMatchObject({ name: 'Biryani', unit_price_paise: 10000, line_total_paise: 20000 });
  });

  it('has no account name to show when the customer never gave one, so the card falls back to the delivery name', async () => {
    const server = await app();
    const shop = await makeShop();
    const customer = await makeCustomer();
    await asService((q) => q.rows(`update profiles set full_name = '' where id = $1`, [customer.userId]));
    const orderId = await placeOrder(customer, shop);

    caller = shop.userId;
    const order = ((await server.inject({ method: 'GET', url: '/v1/seller/orders' })).json().orders as Row[]).find((o) => o.id === orderId)!;
    expect(order.customer_name).toBeNull();
    expect(order.delivery_address.recipient).toBe('Customer');
  });
});

