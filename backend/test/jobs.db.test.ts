import { describe, expect, it } from 'vitest';
import { asService } from '../src/lib/db.js';
import { runDueJobs, SCHEDULE } from '../src/lib/jobs.js';
import { HAS_DB, makeCustomer, makeShop, orderRow, placeOrder, stockOf } from './db/helpers.js';

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe.skipIf(!HAS_DB)('background jobs inside the API (database)', () => {
  it('closes an order the shop did not accept in time, without any outside scheduler', async () => {
    const shop = await makeShop({ stock: 5 });
    const customer = await makeCustomer();
    const cash = await placeOrder(customer, shop);
    const online = await placeOrder(customer, shop, { online: true });
    await asService((q) =>
      q.rows(`update orders set accept_deadline_at = now() - interval '1 minute' where id = any($1::uuid[])`, [[cash, online]])
    );

    const lastRun = {};
    const ran = await runDueJobs(lastRun, Date.now(), quiet);

    expect(ran).toContain('expire');
    expect((await orderRow(cash))!.status).toBe('timed_out');
    expect((await orderRow(online))!.status).toBe('timed_out');
    expect(await stockOf(shop.productId)).toBe(5);
  });

  it('runs each job on its own schedule, and only when it is due', async () => {
    const lastRun = {};
    const start = Date.now();
    const first = await runDueJobs(lastRun, start, quiet);
    expect(first).toEqual(expect.arrayContaining(['expire', 'reminders']));

    // Straight after, nothing is due.
    expect(await runDueJobs(lastRun, start + 1_000, quiet)).toEqual([]);
    // A minute later, expiry runs again; the hourly reminders do not.
    const minute = await runDueJobs(lastRun, start + SCHEDULE.expire, quiet);
    expect(minute).toContain('expire');
    expect(minute).not.toContain('reminders');
    // An hour later the reminders run too.
    expect(await runDueJobs(lastRun, start + SCHEDULE.reminders, quiet)).toContain('reminders');
  });

  it('keeps going when one job fails', async () => {
    const errors: string[] = [];
    const log = { ...quiet, error: (_: object, message: string) => void errors.push(message) };
    await asService((q) => q.rows('alter function billing_reminders() rename to billing_reminders_off'));
    try {
      const ran = await runDueJobs({}, Date.now(), log);
      expect(ran).toEqual(expect.arrayContaining(['expire', 'reminders']));
      expect(errors).toContain('background job failed');
    } finally {
      await asService((q) => q.rows('alter function billing_reminders_off() rename to billing_reminders'));
    }
  });
});
