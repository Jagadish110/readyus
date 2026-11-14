import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { asUser } from '../src/lib/db.js';
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

type Row = { id: string; customer_phone: string | null; customer_pin: { lat: number; lng: number } | null };

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
});
