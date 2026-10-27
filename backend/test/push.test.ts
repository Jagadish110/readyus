import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildPayload, isAllowedPushEndpoint, optionsFor, safeHref, subscriptionSchema, type QueuedNotification } from '../src/lib/push.js';

const note = (over: Partial<QueuedNotification> = {}): QueuedNotification => ({
  id: 'id-1', user_id: 'u', role: 'seller', channel: 'order', title: 'New order received', body: 'Order is waiting for your decision.',
  href: '/business/orders', dedupe_key: 'order-placed:1', push_attempts: 1, ...over
});

describe('push addresses', () => {
  it('accepts the push services real browsers use', () => {
    for (const url of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QAbc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc'
    ]) expect(isAllowedPushEndpoint(url), url).toBe(true);
  });

  it('refuses anything that could point the server at something else', () => {
    for (const url of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://evil.example/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.example/x',
      'https://user:pass@fcm.googleapis.com/x',
      'ftp://fcm.googleapis.com/x',
      'not a url',
      ''
    ]) expect(isAllowedPushEndpoint(url), url).toBe(false);
  });
});

describe('subscription form', () => {
  const keys = () => ({
    p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url'),
    auth: randomBytes(16).toString('base64url')
  });

  it('accepts a well-formed subscription', () => {
    expect(subscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: keys() }).success).toBe(true);
  });

  it('rejects keys of the wrong size or alphabet, and a bad address', () => {
    const good = keys();
    expect(subscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/x', keys: { ...good, auth: 'short' } }).success).toBe(false);
    expect(subscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/x', keys: { ...good, p256dh: 'a'.repeat(87) + '!' } }).success).toBe(false);
    expect(subscriptionSchema.safeParse({ endpoint: 'https://internal.example/x', keys: good }).success).toBe(false);
  });
});

describe('what is sent', () => {
  it('carries only what is shown, with a tag so a repeat replaces instead of stacking', () => {
    expect(JSON.parse(buildPayload(note()))).toEqual({
      id: 'id-1', title: 'New order received', body: 'Order is waiting for your decision.', href: '/business/orders',
      tag: 'order-placed:1', channel: 'order', role: 'seller'
    });
    expect(JSON.parse(buildPayload(note({ dedupe_key: null }))).tag).toBe('id-1');
  });

  it('stays small however long the text is', () => {
    const payload = buildPayload(note({ title: 'T'.repeat(500), body: 'B'.repeat(5000), dedupe_key: 'K'.repeat(500) }));
    expect(payload.length).toBeLessThan(700);
  });

  it('only ever links inside this site', () => {
    expect(safeHref('/orders/1')).toBe('/orders/1');
    for (const bad of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '', null]) expect(safeHref(bad)).toBe('/');
  });

  it('marks order, payment and delivery alerts urgent with a short life, the rest normal', () => {
    expect(optionsFor('order')).toEqual({ urgency: 'high', ttl: 3600 });
    expect(optionsFor('delivery').urgency).toBe('high');
    expect(optionsFor('payment').urgency).toBe('high');
    expect(optionsFor('approval')).toEqual({ urgency: 'normal', ttl: 86_400 });
    expect(optionsFor('system').urgency).toBe('normal');
  });
});
