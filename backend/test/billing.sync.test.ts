import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getBilling, syncSubscription } from '../src/lib/billing.js';
import { asService } from '../src/lib/db.js';
import { HAS_DB, makeShop } from './db/helpers.js';

/**
 * Runs the real sync code against a fake Cashfree on the port the test environment points at.
 * What Cashfree "says" is set per test; the code under test must record only what is true.
 */
const fake = { status: 'ACTIVE', payments: [] as object[], calls: [] as string[] };
let server: Server;

beforeAll(async () => {
  if (!HAS_DB) return;
  server = createServer((request, response) => {
    fake.calls.push(`${request.method} ${request.url}`);
    response.setHeader('content-type', 'application/json');
    if (request.url?.endsWith('/payments')) return void response.end(JSON.stringify(fake.payments));
    response.end(JSON.stringify({ subscription_id: 'x', subscription_status: fake.status }));
  });
  await new Promise<void>((resolve) => server.listen(4599, '127.0.0.1', resolve));
});
afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  fake.status = 'ACTIVE';
  fake.payments = [];
  fake.calls = [];
});

const charge = (id: number, extra: object = {}) => ({
  cf_payment_id: id, payment_type: 'CHARGE', payment_status: 'SUCCESS', payment_amount: 499,
  payment_completion_time: new Date().toISOString(), ...extra
});

async function shopWithMandate(subscriptionId: string) {
  const shop = await makeShop();
  await asService((q) => q.rows('select attach_mandate($1, $2)', [shop.sellerId, subscriptionId]));
  return shop;
}

describe.skipIf(!HAS_DB)('syncing a subscription from Cashfree', () => {
  it('records the mandate status and each successful charge once', async () => {
    const shop = await shopWithMandate('sub_sync1');
    fake.payments = [
      { cf_payment_id: 1, payment_type: 'AUTH', payment_status: 'SUCCESS', payment_amount: 1 },
      charge(2),
      charge(3, { payment_status: 'FAILED' })
    ];

    const first = await syncSubscription('sub_sync1');
    expect(first!.mandate_status).toBe('ACTIVE');
    expect(first!.state).toBe('active');
    const paidThrough = first!.paid_through;

    // Reported again (webhook after the browser check): nothing changes.
    expect((await syncSubscription('sub_sync1'))!.paid_through).toBe(paidThrough);
    const rows = await asService((q) => q.rows('select * from subscription_payments where seller_id = $1', [shop.sellerId]));
    expect(rows).toHaveLength(1);
  });

  it('records nothing for a mandate that is only waiting for the owner', async () => {
    const shop = await shopWithMandate('sub_sync2');
    fake.status = 'INITIALIZED';
    const result = await syncSubscription('sub_sync2');
    expect(result!.mandate_status).toBe('INITIALIZED');
    expect(result!.paid_through).toBeNull();
    expect((await getBilling(shop.sellerId))!.state).toBe('trialing');
  });

  it('marks a mandate the owner cancelled at the bank', async () => {
    const shop = await shopWithMandate('sub_sync3');
    fake.status = 'CANCELLED';
    await syncSubscription('sub_sync3');
    expect((await getBilling(shop.sellerId))!.cancelled).toBe(true);
  });

  it('ignores a subscription that is not ours', async () => {
    expect(await syncSubscription('sub_stranger')).toBeNull();
  });

  it('skips a charge it cannot identify instead of guessing', async () => {
    const shop = await shopWithMandate('sub_sync4');
    fake.payments = [{ payment_type: 'CHARGE', payment_status: 'SUCCESS' }];
    const warnings: string[] = [];
    await syncSubscription('sub_sync4', { warn: (_o, message) => void warnings.push(message) });
    expect(warnings).toHaveLength(1);
    expect((await getBilling(shop.sellerId))!.paid_through).toBeNull();
  });
});

describe.skipIf(!HAS_DB)('Cashfree webhook for subscriptions', () => {
  const KEY = 'cfsk_ma_test_0123456789abcdef';
  async function post(body: object, signed = true) {
    const app = await buildApp();
    const raw = JSON.stringify(body);
    const timestamp = String(Date.now());
    const signature = signed ? createHmac('sha256', KEY).update(timestamp + raw).digest('base64') : 'bm9wZQ==';
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/cashfree',
      payload: raw,
      headers: { 'content-type': 'application/json', 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp }
    });
    await app.close();
    return response;
  }

  it('rejects an unsigned body and changes nothing', async () => {
    const shop = await shopWithMandate('sub_hook1');
    fake.payments = [charge(10)];
    const response = await post({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS', data: { subscription_id: 'sub_hook1' } }, false);
    expect(response.statusCode).toBe(401);
    expect((await getBilling(shop.sellerId))!.paid_through).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it('syncs from Cashfree on a signed event, ignoring what the body claims', async () => {
    const shop = await shopWithMandate('sub_hook2');
    fake.payments = [charge(11)];
    const response = await post({
      type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
      data: { subscription_id: 'sub_hook2', payment_amount: 1 }
    });
    expect(response.statusCode).toBe(200);
    expect((await getBilling(shop.sellerId))!.state).toBe('active');
  });

  it('acknowledges an event for a subscription it does not know', async () => {
    const response = await post({ type: 'SUBSCRIPTION_STATUS_CHANGED', data: { subscription_id: 'sub_nobody' } });
    expect(response.statusCode).toBe(200);
  });
});
