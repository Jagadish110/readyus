import { api, API_URL } from '@/lib/api/client';

/**
 * Browser alerts, from the browser's side: is it possible here, is it on, turn it on or off.
 * The server decides what is sent; this only manages this one browser's subscription.
 */

export type PushState =
  | 'loading'
  | 'unsupported' // an old browser, or one that blocks service workers
  | 'install-first' // iPhone/iPad Safari: alerts need the site added to the Home Screen
  | 'unconfigured' // the server has no VAPID keys yet
  | 'blocked' // the person said no, or the browser setting is off
  | 'off'
  | 'on';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const urlBase64ToBytes = (value: string) => {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => {
  if (!a) return false;
  const left = new Uint8Array(a);
  return left.length === b.length && left.every((byte, index) => byte === b[index]);
};

/** The browser's subscription for the server's current key, replacing one made with an older key. */
async function ensureSubscription(registration: ServiceWorkerRegistration, key: string) {
  const wanted = urlBase64ToBytes(key);
  let subscription = await registration.pushManager.getSubscription();
  // Keys were changed on the server: the old subscription can never receive anything again.
  if (subscription && !sameKey(subscription.options.applicationServerKey, wanted)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  return subscription ?? registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
}

async function serverKey(): Promise<string | null> {
  try {
    const response = await fetch(`${API_URL}/v1/push/config`, { cache: 'no-store' });
    const body = (await response.json()) as { enabled?: boolean; publicKey?: string | null };
    return body.enabled && body.publicKey ? body.publicKey : null;
  } catch {
    return null;
  }
}

/** Registers the service worker (safe to call every time) and returns its registration. */
export async function registerWorker() {
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

export async function readPushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isInstalled() ? 'install-first' : 'unsupported';
  }
  if (isIos() && !isInstalled()) return 'install-first';
  if (Notification.permission === 'denied') return 'blocked';
  const key = await serverKey();
  if (!key) return 'unconfigured';

  const registration = await registerWorker();
  const existing = await registration.pushManager.getSubscription();
  if (Notification.permission === 'granted' && existing) {
    // Once a session, make sure the browser's subscription matches the server's current key and that the
    // server still has it. This quietly repairs a browser the vendor retired or a key that was rotated.
    if (!sessionStorage.getItem('localty-push-synced')) {
      try {
        const current = await ensureSubscription(registration, key);
        const sent = await api('POST', '/v1/push/subscriptions', current.toJSON());
        if (sent.ok) sessionStorage.setItem('localty-push-synced', '1');
      } catch {
        return 'off';
      }
    }
    return 'on';
  }
  return 'off';
}

export type PushResult = { state: PushState; error?: string };

/** Must be called from a tap or click: browsers ignore permission requests that are not. */
export async function enablePush(): Promise<PushResult> {
  const key = await serverKey();
  if (!key) return { state: 'unconfigured' };

  const permission = await Notification.requestPermission();
  if (permission === 'denied') return { state: 'blocked' };
  if (permission !== 'granted') return { state: 'off' };

  try {
    const registration = await registerWorker();
    const subscription = await ensureSubscription(registration, key);

    const saved = await api('POST', '/v1/push/subscriptions', subscription.toJSON());
    if (!saved.ok) return { state: 'off', error: saved.error };
    sessionStorage.setItem('localty-push-synced', '1');
    return { state: 'on' };
  } catch {
    return { state: 'off', error: 'This browser could not turn alerts on. Try again, or use a different browser.' };
  }
}

export async function disablePush(): Promise<PushResult> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await api('POST', '/v1/push/subscriptions/remove', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    sessionStorage.removeItem('localty-push-synced');
  } catch {
    // Already gone is the outcome we wanted.
  }
  return { state: 'off' };
}

export const sendTestAlert = () => api('POST', '/v1/push/test');
