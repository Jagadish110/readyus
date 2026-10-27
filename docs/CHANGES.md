# What has been built so far

Everything added to Localty on this branch, grouped by what it does for people. Browser
notifications and invoices are left out on purpose (notifications are described in
`docs/NOTIFICATIONS.md`; invoices are not built).

## 1. Foundation (migration 0025, backend)

| Change | Why it matters |
|---|---|
| Separate Fastify backend (`backend/`) is the only thing that talks to the database and Cashfree | Secrets stay on the server; every request is checked and runs as the signed-in user |
| Per-request database role, validation on every input, rate limits, signature-checked webhooks | A user can only see and change their own data |
| Hardening migration, scheduled jobs (order expiry, refunds) and a CI pipeline | Stuck orders close themselves; every change is tested before it merges |

## 2. Shop subscription (migration 0026)

- Flat monthly fee, no commission, no per-order fee. Free trial starts when the shop is approved.
- Plan page for owners: set up or stop automatic payment through Cashfree Subscriptions.
- State comes from the clock: trial, active, payment overdue (grace period), shop hidden.
- A shop that stops paying disappears from search and cannot take new orders; orders already in progress still finish.

## 3. Delivery by the shop's own riders (migration 0027)

- Riders sign in on their own area (`/delivery`), join a shop's team with a code.
- The shop assigns a rider to each packed order; the rider sees only their deliveries.
- Customer gives a 6-digit code at the door; the rider enters it to complete the delivery.
- Rider location and a map link are shown to the customer.

## 4. Owner verification and compliance (migration 0028)

- FSSAI licence (food shops) and GSTIN (optional) uploaded to a private bucket.
- Admin reviews each document; a food shop without a valid FSSAI licence cannot trade.
- Warnings on the owner dashboard before a licence expires.
- Bank details verified through Cashfree before online payouts.
- Plain-language explanation of each document in `docs/COMPLIANCE.md`.

## 5. Orders can always end (migration 0030)

- Shop can cancel after accepting (reason, stock returned, customer told).
- Failed delivery: rider or shop reports it; refund depends on whose fault it was.
- Rider can hand an assignment back.
- Cash taken at the door is tracked per rider, with a handover confirmation.
- Shop or admin can refund part or all of an online payment.
- Customers can report a problem with an order; the shop or admin resolves it.

## 6. Opening hours and shop settings (migration 0031)

- Hours are enforced when ordering (India time, can cross midnight, equal times mean all day).
- Customers see "Closed · Opens 9:00 am"; the Add button becomes Closed.
- Optional auto-accept for shops with a steady menu.
- "Call the shop" button and a printable order receipt (not a tax invoice).

## 7. Customer account (migration 0032)

- Favourite shops page and heart button.
- Address book: add, edit, delete, set default.
- Download my data; delete my account (orders are kept but made anonymous).
- Terms, privacy and refund pages (plain-language summaries; have a lawyer replace them before launch).
- Mobile OTP login is off by default; email and Google work without an SMS provider.
- Owners can delete a product.

## 8. Admin console (migration 0033, `/admin`)

- Overview of what needs attention today.
- Approvals (shops, products, documents), shops list with plan and licence state, riders list.
- Order search with a full timeline, customer problems and refunds.
- Pause or restore a shop or rider (with a reason they see); add or remove admins; everything is logged.

## 9. Look and feel

- UI/UX review of customer and owner screens, mobile first (`docs/UX-REVIEW.md`).
- India-wide wording: no city names in the copy.
- Labels added to the rider forms for accessibility.

## 10. Running and releasing

- `/readyz` checks the database; backend `Dockerfile`; website security headers.
- Browser smoke tests in CI (`e2e/`); runbook for backups, uptime and incidents in `docs/OPERATIONS.md`.
- 168 backend tests, typecheck and lint clean.

## Not built

Invoices, Sentry error tracking, a Content-Security-Policy, review replies, lawyer-written legal text.

## Run it on localhost

```bash
git clone https://github.com/jagadish110/readyus.git && cd readyus
git checkout claude/delivery-platform-architecture-ufnusg
npm install && (cd backend && npm install)
# create .env.local and backend/.env (see .env.example and backend/.env.example)
npx supabase db push            # applies migrations; then run supabase/seed.sql
cd backend && npm run dev       # terminal 1: http://localhost:4000/readyz
npm run dev                     # terminal 2: http://localhost:3000
```

Step-by-step test scripts for each role are in `docs/TESTING.md`.
