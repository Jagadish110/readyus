import { createSign } from 'node:crypto';
import { config } from '../config.js';

/**
 * Alerts for the phone app (Android), sent through Firebase Cloud Messaging.
 *
 * A phone registers its Firebase token with the server; the push worker (lib/push.ts) sends each due
 * notification to it here. No Firebase library is needed: the service account signs a short-lived token
 * (RFC 7523) and the message goes to the FCM HTTP v1 API.
 */

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let account: ServiceAccount | null | undefined;

/** The service account from FCM_SERVICE_ACCOUNT (the JSON file's text, or that text in base64). Null when unset or unreadable. */
export function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  account = null;
  const raw = config.FCM_SERVICE_ACCOUNT?.trim();
  if (!raw) return account;
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(text) as Partial<ServiceAccount>;
    if (parsed.project_id && parsed.client_email && parsed.private_key) {
      account = { project_id: parsed.project_id, client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, '\n') };
    }
  } catch {
    account = null;
  }
  return account;
}

export const fcmConfigured = () => serviceAccount() !== null;

/** Phones are stored in push_subscriptions with this prefix, so no new table is needed. */
export const FCM_PREFIX = 'fcm:';
export const isFcmEndpoint = (endpoint: string) => endpoint.startsWith(FCM_PREFIX);
export const fcmTokenOf = (endpoint: string) => endpoint.slice(FCM_PREFIX.length);

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');

let cached: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const sa = serviceAccount();
  if (!sa) throw new Error('FCM is not configured.');
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64(signature)}` }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Google sign-in for FCM failed (${response.status}).`);
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, until: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

export type PhoneAlert = {
  id: string;
  title: string;
  body: string;
  href: string;
  tag: string;
  channel: string;
  role: string;
};

/**
 * The Android channel an alert lands in. Only a shop's new order and a rider's new delivery ring; everything else
 * is a normal alert. The tag is the notification's dedupe key, set by the database ("order-placed:<id>").
 */
export const androidChannelFor = (alert: Pick<PhoneAlert, 'role' | 'tag'>) =>
  (alert.role === 'seller' && alert.tag.startsWith('order-placed:')) || (alert.role === 'delivery' && alert.tag.startsWith('assigned-rider:'))
    ? 'order-ring'
    : 'updates';

/** The FCM HTTP v1 message for one phone. Pure, so it can be tested without the network. */
export function buildFcmMessage(token: string, alert: PhoneAlert, urgent: boolean) {
  const channel = androidChannelFor(alert);
  return {
    message: {
      token,
      // `data` carries where a tap should go; the app reads it when the alert is opened.
      data: { id: alert.id, href: alert.href, role: alert.role, channel: alert.channel },
      android: {
        priority: urgent ? 'HIGH' : 'NORMAL',
        ttl: urgent ? '3600s' : '86400s',
        // Same tag = the newer message replaces the older one instead of stacking.
        collapse_key: alert.tag.slice(0, 100),
        notification: {
          title: alert.title,
          body: alert.body,
          channel_id: channel,
          tag: alert.tag.slice(0, 100),
          ...(channel === 'order-ring' ? { sound: 'order_ring', default_vibrate_timings: false, notification_priority: 'PRIORITY_MAX' } : {})
        }
      }
    }
  };
}

/** Sends one alert to one phone. Errors carry `statusCode` 404 when the phone's token is dead, so the worker drops it. */
export async function sendFcm(token: string, alert: PhoneAlert, urgent: boolean): Promise<void> {
  const sa = serviceAccount();
  if (!sa) throw new Error('FCM is not configured.');
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildFcmMessage(token, alert, urgent)),
    signal: AbortSignal.timeout(10_000)
  });
  if (response.ok) return;
  const text = await response.text().catch(() => '');
  // UNREGISTERED / a token FCM no longer knows: the app was uninstalled or its token rotated.
  const dead = response.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(text);
  throw Object.assign(new Error(`FCM ${response.status}`), { statusCode: dead ? 404 : response.status });
}
