import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { asService } from '../src/lib/db.js';
import { HAS_DB, makeCustomer, makeRider, makeShop, makeUser, orderRow, packedOrder, placeOrder } from './db/helpers.js';

// The routes ask Supabase who is calling and (for deletion) to close a login; both are stood in for here.
let caller = '';
const closed: Array<[string, boolean]> = [];
let closeFails = false;
vi.mock('../src/lib/auth.js', () => ({ requireUser: async () => ({ id: caller, email: 'x@example.test' }) }));
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      admin: {
        deleteUser: async (id: string, soft: boolean) => {
          closed.push([id, soft]);
          return { error: closeFails ? { message: 'boom' } : null };
        }
      }
    },
    storage: { from: () => ({}) }
  }
}));

async function app() {
  const server = Fastify();
  const { AppError } = await import('../src/lib/errors.js');
  const { ZodError } = await import('zod');
  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ error: error.message, code: error.code });
    if (error instanceof ZodError) return reply.code(400).send({ error: error.issues[0]?.message });
    return reply.code(500).send({ error: String(error) });
  });
  await server.register((await import('../src/routes/customer.js')).customerRoutes, { prefix: '/v1' });
  await server.register((await import('../src/routes/account.js')).accountRoutes, { prefix: '/v1' });
  await server.register((await import('../src/routes/seller-console.js')).sellerConsoleRoutes, { prefix: '/v1/seller' });
  return server;
}
const sql = <T = Record<string, any>>(text: string, values: unknown[] = []) => asService((q) => q.rows<T>(text, values));
const addAddress = (userId: string, line1: string, isDefault = false) =>
  sql<{ id: string }>(
    `insert into addresses (user_id, line1, phone, recipient, city, location, is_default)
     values ($1, $2, '9123456780', 'Customer', 'Pune', st_setsrid(st_makepoint(78.4880, 17.3855), 4326)::geography, $3) returning id`,
    [userId, line1, isDefault]
  ).then((rows) => rows[0]!.id);

describe.skipIf(!HAS_DB)('saved addresses (database)', () => {
  it('can be made the default, and deleting the default promotes another', async () => {
    const server = await app();
    const me = await makeUser('addr');
    caller = me;
    const first = await addAddress(me, 'First', true);
    const second = await addAddress(me, 'Second');

    expect((await server.inject({ method: 'POST', url: `/v1/addresses/${second}/default` })).statusCode).toBe(200);
    expect(await sql('select id, is_default from addresses where user_id = $1 order by line1', [me])).toEqual([
      { id: first, is_default: false },
      { id: second, is_default: true }
    ]);

    expect((await server.inject({ method: 'POST', url: `/v1/addresses/${second}/delete` })).statusCode).toBe(200);
    expect(await sql('select id, is_default from addresses where user_id = $1', [me])).toEqual([{ id: first, is_default: true }]);
  });

  it('cannot touch someone else’s address', async () => {
    const server = await app();
    const owner = await makeUser('own');
    const other = await makeUser('oth');
    const address = await addAddress(owner, 'Mine');
    caller = other;
    expect((await server.inject({ method: 'POST', url: `/v1/addresses/${address}/delete` })).statusCode).toBe(404);
    expect((await server.inject({ method: 'POST', url: `/v1/addresses/${address}/default` })).statusCode).toBe(404);
    expect(await sql('select 1 from addresses where id = $1', [address])).toHaveLength(1);
  });

  it('does not change orders already placed from it', async () => {
    const server = await app();
    const shop = await makeShop();
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop);
    caller = customer.userId;
    await server.inject({ method: 'POST', url: `/v1/addresses/${customer.addressId}/delete` });
    expect((await orderRow(orderId))!.delivery_address.line1).toBe('12 Test Street');
  });
});

