import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { requireUser } from '../lib/auth.js';
import { asService, asUser } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { pushConfigured, subscriptionSchema } from '../lib/push.js';

const MAX_DEVICES = 10;

/** Browser alerts and the in-app inbox. Everything acts on the signed-in person only. */
export const pushRoutes: FastifyPluginAsync = async (app) => {
  /** Whether alerts can be turned on, and the public key the browser needs to subscribe. Not secret. */
  app.get('/push/config', async () => ({ enabled: pushConfigured(), publicKey: config.VAPID_PUBLIC_KEY ?? null }));

  /** Remembers this browser. Calling it again for the same browser is harmless. */
  app.post('/push/subscriptions', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    if (!pushConfigured()) throw new AppError(503, 'Browser alerts are not set up on the server yet.', 'PUSH_NOT_CONFIGURED');
    const body = subscriptionSchema.parse(request.body);
    const agent = String(request.headers['user-agent'] ?? '').slice(0, 200);

    await asService(async (q) => {
      // A browser signed in as someone else moves to this person: alerts must never follow the browser to the wrong account.
      await q.rows(
        `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
         values ($1, $2, $3, $4, $5)
         on conflict (endpoint) do update
           set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
               user_agent = excluded.user_agent, failures = 0`,
        [user.id, body.endpoint, body.keys.p256dh, body.keys.auth, agent]
      );
      // A person has a handful of devices; the oldest beyond that are dropped.
      await q.rows(
        `delete from push_subscriptions where user_id = $1 and id not in
           (select id from push_subscriptions where user_id = $1 order by created_at desc limit ${MAX_DEVICES})`,
        [user.id]
      );
    });
    return { ok: true };
  });

  app.post('/push/subscriptions/remove', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(request.body);
    await asService((q) => q.rows('delete from push_subscriptions where user_id = $1 and endpoint = $2', [user.id, endpoint]));
    return { ok: true };
  });

  /** Sends the caller a test alert through the real queue, so "does it work on my phone?" has an honest answer. */
  app.post('/push/test', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    const devices = await asService((q) =>
      q.one<{ n: number }>('select count(*)::int as n from push_subscriptions where user_id = $1', [user.id])
    );
    if (!devices?.n) throw new AppError(409, 'Turn on alerts on this device first.', 'NO_DEVICE');
    await asService((q) =>
      q.rows(`select notify($1, 'customer', 'system', 'Test alert', 'If you can read this, alerts work on this device.', '/', $2)`, [
        user.id,
        `test:${user.id}:${Date.now()}`
      ])
    );
    return { ok: true, devices: devices.n };
  });

  // ---------------------------------------------------------------- inbox

  app.get('/notifications', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const [items, unread] = await Promise.all([
        q.rows(
          `select id, role, channel, title, body, href, read_at, created_at
           from notifications where user_id = $1 order by created_at desc limit 30`,
          [user.id]
        ),
        q.one<{ n: number }>('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [user.id])
      ]);
      return { items, unread: unread?.n ?? 0 };
    });
  });

  app.post('/notifications/read', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { ids, all } = z
      .object({ ids: z.array(z.string().uuid()).max(50).optional(), all: z.boolean().optional() })
      .refine((value) => value.all || value.ids?.length, 'Say which notifications to mark read.')
      .parse(request.body);
    await asUser(user.id, (q) =>
      q.rows('update notifications set read_at = now() where user_id = $1 and read_at is null and ($2 or id = any($3::uuid[]))', [
        user.id,
        Boolean(all),
        ids ?? []
      ])
    );
    return { ok: true };
  });
};
