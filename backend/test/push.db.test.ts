import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asService } from '../src/lib/db.js';
import { drainPushQueue, type Sender } from '../src/lib/push.js';
import { HAS_DB, makeUser } from './db/helpers.js';

// The routes ask Supabase who is calling; here the caller is whoever the test says it is.
let caller = '';
vi.mock('../src/lib/auth.js', () => ({ requireUser: async () => ({ id: caller, email: 'x@example.test' }) }));

const keys = () => ({
  p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url'),
  auth: randomBytes(16).toString('base64url')
});
const endpoint = () => `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;

async function device(userId: string, url = endpoint()) {
  const k = keys();
  await asService((q) => q.rows('insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)', [userId, url, k.p256dh, k.auth]));
  return url;
}
const notify = (userId: string, title = 'Hello', channel = 'order', age = '0 seconds') =>
  asService((q) =>
    q.one<{ id: string }>(
      `insert into notifications (user_id, role, channel, title, body, href, dedupe_key, created_at)
       values ($1, 'seller', $2, $3, 'Body', '/business/orders', $4, now() - $5::interval) returning id`,
      [userId, channel, title, randomUUID(), age]
    )
  ).then((row) => row!.id);
const row = (id: string) => asService((q) => q.one<Record<string, any>>('select pushed_at, push_attempts, push_next_at from notifications where id = $1', [id]));
const recorder = (behave: (endpoint: string) => number | void = () => undefined) => {
  const calls: Array<{ endpoint: string; payload: any; options: any }> = [];
  const send: Sender = async (target, payload, options) => {
    calls.push({ endpoint: target.endpoint, payload: JSON.parse(payload), options });
    const status = behave(target.endpoint);
    if (status) throw Object.assign(new Error('push failed'), { statusCode: status });
  };
  return { calls, send };
};
// Every test starts with an empty queue, so a notification left by an earlier test is never counted.
beforeEach(async () => {
  if (HAS_DB) await asService((q) => q.rows('update notifications set pushed_at = now() where pushed_at is null'));
});

describe.skipIf(!HAS_DB)('sending browser alerts (database)', () => {
  it('sends each notification once to the person’s browser, then never again', async () => {
    const user = await makeUser('push');
    const url = await device(user);
    const id = await notify(user, 'New order received');
    const fake = recorder();

    expect(await drainPushQueue(fake.send)).toMatchObject({ claimed: 1, sent: 1 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ endpoint: url, options: { urgency: 'high' } });
    expect(fake.calls[0]!.payload).toMatchObject({ title: 'New order received', href: '/business/orders' });
    expect((await row(id))!.pushed_at).not.toBeNull();

    expect(await drainPushQueue(fake.send)).toMatchObject({ claimed: 0 });
    expect(fake.calls).toHaveLength(1);
  });

  it('sends only to the recipient’s own browsers', async () => {
    const mine = await makeUser('mine');
    const theirs = await makeUser('theirs');
    const myUrl = await device(mine);
    const theirUrl = await device(theirs);
    await notify(mine);
    const fake = recorder();
    await drainPushQueue(fake.send);
    expect(fake.calls.map((c) => c.endpoint)).toEqual([myUrl]);
    expect(fake.calls.map((c) => c.endpoint)).not.toContain(theirUrl);
  });

  it('reaches every browser the person turned alerts on in', async () => {
    const user = await makeUser('two');
    const phone = await device(user);
    const laptop = await device(user);
    await notify(user);
    const fake = recorder();
    expect(await drainPushQueue(fake.send)).toMatchObject({ sent: 2 });
    expect(fake.calls.map((c) => c.endpoint).sort()).toEqual([phone, laptop].sort());
  });

  it('marks a notification done when nobody has alerts on, without sending anything', async () => {
    const user = await makeUser('none');
    const id = await notify(user);
    const fake = recorder();
    expect(await drainPushQueue(fake.send)).toMatchObject({ claimed: 1, sent: 0, noDevices: 1 });
    expect(fake.calls).toHaveLength(0);
    expect((await row(id))!.pushed_at).not.toBeNull();
  });

  it('forgets a browser the vendor says is gone (404 or 410)', async () => {
    const user = await makeUser('gone');
    const dead = await device(user);
    const id = await notify(user);
    const fake = recorder((url) => (url === dead ? 410 : undefined));
    expect(await drainPushQueue(fake.send)).toMatchObject({ removed: 1, sent: 0 });
    const left = await asService((q) => q.rows('select 1 from push_subscriptions where endpoint = $1', [dead]));
    expect(left).toHaveLength(0);
    expect((await row(id))!.pushed_at).not.toBeNull();
  });

  it('tries again later when the push service is down, then succeeds', async () => {
    const user = await makeUser('retry');
    await device(user);
    const id = await notify(user);
    let down = true;
    const fake = recorder(() => (down ? 503 : undefined));

    expect(await drainPushQueue(fake.send)).toMatchObject({ retry: 1, sent: 0 });
    const after = (await row(id))!;
    expect(after.pushed_at).toBeNull();
    expect(new Date(after.push_next_at).getTime()).toBeGreaterThan(Date.now());

    // Not retried straight away.
    expect(await drainPushQueue(fake.send)).toMatchObject({ claimed: 0 });

    down = false;
    await asService((q) => q.rows('update notifications set push_next_at = now() where id = $1', [id]));
    expect(await drainPushQueue(fake.send)).toMatchObject({ sent: 1 });
    expect((await row(id))!.pushed_at).not.toBeNull();
  });

  it('does not resend to a browser that got it when another browser failed', async () => {
    const user = await makeUser('partial');
    const good = await device(user);
    const bad = await device(user);
    const id = await notify(user);
    const fake = recorder((url) => (url === bad ? 500 : undefined));
    await drainPushQueue(fake.send);
    expect((await row(id))!.pushed_at).not.toBeNull();
    expect(fake.calls.filter((c) => c.endpoint === good)).toHaveLength(1);
  });

  it('gives up after five tries and ignores notifications older than a day', async () => {
    const user = await makeUser('stale');
    await device(user);
    const tired = await notify(user);
    const old = await notify(user, 'Old', 'order', '2 days');
    await asService((q) => q.rows('update notifications set push_attempts = 5 where id = $1', [tired]));
    const fake = recorder();
    expect(await drainPushQueue(fake.send)).toMatchObject({ claimed: 0 });
    expect(fake.calls).toHaveLength(0);
    expect((await row(old))!.pushed_at).toBeNull();
  });

  it('never sends one notification twice when two workers run at once', async () => {
    const user = await makeUser('race');
    await device(user);
    for (let i = 0; i < 6; i++) await notify(user, `n${i}`);
    const fake = recorder();
    await Promise.all([drainPushQueue(fake.send, 3), drainPushQueue(fake.send, 3), drainPushQueue(fake.send, 3)]);
    await drainPushQueue(fake.send, 50);
    const titles = fake.calls.map((c) => c.payload.title).sort();
    expect(titles).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('is fed by the real database functions: a placed order alerts the shop', async () => {
    const { makeCustomer, makeShop, placeOrder } = await import('./db/helpers.js');
    const shop = await makeShop();
    const customer = await makeCustomer();
    await device(shop.userId);
    await asService((q) => q.rows('update notifications set pushed_at = now() where user_id = $1', [shop.userId]));
    await placeOrder(customer, shop);
    const fake = recorder();
    await drainPushQueue(fake.send);
    expect(fake.calls.map((c) => c.payload.title)).toEqual(['New order received']);
  });
});

describe.skipIf(!HAS_DB)('refund notice (database)', () => {
  it('tells the customer once when a refund starts, however often it is recorded', async () => {
    const { makeCustomer, makeShop, placeOrder } = await import('./db/helpers.js');
    const shop = await makeShop();
    const customer = await makeCustomer();
    const orderId = await placeOrder(customer, shop, { online: true });
    await asService(async (q) => {
      await q.rows('update orders set cashfree_order_id = $2 where id = $1', [orderId, 'cf_r_' + orderId.slice(0, 6)]);
      await q.rows('select mark_order_paid($1, $2, $3)', ['cf_r_' + orderId.slice(0, 6), 'pay_r_' + orderId.slice(0, 6), 10000]);
      await q.rows(`update orders set status = 'rejected' where id = $1`, [orderId]);
      await q.rows('select record_refund($1, $2, $3)', [orderId, 'rf_1_' + orderId.slice(0, 6), 10000]);
      await q.rows('select record_refund($1, $2, $3)', [orderId, 'rf_1_' + orderId.slice(0, 6), 10000]);
    });
    const notes = await asService((q) => q.rows<{ title: string; body: string }>(`select title, body from notifications where user_id = $1 and title = 'Refund started'`, [customer.userId]));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain('Rs 100.00');
    expect((await asService((q) => q.one<{ refunded_paise: number }>('select refunded_paise from orders where id = $1', [orderId])))!.refunded_paise).toBe(10000);
  });
});

describe.skipIf(!HAS_DB)('push and inbox routes (database)', () => {
  async function app() {
    const server = Fastify();
    const { pushRoutes } = await import('../src/routes/push.js');
    const { AppError } = await import('../src/lib/errors.js');
    const { ZodError } = await import('zod');
    server.setErrorHandler((error, _req, reply) => {
      if (error instanceof AppError) return reply.code(error.status).send({ error: error.message, code: error.code });
      if (error instanceof ZodError) return reply.code(400).send({ error: error.issues[0]?.message });
      return reply.code(500).send({ error: String(error) });
    });
    await server.register(pushRoutes, { prefix: '/v1' });
    return server;
  }
  const subscription = () => ({ endpoint: endpoint(), keys: keys() });

  it('tells the browser whether alerts are available and which public key to use', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: '/v1/push/config' });
    expect(response.json()).toMatchObject({ enabled: true });
    expect(response.json().publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
  });

  it('stores a browser once, moves it to whoever signs in next, and forgets it on request', async () => {
    const server = await app();
    const first = await makeUser('a');
    const second = await makeUser('b');
    const sub = subscription();

    caller = first;
    expect((await server.inject({ method: 'POST', url: '/v1/push/subscriptions', payload: sub })).statusCode).toBe(200);
    await server.inject({ method: 'POST', url: '/v1/push/subscriptions', payload: sub });
    const count = () => asService((q) => q.rows<{ user_id: string }>('select user_id from push_subscriptions where endpoint = $1', [sub.endpoint]));
    expect(await count()).toEqual([{ user_id: first }]);

    caller = second;
    await server.inject({ method: 'POST', url: '/v1/push/subscriptions', payload: sub });
    expect(await count()).toEqual([{ user_id: second }]);

    // Someone else cannot remove it.
    caller = first;
    await server.inject({ method: 'POST', url: '/v1/push/subscriptions/remove', payload: { endpoint: sub.endpoint } });
    expect(await count()).toHaveLength(1);
    caller = second;
    await server.inject({ method: 'POST', url: '/v1/push/subscriptions/remove', payload: { endpoint: sub.endpoint } });
    expect(await count()).toHaveLength(0);
  });

  it('refuses addresses outside the real push services and malformed keys', async () => {
    const server = await app();
    caller = await makeUser('c');
    const bad = await server.inject({ method: 'POST', url: '/v1/push/subscriptions', payload: { ...subscription(), endpoint: 'https://127.0.0.1/x' } });
    expect(bad.statusCode).toBe(400);
    const worse = await server.inject({ method: 'POST', url: '/v1/push/subscriptions', payload: { endpoint: endpoint(), keys: { p256dh: 'x', auth: 'y' } } });
    expect(worse.statusCode).toBe(400);
  });

  it('keeps only a person’s ten newest browsers', async () => {
    const server = await app();
    caller = await makeUser('many');
    for (let i = 0; i < 12; i++) await server.inject({ method: 'POST', url: '/v1/push/subscriptions', payload: subscription() });
    const n = await asService((q) => q.one<{ n: number }>('select count(*)::int as n from push_subscriptions where user_id = $1', [caller]));
    expect(n!.n).toBe(10);
  });

  it('sends a test alert only to someone who has turned alerts on', async () => {
    const server = await app();
    caller = await makeUser('test');
    expect((await server.inject({ method: 'POST', url: '/v1/push/test' })).statusCode).toBe(409);
    await server.inject({ method: 'POST', url: '/v1/push/subscriptions', payload: subscription() });
    expect((await server.inject({ method: 'POST', url: '/v1/push/test' })).statusCode).toBe(200);
    const fake = recorder();
    await drainPushQueue(fake.send);
    expect(fake.calls.map((c) => c.payload.title)).toContain('Test alert');
  });

  it('lists the inbox for the caller only, counts unread, and marks read', async () => {
    const server = await app();
    const me = await makeUser('inbox');
    const other = await makeUser('other');
    const mine = await notify(me, 'Mine');
    await notify(me, 'Also mine');
    await notify(other, 'Not mine');
    caller = me;

    const list = (await server.inject({ method: 'GET', url: '/v1/notifications' })).json();
    expect(list.items.map((i: any) => i.title).sort()).toEqual(['Also mine', 'Mine']);
    expect(list.unread).toBe(2);

    await server.inject({ method: 'POST', url: '/v1/notifications/read', payload: { ids: [mine] } });
    expect((await server.inject({ method: 'GET', url: '/v1/notifications' })).json().unread).toBe(1);

    // Another person's id in the list changes nothing for them.
    const theirs = await asService((q) => q.one<{ id: string }>('select id from notifications where user_id = $1', [other]));
    await server.inject({ method: 'POST', url: '/v1/notifications/read', payload: { ids: [theirs!.id] } });
    expect((await asService((q) => q.one<{ read_at: string | null }>('select read_at from notifications where id = $1', [theirs!.id])))!.read_at).toBeNull();

    await server.inject({ method: 'POST', url: '/v1/notifications/read', payload: { all: true } });
    expect((await server.inject({ method: 'GET', url: '/v1/notifications' })).json().unread).toBe(0);
    expect((await server.inject({ method: 'POST', url: '/v1/notifications/read', payload: {} })).statusCode).toBe(400);
  });
});
