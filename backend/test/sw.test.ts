import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * public/sw.js runs inside a browser's service worker, which cannot be started here. These tests
 * run the real file against a stand-in for the browser's service worker environment, so what the
 * worker does with a push, and with a click, is checked without a phone in hand.
 */
const SOURCE = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://localty.test';

type FakeClient = { url: string; visibilityState: 'visible' | 'hidden'; posted: unknown[]; focused: boolean; navigatedTo?: string; postMessage: (m: unknown) => void; focus: () => Promise<void>; navigate: (u: string) => Promise<void> };
const client = (url: string, visibilityState: 'visible' | 'hidden'): FakeClient => {
  const c: FakeClient = {
    url, visibilityState, posted: [], focused: false,
    postMessage: (m) => c.posted.push(m),
    focus: async () => void (c.focused = true),
    navigate: async (u) => void (c.navigatedTo = u)
  };
  return c;
};

function worker(clients: FakeClient[]) {
  const listeners: Record<string, (event: any) => void> = {};
  const shown: Array<{ title: string; options: any }> = [];
  const opened: string[] = [];
  const scope = {
    addEventListener: (type: string, fn: (event: any) => void) => (listeners[type] = fn),
    skipWaiting: () => undefined,
    location: { origin: ORIGIN },
    clients: { claim: async () => undefined, matchAll: async () => clients, openWindow: async (url: string) => void opened.push(url) },
    registration: { showNotification: async (title: string, options: any) => void shown.push({ title, options }) }
  };
  vm.runInNewContext(SOURCE, { self: scope, URL, console });

  const fire = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners[type]!({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  const pushRaw = (data: unknown) => fire('push', { data });
  const push = (data: unknown) => pushRaw({ json: () => data, text: () => String(data) });
  const click = (data: unknown) => fire('notificationclick', { notification: { data, close: () => undefined } });
  return { shown, opened, push, pushRaw, click };
}

const order = { id: 'n1', title: 'New order received', body: 'Order is waiting.', href: '/business/orders', tag: 'order-placed:1', channel: 'order', role: 'seller' };

describe('service worker', () => {
  it('shows a pop-up when nobody is looking at the site, and keeps order alerts on screen for shops', async () => {
    const w = worker([client(`${ORIGIN}/business`, 'hidden')]);
    await w.push(order);
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]!.title).toBe('New order received');
    expect(w.shown[0]!.options).toMatchObject({ body: 'Order is waiting.', tag: 'order-placed:1', renotify: true, requireInteraction: true, data: { href: '/business/orders' } });
  });

  it('shows a pop-up when the site is not open at all', async () => {
    const w = worker([]);
    await w.push(order);
    expect(w.shown).toHaveLength(1);
  });

  it('lets an ordinary alert fade like any other', async () => {
    const w = worker([]);
    await w.push({ ...order, channel: 'approval', role: 'seller' });
    await w.push({ ...order, channel: 'order', role: 'customer', tag: 'c' });
    expect(w.shown.map((s) => s.options.requireInteraction)).toEqual([false, false]);
  });

  it('keeps a delivery assignment on screen for the rider', async () => {
    const w = worker([]);
    await w.push({ ...order, channel: 'delivery', role: 'delivery', href: '/delivery' });
    expect(w.shown[0]!.options.requireInteraction).toBe(true);
  });

  it('does not stack a pop-up on a page someone is looking at, but tells every open page', async () => {
    const visible = client(`${ORIGIN}/orders`, 'visible');
    const hidden = client(`${ORIGIN}/cart`, 'hidden');
    const w = worker([visible, hidden]);
    await w.push(order);
    expect(w.shown).toHaveLength(0);
    expect(visible.posted).toEqual([{ type: 'push', payload: order }]);
    expect(hidden.posted).toEqual([{ type: 'push', payload: order }]);
  });

  it('still shows something useful if the message is not JSON', async () => {
    const w = worker([]);
    await w.pushRaw({ json: () => { throw new Error('not json'); }, text: () => 'plain words' });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]).toMatchObject({ title: 'Localty', options: { body: 'plain words' } });
  });

  it('copes with a push that has no data at all', async () => {
    const w = worker([]);
    await w.pushRaw(undefined);
    expect(w.shown[0]!.title).toBe('Localty');
  });

  it('refuses to send a click anywhere but this site', async () => {
    const w = worker([]);
    await w.push({ ...order, href: 'https://evil.example/phish' });
    expect(w.shown[0]!.options.data.href).toBe('/');
    await w.push({ ...order, href: '//evil.example' });
    expect(w.shown[1]!.options.data.href).toBe('/');
  });

  it('brings an open tab forward and sends it to the order when the alert is tapped', async () => {
    const tab = client(`${ORIGIN}/browse`, 'hidden');
    const w = worker([tab]);
    await w.click({ href: '/business/orders' });
    expect(tab.focused).toBe(true);
    expect(tab.navigatedTo).toBe(`${ORIGIN}/business/orders`);
    expect(w.opened).toEqual([]);
  });

  it('opens the site if no tab is open, and never follows a link to another site', async () => {
    const w = worker([client('https://other.example/page', 'visible')]);
    await w.click({ href: '/orders/1' });
    expect(w.opened).toEqual([`${ORIGIN}/orders/1`]);
    await w.click({ href: '//evil.example' });
    expect(w.opened[1]!.startsWith(ORIGIN)).toBe(true);
  });
});
