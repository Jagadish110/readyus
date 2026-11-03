import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { drainPushQueue } from '../lib/push.js';
import { AppError } from '../lib/errors.js';
import { billingReminders, expireOrders, resyncBilling, sweepRefunds } from '../lib/jobs.js';

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Scheduled jobs prove themselves with `Authorization: Bearer $CRON_SECRET`. */
function requireCron(request: FastifyRequest) {
  const header = request.headers.authorization ?? '';
  if (!header.startsWith('Bearer ') || !safeEqual(header.slice(7), config.CRON_SECRET)) {
    throw new AppError(401, 'Unauthorized.');
  }
}

/**
 * The background jobs, on demand. The API already runs them itself on a timer (lib/jobs.ts); these routes
 * let an outside scheduler run them too, as a safety net or on a host that cannot keep a timer alive.
 */
export const internalRoutes: FastifyPluginAsync = async (app) => {
  const limit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  /** Returns online payments for orders the shop declined, timed out or the customer cancelled. */
  app.post('/refunds/sweep', limit, async (request) => {
    requireCron(request);
    return sweepRefunds(request.log);
  });

  /** Closes orders nobody will act on, and puts their stock back. */
  app.post('/orders/expire', limit, async (request) => {
    requireCron(request);
    return expireOrders();
  });

  /** In-app reminders about trials ending, overdue subscriptions and licences expiring. */
  app.post('/billing/reminders', limit, async (request) => {
    requireCron(request);
    return billingReminders();
  });

  /** Asks Cashfree about every mandate that should have paid or is about to. */
  app.post('/billing/resync', limit, async (request) => {
    requireCron(request);
    return resyncBilling(request.log);
  });

  /** The same pass the in-process push worker runs. */
  app.post('/push/drain', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    requireCron(request);
    return drainPushQueue();
  });
};
