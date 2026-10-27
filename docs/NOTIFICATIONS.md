# Notifications that work in the browser (no WhatsApp, no SMS)

## What the person gets

1. **A bell with an inbox** in every part of the app (customer, shop console, delivery dashboard, admin). It lists the
   last 30 notifications, counts the unread ones, and updates within a few seconds while the site is open.
2. **A pop-up alert on the device**, even when Localty is closed, if the person turned alerts on. This is the standard
   browser "Web Push" feature: the same one used by email sites and chat apps. It needs no app install on Android or
   desktop, and costs nothing per message.
3. **A banner inside the page** when an alert arrives while they are already looking at Localty (no double pop-up),
   plus the optional order chime on the shop's orders page.

The inbox is the dependable part. Pop-ups are a bonus that depends on the browser, so the interface never promises more than
it can deliver ("Alerts are on for this device", or an honest reason why not).

## How it works

```
 something happens (order placed, rider assigned, refund started ...)
        |   inside the same database transaction as the change
        v
  notify() -> row in `notifications`   <------ the bell reads these rows (GET /v1/notifications)
        |
        |  push queue = columns on the same row (pushed_at, push_attempts, push_next_at)
        v
  push worker (inside the backend, every 3 s; also POST /internal/push/drain as a safety net)
        |  claims due rows with a 2-minute lease (FOR UPDATE SKIP LOCKED)
        |  looks up the person's browsers in `push_subscriptions`
        v
  Web Push service of the browser vendor (Google / Mozilla / Apple / Microsoft), VAPID-signed, encrypted
        v
  browser wakes public/sw.js -> shows the pop-up (or tells the open page) -> tap opens the right page
```

Why this shape:
- **No lost alerts:** the notification and the business change commit together. If the order is rolled back, no alert exists.
- **No double sends:** workers lease rows, so two server instances (or a crash and restart) cannot send one alert twice.
  A notification is marked done only after sending has been attempted.
- **Retries that make sense:** a vendor error (429, 5xx, timeout) retries after 30 s, 2 min, 5 min... up to 5 tries or 24 hours.
  A 404 or 410 means the person revoked alerts or the browser is gone: that device is forgotten. A device that fails 20 times
  in a row is dropped.
- **No new infrastructure:** the queue is the table you already have. No Redis, no message broker.
- **Short life for urgent things:** orders, payments and deliveries are sent `Urgency: high` with a 1-hour life (a stale
  "new order" an hour later is noise); everything else lives 24 hours.

## What is sent, and to whom

| Event | Who | Today |
| --- | --- | --- |
| New order received | Shop | yes |
| Order paid online | Shop | yes |
| Customer cancelled | Shop | yes |
| Order delivered | Shop, customer | yes |
| Shop application / document sent | Admin | yes |
| Shop approved or declined; document approved or rejected | Shop | yes |
| FSSAI expiring, expired, due | Shop | yes (hourly job) |
| Free trial ending, payment overdue, shop hidden | Shop | yes (hourly job) |
| Order accepted / declined / timed out | Customer | yes |
| Payment confirmed or not found | Customer | yes |
| Delivery partner assigned, out for delivery | Customer | yes |
| **Refund started** | Customer | yes (added in 0029) |
| New delivery assigned to you; given to someone else | Rider | yes |
| Order being prepared / packed | Customer | no (the tracker page shows it; add if wanted) |

Anything new that calls `notify()` is pushed automatically.

## Browser support, honestly

| Where | Pop-up alerts |
| --- | --- |
| Chrome, Edge, Firefox, Opera on Android, Windows, macOS, Linux | Yes, no install needed |
| Safari on Mac | Yes (macOS 13+) |
| **iPhone and iPad** | Only when the site is **added to the Home Screen** (iOS 16.4+). The bell shows the instructions; `app/manifest.ts` makes the site installable |
| In-app browsers (inside Instagram, Facebook, etc.) and some privacy modes | Usually no; the bell and inbox still work |
| Permission blocked by the person | The bell says so and explains how to unblock; the inbox keeps working |

Android battery savers and aggressive phone makers sometimes delay pushes. That is why order alerts are marked high urgency and why
the shop's console also polls every 5 seconds while open.

## Safety and privacy

- **The server only sends to real push services.** A browser registers an address the server will POST to, so addresses are limited
  to Google, Mozilla, Apple and Microsoft hosts over https, with no embedded passwords. A caller cannot aim the server at an internal address.
- Each registration is checked for correct key sizes. A person keeps their 10 newest devices.
- **A browser belongs to one account at a time.** If someone signs in on a shared phone, that browser's alerts move to them and stop for the previous person.
- **Minimal content:** the pop-up carries a title, a short line and a page to open, nothing else (no address, phone number or payment detail).
  Anything sensitive is read from the inbox after sign-in. Payloads are encrypted end to end between our server and the browser.
- **A click can only lead to a page on this site**, enforced twice: when the payload is built and again inside the service worker.
- The service worker caches nothing and intercepts no requests, so it cannot show stale pages.
- `push_subscriptions` is private to the server; people read only their own notifications (row level security).

## Setting it up

1. `cd backend && npm run vapid` prints a public and a private key. Put them in `backend/.env` as `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   and set `VAPID_SUBJECT=mailto:you@yourdomain` (a contact for browser vendors). **Never commit the private key; if it leaks, make a new pair.**
2. Restart the backend. `GET /v1/push/config` now says `"enabled": true`, and the bell shows "Turn on alerts".
3. Changing the keys later makes every existing subscription useless; people are re-subscribed automatically on their next visit
   (the app compares the browser's subscription with the server's key once per session and replaces it if they differ),
   provided they already allowed notifications.
4. The website needs no extra setting. It serves `/sw.js` (never cached) and `/manifest.webmanifest`.
5. Use https in production (browsers require it for service workers; `localhost` is allowed for development).

## Testing it

- **Automated (113 backend tests):** queue claiming and leasing, parallel workers, retries, removal of dead devices, never sending to the wrong
  person, address allow-list, payload size and link safety, inbox and read marking, and the real `public/sw.js` run against a stand-in for the browser
  (pop-up vs page banner, tap behaviour, hostile links).
- **By hand:** see `docs/TESTING.md`, section 11.
- **What cannot be tested without a real phone:** that Google/Apple actually deliver the message and that your phone's battery settings let it through.
  Always finish with "Send a test" from the bell on the actual devices shops will use.

## Not built (decide later)

- **Email** as a fallback for shops whose browser never gets alerts (you asked for browser only, so it is left out).
- **Per-type settings** (for example "no delivery alerts after 10 pm"). Today it is on or off per device.
- **Quiet hours, grouping many alerts into one**, and **rich actions** ("Accept" button inside the pop-up).
- **Read receipts for the pop-up** (the vendors do not report whether a person saw it).
- **A "last seen" screen for admin** showing which shops have alerts on. The data exists (`push_subscriptions.last_success_at`).
