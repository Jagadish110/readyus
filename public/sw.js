/*
 * Localty service worker: browser notifications only.
 * It does not cache pages or intercept requests, so it can never make the site show stale content.
 */

// A click may only ever lead to a page on this site: "/orders/1" is fine; "//other.site" and full addresses are not.
const localPath = (value) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Localty', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      // Open pages update themselves (inbox, order list, sound) as soon as they hear this.
      for (const client of windows) client.postMessage({ type: 'push', payload: data });

      // Someone looking at the site does not also need a pop-up on top of it.
      if (windows.some((client) => client.visibilityState === 'visible')) return;

      // Orders and deliveries stay on screen until acted on; everything else fades like a normal alert.
      const sticky = (data.channel === 'order' || data.channel === 'delivery') && (data.role === 'seller' || data.role === 'delivery');

      await self.registration.showNotification(data.title || 'Localty', {
        body: data.body || '',
        // The same tag replaces an older alert for the same thing instead of stacking a second one.
        tag: data.tag || data.id,
        renotify: true,
        icon: '/icon.png',
        badge: '/icon.png',
        requireInteraction: sticky,
        data: { href: localPath(data.href), id: data.id }
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(localPath(event.notification.data && event.notification.data.href), self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ('navigate' in client) await client.navigate(target).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(target);
    })()
  );
});
