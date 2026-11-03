import { config } from '../config.js';
import { syncSubscription } from './billing.js';
import { cashfree, cashfreeConfigured, CashfreeError, toRupees } from './cashfree.js';
import { asService } from './db.js';

/**
 * The background jobs that keep orders and money tidy. The API runs them itself on a timer (startJobWorker),
 * so nothing depends on an outside scheduler; the /internal routes run the same functions on demand.
 *
 * Every job is safe to run twice or from two servers at once: expiry locks the rows it closes, and a refund
 * has a stable id per order and amount, so a repeat finds the refund already made.
 */

type Log = {
  info: (obj: object, message: string) => void;
  warn: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
};

type Pending = { order_id: string; cashfree_order: string; vendor_id: string; amount_paise: number };
type Refund = { cf_refund_id?: string | number; refund_id?: string; refund_status?: string };

/** A refund Cashfree has refused or abandoned must not be recorded as money returned. */
const FAILED = /^(CANCELLED|FAILED|REJECTED)$/i;
/**
 * Cashfree has the refund but is holding it (for example until the account has enough balance or
 * someone approves it). Money has not moved yet, so it is not recorded; the next run looks again.
 */
const WAITING = /^(ONHOLD|PENDING_APPROVAL)$/i;

/**
 * Closes orders nobody will act on: orders the shop did not accept in time, accepted orders the customer
 * did not pay for, and old paid-first orders the shop ignored. Their stock goes back on the shelf.
 */
export async function expireOrders() {
  const row = await asService((q) => q.one<{ closed: number }>('select expire_stale_orders() as closed'));
  return { closed: row?.closed ?? 0 };
}

/**
 * Returns online payments for orders the shop declined, timed out or the customer cancelled.
 * The refund names the shop's vendor so Easy Split takes the money back from that shop.
 */
export async function sweepRefunds(log: Log) {
  const pending = await asService((q) => q.rows<Pending>('select * from orders_needing_refund()'));

  let refunded = 0;
  const waiting: string[] = [];
  const failed: string[] = [];

  for (const item of pending) {
    // Stable per order and amount, so a retry after a crash finds the refund it already made.
    const refundId = `rf${item.order_id.replace(/-/g, '').slice(0, 20)}_${item.amount_paise}`;
    const amount = toRupees(item.amount_paise);
    const path = `/orders/${encodeURIComponent(item.cashfree_order)}/refunds`;
    const base = { refund_id: refundId, refund_amount: amount, refund_note: 'Order not fulfilled', refund_speed: 'STANDARD' };

    try {
      let refund: Refund;
      try {
        refund = await cashfree<Refund>('POST', path, { ...base, refund_splits: [{ vendor_id: item.vendor_id, amount }] });
      } catch (error) {
        if (!(error instanceof CashfreeError)) throw error;
        if (/already (exist|present)|duplicate/i.test(error.message)) {
          // We made this refund on an earlier run but did not get to record it.
          refund = await cashfree<Refund>('GET', `${path}/${encodeURIComponent(refundId)}`);
        } else if (/split|vendor/i.test(error.message)) {
          // Not a split order after all: refund plainly.
          refund = await cashfree<Refund>('POST', path, base);
        } else {
          throw error;
        }
      }

      if (refund.refund_status && FAILED.test(refund.refund_status)) throw new Error(`refund ${refund.refund_status}`);
      if (refund.refund_status && WAITING.test(refund.refund_status)) {
        waiting.push(item.order_id);
        continue;
      }

      await asService((q) =>
        q.rows('select record_refund($1, $2, $3)', [item.order_id, String(refund.cf_refund_id ?? refundId), item.amount_paise])
      );
      refunded += 1;
    } catch (cause) {
      log.error({ order: item.order_id, cause }, 'refund failed');
      failed.push(item.order_id);
    }
  }

  return { refunded, waiting, failed };
}

/** In-app reminders about trials ending, overdue subscriptions and licences expiring. */
export async function billingReminders() {
  const row = await asService((q) =>
    q.one<{ billing: number; compliance: number }>('select billing_reminders() as billing, compliance_reminders() as compliance')
  );
  return { lookedAt: row?.billing ?? 0, compliance: row?.compliance ?? 0 };
}

/**
 * Asks Cashfree about every mandate that should have paid or is about to, so a webhook that never
 * arrived cannot leave a paying shop suspended.
 */
export async function resyncBilling(log: Log) {
  const due = await asService((q) => q.rows<{ cashfree_subscription_id: string }>('select * from billing_syncable()'));
  let synced = 0;
  const failed: string[] = [];
  for (const item of due) {
    try {
      await syncSubscription(item.cashfree_subscription_id, log);
      synced += 1;
    } catch (cause) {
      log.error({ subscription: item.cashfree_subscription_id, cause }, 'subscription resync failed');
      failed.push(item.cashfree_subscription_id);
    }
  }
  return { synced, failed };
}

const MINUTE = 60_000;

/** How often each job runs inside the API. Expiry runs every minute so a 5-minute deadline is kept closely. */
export const SCHEDULE = {
  expire: MINUTE,
  refunds: MINUTE,
  reminders: 60 * MINUTE,
  resync: 4 * 60 * MINUTE
} as const;

type Job = keyof typeof SCHEDULE;

/**
 * Runs the jobs that are due at `now`, one after another, and returns which ones ran. A failing job is
 * logged and does not stop the others. Jobs that need Cashfree are skipped until its keys are set.
 */
export async function runDueJobs(lastRun: Partial<Record<Job, number>>, now: number, log: Log) {
  const due = (job: Job) => now - (lastRun[job] ?? 0) >= SCHEDULE[job];
  const ran: Job[] = [];

  const run = async (job: Job, task: () => Promise<unknown>) => {
    if (!due(job)) return;
    lastRun[job] = now;
    ran.push(job);
    try {
      const result = await task();
      log.info({ job, result }, 'background job ran');
    } catch (cause) {
      log.error({ job, cause }, 'background job failed');
    }
  };

  await run('expire', expireOrders);
  if (cashfreeConfigured()) await run('refunds', () => sweepRefunds(log));
  await run('reminders', billingReminders);
  if (cashfreeConfigured()) await run('resync', () => resyncBilling(log));
  return ran;
}

/**
 * Starts the timer. The first pass runs shortly after start-up, so a server that was asleep (Render's free
 * plan) catches up as soon as it wakes. Returns a function that stops it. Off when IN_PROCESS_JOBS is false
 * (for example when an outside scheduler calls the /internal routes instead) or without a database.
 */
export function startJobWorker(log: Log, tickMs = 15_000) {
  if (!config.IN_PROCESS_JOBS || !config.DATABASE_URL) return () => undefined;
  const lastRun: Partial<Record<Job, number>> = {};
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runDueJobs(lastRun, Date.now(), log)
      .catch((cause) => log.error({ cause }, 'background jobs failed'))
      .finally(() => {
        running = false;
      });
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, tickMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
