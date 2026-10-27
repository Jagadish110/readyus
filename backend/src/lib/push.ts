import webpush from 'web-push';
import { z } from 'zod';
import { config, isProduction } from '../config.js';
import { asService } from './db.js';

/**
 * Browser notifications (Web Push).
 *
 * Every notification is a row in `notifications`. This file turns due rows into pushes to the
 * browsers a person has allowed alerts in. Delivery is "at least once, best effort": the browser
 * vendor may still drop or delay a message, which is why the in-app inbox always shows everything.
 */

export const pushConfigured = () => Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);

// ---------------------------------------------------------------- what a browser may register

/**
 * The server will POST to whatever address a browser registers, so addresses are limited to the push
 * services real browsers use. Otherwise a caller could point the server at an internal address.
 */
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export function isAllowedPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (!isProduction && config.PUSH_ALLOW_ANY_HOST) return true;
  return PUSH_HOSTS.some((pattern) => pattern.test(url.hostname));
}

const base64url = (bytes: number, label: string) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, `${label} is not valid.`)
    .refine((value) => Buffer.from(value, 'base64url').length === bytes, `${label} is not valid.`);

export const subscriptionSchema = z.object({
  endpoint: z.string().max(1000).refine(isAllowedPushEndpoint, 'That browser address is not supported.'),
  keys: z.object({ p256dh: base64url(65, 'Key'), auth: base64url(16, 'Key') })
});

// ---------------------------------------------------------------- what is sent

export type QueuedNotification = {
  id: string;
  user_id: string;
  role: string;
  channel: string;
  title: string;
  body: string;
  href: string | null;
  dedupe_key: string | null;
  push_attempts: number;
};

/** Keeps the click target on this site: a path, never a full address or a protocol-relative one. */
export const safeHref = (href: string | null) => (href && href.startsWith('/') && !href.startsWith('//') ? href : '/');

/** Small on purpose (browsers cap a push at about 4 KB) and free of anything not shown on screen. */
export function buildPayload(n: QueuedNotification): string {
  return JSON.stringify({
    id: n.id,
    title: n.title.slice(0, 80),
    body: n.body.slice(0, 180),
    href: safeHref(n.href),
    // Same tag = the newer message replaces the older one instead of stacking.
    tag: n.dedupe_key?.slice(0, 100) ?? n.id,
    channel: n.channel,
    role: n.role
  });
}

/** Orders, payments and deliveries are time-critical; the rest can wait for a sleeping phone. */
const URGENT = new Set(['order', 'payment', 'delivery']);
export const optionsFor = (channel: string) =>
  URGENT.has(channel) ? ({ urgency: 'high', ttl: 3600 } as const) : ({ urgency: 'normal', ttl: 86_400 } as const);

// ---------------------------------------------------------------- sending

export type Target = { endpoint: string; keys: { p256dh: string; auth: string } };
export type Sender = (target: Target, payload: string, options: { urgency: 'high' | 'normal'; ttl: number }) => Promise<void>;

let vapidReady = false;
/** The real sender. Replaced by a fake in tests. */
export const sendWebPush: Sender = async (target, payload, options) => {
  if (!vapidReady) {
    webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY!, config.VAPID_PRIVATE_KEY!);
    vapidReady = true;
  }
  await webpush.sendNotification(target, payload, { TTL: options.ttl, urgency: options.urgency, timeout: 10_000 });
};

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string; failures: number };
const statusOf = (error: unknown) => (error as { statusCode?: number } | null)?.statusCode;

export type DrainResult = { claimed: number; sent: number; removed: number; retry: number; noDevices: number };

/**
 * One pass over the queue. Safe to run from several processes at once (rows are leased) and to run
 * again after a crash (a notification is marked done only after the sends have been attempted).
 */
export async function drainPushQueue(
  send: Sender = sendWebPush,
  limit = 50,
  log?: { warn: (obj: object, message: string) => void }
): Promise<DrainResult> {
  const result: DrainResult = { claimed: 0, sent: 0, removed: 0, retry: 0, noDevices: 0 };
  const due = await asService((q) => q.rows<QueuedNotification>('select * from claim_notifications_for_push($1)', [limit]));
  result.claimed = due.length;

  for (const notification of due) {
    const devices = await asService((q) =>
      q.rows<Subscription>('select id, endpoint, p256dh, auth, failures from push_subscriptions where user_id = $1', [notification.user_id])
    );

    if (devices.length === 0) {
      result.noDevices += 1;
      await asService((q) => q.rows('update notifications set pushed_at = now() where id = $1', [notification.id]));
      continue;
    }

    const payload = buildPayload(notification);
    const options = optionsFor(notification.channel);
    let delivered = 0;
    let transient = false;

    for (const device of devices) {
      try {
        await send({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload, options);
        delivered += 1;
        await asService((q) => q.rows('update push_subscriptions set last_success_at = now(), failures = 0 where id = $1', [device.id]));
      } catch (error) {
        const status = statusOf(error);
        if (status === 404 || status === 410) {
          // The browser or the person cancelled this subscription for good.
          result.removed += 1;
          await asService((q) => q.rows('delete from push_subscriptions where id = $1', [device.id]));
        } else {
          transient = true;
          log?.warn({ status, device: device.id }, 'push send failed');
          await asService((q) =>
            q.rows('update push_subscriptions set failures = failures + 1 where id = $1', [device.id])
          );
          // A device that has failed twenty times in a row is no longer reachable; stop trying it.
          if (device.failures + 1 >= 20) await asService((q) => q.rows('delete from push_subscriptions where id = $1', [device.id]));
        }
      }
    }

    result.sent += delivered;
    if (delivered > 0 || !transient) {
      // Delivered to at least one device, or every device was gone: nothing more to try.
      await asService((q) => q.rows('update notifications set pushed_at = now() where id = $1', [notification.id]));
    } else {
      // Everything failed for a reason that may pass: try again later, a little longer each time.
      result.retry += 1;
      const seconds = 30 * notification.push_attempts ** 2;
      await asService((q) => q.rows(`update notifications set push_next_at = now() + make_interval(secs => $2) where id = $1`, [notification.id, seconds]));
    }
  }
  return result;
}

/** Runs the queue every few seconds inside the server process. Returns a function that stops it. */
export function startPushWorker(log: { warn: (obj: object, message: string) => void; error: (obj: object, message: string) => void }) {
  if (!pushConfigured() || !config.DATABASE_URL) return () => undefined;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    drainPushQueue(sendWebPush, 50, log)
      .catch((cause) => log.error({ cause }, 'push worker failed'))
      .finally(() => {
        running = false;
      });
  }, 3_000);
  return () => clearInterval(timer);
}