describe.skipIf(!HAS_DB)('favourite shops (database)', () => {
  it('can be added, listed with whether they can take orders now, and removed', async () => {
    const server = await app();
    const shop = await makeShop();
    caller = await makeUser('fan');
    expect((await server.inject({ method: 'POST', url: `/v1/favourites/shops/${shop.sellerId}`, payload: { on: true } })).statusCode).toBe(200);
    await server.inject({ method: 'POST', url: `/v1/favourites/shops/${shop.sellerId}`, payload: { on: true } });

    const list = (await server.inject({ method: 'GET', url: '/v1/favourites' })).json().shops;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: shop.sellerId, shop_name: 'Test Kitchen', available: true, is_open: true });

    await server.inject({ method: 'POST', url: `/v1/favourites/shops/${shop.sellerId}`, payload: { on: false } });
    expect((await server.inject({ method: 'GET', url: '/v1/favourites' })).json().shops).toHaveLength(0);
  });

  it('shows a shop that has closed as unavailable, hides one that is not approved, and refuses to add it', async () => {
    const server = await app();
    const shop = await makeShop();
    const pending = await makeShop({ approved: false, fssai: false });
    caller = await makeUser('fan2');
    await server.inject({ method: 'POST', url: `/v1/favourites/shops/${shop.sellerId}`, payload: { on: true } });
    expect((await server.inject({ method: 'POST', url: `/v1/favourites/shops/${pending.sellerId}`, payload: { on: true } })).statusCode).toBe(404);

    await sql('update sellers set business_open = false where id = $1', [shop.sellerId]);
    expect((await server.inject({ method: 'GET', url: '/v1/favourites' })).json().shops[0]).toMatchObject({ is_open: false });
  });

  it('is private to each person', async () => {
    const server = await app();
    const shop = await makeShop();
    caller = await makeUser('a');
    await server.inject({ method: 'POST', url: `/v1/favourites/shops/${shop.sellerId}`, payload: { on: true } });
    caller = await makeUser('b');
    expect((await server.inject({ method: 'GET', url: '/v1/favourites' })).json().shops).toHaveLength(0);
  });
});

describe.skipIf(!HAS_DB)('deleting a product (database)', () => {
  it('removes it from the menu but leaves past orders readable', async () => {
    const server = await app();
    const shop = await makeShop();
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop);
    caller = shop.userId;
    expect((await server.inject({ method: 'POST', url: `/v1/seller/products/${shop.productId}/delete` })).statusCode).toBe(200);
    expect(await sql('select 1 from products where id = $1', [shop.productId])).toHaveLength(0);
    expect(await sql('select name, product_id from order_items where order_id = $1', [orderId])).toEqual([{ name: 'Biryani', product_id: null }]);
  });

  it('cannot delete another shop’s product, or a product twice', async () => {
    const server = await app();
    const mine = await makeShop();
    const theirs = await makeShop();
    caller = mine.userId;
    expect((await server.inject({ method: 'POST', url: `/v1/seller/products/${theirs.productId}/delete` })).statusCode).toBe(404);
    expect(await sql('select 1 from products where id = $1', [theirs.productId])).toHaveLength(1);
    await server.inject({ method: 'POST', url: `/v1/seller/products/${mine.productId}/delete` });
    expect((await server.inject({ method: 'POST', url: `/v1/seller/products/${mine.productId}/delete` })).statusCode).toBe(404);
  });
});

