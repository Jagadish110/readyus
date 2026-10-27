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

## Audit of what was missing: status

Invoices are deliberately **not** built yet (Localty is not a registered company; see `docs/COMPLIANCE.md`).
Everything else from the audit is built and tested.

| # | Item | Status |
|---|---|---|
| 1 | Shop cancels after accepting | Done: reason, stock back, refund queued, everyone notified (0030) |
| 2 | Failed delivery | Done: rider or shop reports it; refund depends on whose fault (0030) |
| 3 | Opening hours applied | Done: enforced when ordering, "Opens at 9 am" shown (0031) |
| 4 | Rider hands back an assignment | Done (0030) |
| 5 | Dead footer links | Done: policy pages and favourites (policy text is a plain-language summary; **have a lawyer replace it before launch**) |
| 6 | Delete product, manage addresses | Done (0032 and account page) |
| 7 | Auto-accept | Done (0031) |
| 8 | Call the shop | Done |
| 9 | Admin area | Done: overview, shops, riders, orders with timeline, problems, refunds, admins, pause shop or rider (0033) |
| 10 | Deploy files, `/readyz` | Done: `backend/Dockerfile`, `/readyz` |
| 11 | Error tracking, uptime, backups, staging, browser tests | Browser tests in CI and the runbook (`docs/OPERATIONS.md`) are done. **Error tracking (Sentry) is not wired in**: it needs a provider and a decision on what data may leave. Uptime, backups and staging are setup steps for you, written up in the runbook |
| 12 | Security headers | Done except a Content-Security-Policy (needs a nonce and a Cashfree test; plan in the runbook) |
| 13 | Cash held by riders | Done: rider and shop screens, handover confirmation (0030) |
| 14 | Refund after delivery, complaints | Done: customers report a problem; shop or admin refunds. **Not built:** review replies and moderation (reviews are not shown publicly yet) |
| 15 | Receipt | Done: printable order receipt. It is **not a tax invoice** |
| 16 | Phone login | Done: off by default (`NEXT_PUBLIC_PHONE_LOGIN=true` turns it on once an SMS provider exists) |
| 17 | Account export and deletion | Done: download your data; delete your account (orders kept but anonymised) (0032) |
| 18 | `notification_devices` | Removed (0032) |

## Still to decide or do (not code)

- **Lawyer-reviewed** terms, privacy policy and refund policy (the pages are honest summaries, not legal text).
- **Invoices** once the business is registered: who issues them, GST, numbering.
- **Sentry** or equivalent, and a **Content-Security-Policy**, once you have chosen a provider and tested against Cashfree.
- Review replies and moderation, when reviews become public.

## Later

Auto-assignment of riders, batching, third-party logistics for shops with no riders, push notifications, native apps,
multi-city operations tooling, analytics for shops.

## Known gaps in what exists

- The website returns an error page if the Supabase keys are missing.
- Rider and sign-in forms use placeholders instead of labels (accessibility).
- The accept timeout applies only to orders paid online; cash orders wait for the shop indefinitely (by design, migration 0020).
- Demo data in `supabase/seed.sql` and the offline fixtures still use a sample city; real shops are unaffected.
