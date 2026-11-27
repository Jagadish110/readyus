import { describe, expect, it } from 'vitest';
import { androidChannelFor, buildFcmMessage, fcmTokenOf, isFcmEndpoint, FCM_PREFIX } from '../src/lib/fcm.js';
import { buildPayload, type QueuedNotification } from '../src/lib/push.js';

const alert = { id: 'n1', title: 'New order received', body: 'Order is waiting for your decision.', href: '/business/orders', tag: 'order-placed:1', channel: 'order', role: 'seller' };

describe('phone alerts (FCM)', () => {
  it('tells phones from browsers by the stored address', () => {
    expect(isFcmEndpoint(`${FCM_PREFIX}abc`)).toBe(true);
    expect(isFcmEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(fcmTokenOf(`${FCM_PREFIX}abc:def`)).toBe('abc:def');
  });

  it('rings only for a shop’s new order and a rider’s new delivery', () => {
    expect(androidChannelFor(alert)).toBe('order-ring');
    expect(androidChannelFor({ role: 'delivery', tag: 'assigned-rider:1:2' })).toBe('order-ring');
    expect(androidChannelFor({ role: 'customer', tag: 'order-placed:1' })).toBe('updates');
    // A shop's other order news (delivered, cancelled) must not ring like a new order.
    expect(androidChannelFor({ role: 'seller', tag: 'order-delivered:1' })).toBe('updates');
  });

  it('builds a high-priority message that carries the tap target and the ring sound', () => {
    const { message } = buildFcmMessage('tok', alert, true);
    expect(message.token).toBe('tok');
    expect(message.android.priority).toBe('HIGH');
    expect(message.android.notification.channel_id).toBe('order-ring');
    expect(message.android.notification.sound).toBe('order_ring');
    expect(message.data).toMatchObject({ href: '/business/orders', role: 'seller' });
  });

  it('sends a normal alert quietly through the default channel', () => {
    const { message } = buildFcmMessage('tok', { ...alert, role: 'customer', channel: 'order' }, false);
    expect(message.android.priority).toBe('NORMAL');
    expect(message.android.notification.channel_id).toBe('updates');
    expect('sound' in message.android.notification).toBe(false);
  });

  it('works from the same payload the browser worker builds', () => {
    const queued: QueuedNotification = { id: 'n2', user_id: 'u', role: 'seller', channel: 'order', title: 'New order received', body: 'Hi', href: '/business/orders', dedupe_key: 'order-placed:2', push_attempts: 1 };
    const parsed = JSON.parse(buildPayload(queued)) as typeof alert;
    expect(buildFcmMessage('tok', parsed, true).message.data.href).toBe('/business/orders');
  });
});