describe.skipIf(!HAS_DB)('erasing an account (database)', () => {
  async function customerWithHistory() {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop);
    await sql(`update orders set status = 'delivered', delivered_at = now() where id = $1`, [orderId]);
    await sql(`update profiles set full_name = 'Asha Reddy', phone = '9123456780', email = 'asha@example.test' where id = $1`, [customer.userId]);
    await sql(`insert into favourite_sellers (user_id, seller_id) values ($1, $2)`, [customer.userId, shop.sellerId]);
    await sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')`, [customer.userId, 'https://fcm.googleapis.com/fcm/send/' + customer.userId]);
    return { shop, customer, orderId };
  }

  it('removes who and where, keeps the order and its money', async () => {
    const { customer, orderId } = await customerWithHistory();
    await sql('select anonymize_customer($1)', [customer.userId]);

    const order = (await orderRow(orderId))!;
    expect(order.delivery_address).toEqual({ city: 'Hyderabad', pincode: '' });
    expect(order.customer_note).toBe('');
    expect(order.total_paise).toBe(10000);
    expect(order.status).toBe('delivered');
    expect(await sql('select name from order_items where order_id = $1', [orderId])).toHaveLength(1);

    expect(await sql('select full_name, phone, email, status from profiles where id = $1', [customer.userId])).toEqual([
      { full_name: 'Deleted user', phone: null, email: null, status: 'disabled' }
    ]);
    for (const table of ['addresses', 'cart_items', 'favourite_sellers', 'notifications', 'push_subscriptions']) {
      expect(await sql(`select 1 from ${table} where user_id = $1`, [customer.userId]), table).toHaveLength(0);
    }
  });

  it('blurs the delivery point to about a kilometre', async () => {
    const { customer, orderId } = await customerWithHistory();
    const before = (await sql<{ lng: number; lat: number }>('select st_x(delivery_location::geometry) lng, st_y(delivery_location::geometry) lat from orders where id = $1', [orderId]))[0]!;
    await sql('select anonymize_customer($1)', [customer.userId]);
    const after = (await sql<{ lng: number; lat: number }>('select st_x(delivery_location::geometry) lng, st_y(delivery_location::geometry) lat from orders where id = $1', [orderId]))[0]!;
    expect(after.lng).not.toBe(before.lng);
    expect(Math.abs(after.lng - before.lng)).toBeLessThanOrEqual(0.006);
    expect(Math.abs(after.lat - before.lat)).toBeLessThanOrEqual(0.006);
  });

  it('refuses while an order is open, a shop or delivery account, or a refund is on its way', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    await placeOrder(customer, shop);
    await expect(sql('select anonymize_customer($1)', [customer.userId])).rejects.toThrow(/ACTIVE_ORDERS/);
    await expect(sql('select anonymize_customer($1)', [shop.userId])).rejects.toThrow(/HAS_SHOP/);
    const rider = await makeRider(shop.sellerId);
    await expect(sql('select anonymize_customer($1)', [rider])).rejects.toThrow(/HAS_DELIVERY_PROFILE/);

    const done = await customerWithHistory();
    await sql(`update orders set verified_prepaid_paise = 10000, required_online_paise = 10000, refund_target_paise = 5000 where id = $1`, [done.orderId]);
    await expect(sql('select anonymize_customer($1)', [done.customer.userId])).rejects.toThrow(/REFUND_PENDING/);
  });

  it('is not callable from a browser', async () => {
    const { asUser } = await import('../src/lib/db.js');
    const { customer } = await customerWithHistory();
    await expect(asUser(customer.userId, (q) => q.rows('select anonymize_customer($1)', [customer.userId]))).rejects.toThrow(/permission denied/);
  });

  it('through the API: needs the word DELETE, erases, then closes the login', async () => {
    const server = await app();
    const { customer } = await customerWithHistory();
    caller = customer.userId;
    closed.length = 0;

    expect((await server.inject({ method: 'POST', url: '/v1/account/delete', payload: { confirm: 'yes' } })).statusCode).toBe(400);
    expect(closed).toHaveLength(0);

    const done = await server.inject({ method: 'POST', url: '/v1/account/delete', payload: { confirm: 'DELETE' } });
    expect(done.statusCode).toBe(200);
    expect(closed).toEqual([[customer.userId, true]]);
    expect((await sql('select full_name from profiles where id = $1', [customer.userId]))[0]).toEqual({ full_name: 'Deleted user' });
  });

  it('through the API: says so plainly when an order is open, and reports a login that would not close', async () => {
    const server = await app();
    const shop = await makeShop();
    const busy = await makeCustomer();
    await placeOrder(busy, shop);
    caller = busy.userId;
    const refused = await server.inject({ method: 'POST', url: '/v1/account/delete', payload: { confirm: 'DELETE' } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toContain('order in progress');

    const { customer } = await customerWithHistory();
    caller = customer.userId;
    closeFails = true;
    try {
      const failed = await server.inject({ method: 'POST', url: '/v1/account/delete', payload: { confirm: 'DELETE' } });
      expect(failed.statusCode).toBe(502);
      expect(failed.json().code).toBe('LOGIN_NOT_CLOSED');
    } finally {
      closeFails = false;
    }
    // The details are already gone, so trying again later simply finishes the job.
    expect((await server.inject({ method: 'POST', url: '/v1/account/delete', payload: { confirm: 'DELETE' } })).statusCode).toBe(200);
  });

  it('exports only the caller’s own data', async () => {
    const server = await app();
    const mine = await customerWithHistory();
    const other = await customerWithHistory();
    caller = mine.customer.userId;
    const data = (await server.inject({ method: 'GET', url: '/v1/account/export' })).json();
    expect(data.profile).toMatchObject({ full_name: 'Asha Reddy', email: 'asha@example.test' });
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0].items).toEqual([{ name: 'Biryani', quantity: 1, price_paise: 10000 }]);
    expect(data.addresses).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain(other.customer.userId);
    expect(JSON.stringify(data)).not.toContain('delivery_code');
  });
});
