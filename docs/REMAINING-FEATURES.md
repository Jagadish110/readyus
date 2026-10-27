# What is still to build

Status as of this commit. "Built" means working and tested at the database/API level and visible in the UI.

## Built

Customer sign-in, location and radius discovery, cart, checkout (cash and online), order tracking with live rider
map, reviews. Shop application, admin approval, products and stock, orders board with accept/decline reasons,
rider team by invite code, **shop assigns its own rider**, bank details with Cashfree verification, online payments
with direct split to the shop, refunds, monthly subscription with trial, grace and suspension, scheduled jobs,
CI and a database test suite. Delivery partners have their own login (`/delivery/login`) and dashboard.

## Must have before real customers

1. **Notifications: browser alerts are built** (`docs/NOTIFICATIONS.md`): inbox bell plus Web Push on Chrome, Edge, Firefox, Android and Home-Screen iPhones.
   Still to do: set the VAPID keys in production, test on the real phones shops will use, and decide whether an email fallback is wanted for
   shops whose browser never receives alerts (SMS and WhatsApp were ruled out).
2. **Owner KYC, remaining parts:** FSSAI and GSTIN are built (see `docs/COMPLIANCE.md`). Still to do: name match between
   certificate, PAN, owner and bank holder; shop licence and premises photos if wanted; document deletion on request.
   **Get the GST / TDS questions in `docs/COMPLIANCE.md` section 4 answered by a CA before launch.**
3. **GST invoices** for the monthly subscription. **Cashfree does not issue these** (it only invoices Localty for its own fees), so Localty must generate them: see `docs/COMPLIANCE.md` section 6. Needs Localty's legal name, address, GSTIN and state, the service code and rate from your CA, and the subscription price decision (a placeholder, Rs 499). Open question: whether Localty itself owes GST on restaurant orders (Section 9(5)), see `docs/COMPLIANCE.md`.
4. **Gateway-fee decision** (who pays Cashfree's per-payment fee). Today Localty absorbs it.
5. **Legal pages:** terms for shops, customers and riders, privacy policy (location data), refund and cancellation
   policy. **These pages do not exist yet**: the sign-in page already links to `/legal/terms` and `/legal/privacy`, and both currently show "not found". Have them written or reviewed by a lawyer; do not ship placeholder text.
6. **Error tracking and uptime alerts** (Sentry or similar), database backups, a staging environment.
7. **Photo required for every dish**, so customers never see a stock photo of a different dish.
8. **A real sandbox run** of the subscription flow and of Easy Split vendor creation (written from Cashfree's docs
   and tested against a fake Cashfree only).
9. **Admin tools:** list of shops with their plan state, rider list, order search, refund failures, ability to suspend
   a shop or rider. Today the admin page only approves shops and products.

## Should have soon

10. Languages: Hindi and major regional languages for the owner console and rider page.
11. Owner dashboard that leads with orders waiting, today's totals and cash with riders.
12. Customer can call the shop and rider from the order page; a "report a problem" route.
13. Rider extras: item count and order contents on the delivery card, proof of delivery, earnings summary,
    rider availability toggle, shop-side rider removal that also reassigns open orders.
14. Order timing: nudge the shop when an order waits too long; one-tap cancel for the customer while waiting.
15. Delivery pricing: today delivery is always free and the shop's fee setting is ignored. If delivery charges or a
    minimum order surcharge are wanted later, `place_order()` and the cart must change together.
16. Cash-on-delivery risk controls: per-customer limits, prepayment after repeated no-shows.
17. Reconciliation: daily comparison of our payment records with Cashfree's settlement report.
18. Search, favourites, repeat order, coupons (if wanted; coupons would reduce shop revenue, decide who funds them).

## Audit of what is missing (each item checked in the code)

**A. Orders can get stuck: fix before any real customer**
1. **A shop cannot cancel after accepting.** Only "decline" exists, and only while the order is waiting. A shop that runs out of an item after
   accepting has no way out; the customer can cancel only until the shop accepts. Needs: shop cancel with a reason (stock back, refund queued,
   customer notified) and a clear rule for when the customer can still cancel.
2. **No failed-delivery path.** If the customer does not answer or the rider cannot deliver, the order stays "out for delivery" forever
   (the shop cannot change the rider after pickup). Needs: "could not deliver" by rider or shop, with a reason, a decision on refund (online-paid
   food that was cooked is usually not refunded; that is a policy for the terms) and cash handling.
3. **Opening hours are stored but never applied.** `open_time` and `close_time` are saved; only the manual "Taking orders" switch decides. A shop
   that forgets to close takes orders at 3 am. Needs: apply the hours (in India time) and show "Opens at 9 am" to customers.
4. **A rider cannot decline or hand back an assignment.** Only the shop can change the rider.

**B. Broken or dead things users can see**
5. Footer links to `/favourites`, `/legal/terms`, `/legal/privacy` and `/legal/refunds` all show "not found"; the sign-in page and the account page link to the legal ones too.
   Favourites tables exist but there is no page or button.
6. No way to **delete a product** (only mark it sold out); no way to **edit or delete a saved address** (addresses are only added at checkout); the account page shows only a name, phone and sign out.
7. `sellers.auto_accept` exists but nothing uses it; shops with a steady menu will want auto-accept.
8. Customers get no general "Call the shop" button (the shop's phone appears only in one payment message).

**C. Admin and operations**
9. The admin area is one page (approvals). Missing: list of shops with plan state and documents, rider list, order search, refund failures, suspend a shop or a rider,
   grant or remove admin (today: SQL). Ops cannot answer "what happened to order X?" without database access.
10. No deploy files (Dockerfile or host config), and `/healthz` does not check the database, so a broken database still looks healthy. Add `/readyz`.
11. No error tracking, uptime alerts, backups plan or staging environment; no browser tests for the website in CI (the backend has 113 tests; the pages have none).
12. The website sends no security headers (frame, content-type, referrer policy, content security policy). A strict CSP needs care for the Cashfree and Google Maps scripts.

**D. Money and trust**
13. **Cash held by riders is not tracked.** Cash collected on delivery belongs to the shop but is physically with the rider; there is no daily "cash to hand over" screen
    or confirmation. Shops will dispute this within a week.
14. No refund or compensation by the shop after delivery (missing item), no customer complaint route, no review replies or review moderation.
15. Customers get no receipt for an order (items, total, shop FSSAI number) and nothing to download.

**E. Privacy and sign-in**
16. **Login by mobile OTP needs an SMS provider** (Supabase Phone auth: cost, plus DLT registration in India) and it is the first option on the sign-in page. Decide: keep it, or lead with Google
    and email so no SMS is needed at all.
17. No account deletion or data download (needed for the DPDP Act), no consent line for location, no retention rule for documents and order data.
18. The `notification_devices` table from the first version is unused; remove it.

## Later

Auto-assignment of riders, batching, third-party logistics for shops with no riders, push notifications, native apps,
multi-city operations tooling, analytics for shops.

## Known gaps in what exists

- The website returns an error page if the Supabase keys are missing (the README says it does not).
- Rider and sign-in forms use placeholders instead of labels (accessibility).
- The accept timeout applies only to orders paid online; cash orders wait for the shop indefinitely (by design, migration 0020).
- Demo data in `supabase/seed.sql` and the offline fixtures still use a sample city; real shops are unaffected.
