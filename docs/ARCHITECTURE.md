# Localty — target architecture

Status: proposal, based on the code at commit `b29bf29`. Nothing here is implemented yet.

## 1. The product in one paragraph

Localty puts local restaurants and shops in front of nearby customers. The shop lists
its **real offline prices**. Localty takes **no commission and no platform fee**; its
only income is a **monthly subscription paid by the shop owner**. Customers pay the
shop directly (online via split payment, or cash on delivery). Delivery is done by
riders the shop works with.

That business model has one consequence that drives the whole design:

> **Localty must never hold or touch order money, and must always be able to stop a
> shop whose subscription has lapsed.** Money flows customer → shop. Localty's only
> money is the subscription, and that is a separate flow.

## 2. What already exists (and what the brief missed)

The brief lists payments, bank verification and rider dispatch as pending. Reading the
repo, the **first versions of all three are already built**. The remaining work is
hardening them and adding the one thing that is genuinely missing: the subscription.

| Area | State in the repo |
| --- | --- |
| Customer sign-in, addresses, radius-based shop discovery (PostGIS) | Done |
| Shop application, admin approval, products, stock, prices | Done |
| Cart, `place_order()` (prices recomputed on the server, stock locked) | Done |
| Online payment: Cashfree order with **Easy Split**, shop's full share goes to its vendor | Built, sandbox-tested |
| Payment confirmation by webhook + server-to-server status check, idempotent | Built |
| Refund sweep (declined / cancelled / timed-out orders) | Built, needs a scheduler |
| Shop bank details → Cashfree vendor creation with bank check, status sync | Built |
| Rider: apply, join a shop's fleet by invite code, claim, pick up, complete with customer's 6-digit code, live location, live map for customer | Built |
| **Monthly subscription billing and gating** | **Missing** |
| **Real notification delivery** (SMS / WhatsApp / push) | **Missing** — `notify()` only writes a DB row; `notification_devices` is never used |
| **Dispatch by link** (no login needed for a rider) | **Missing** — riders must have an account and be in a fleet |
| Tests, CI, error tracking, backups, deployment config | **Missing** — no test files, no `.github` |
| KYC fields a food business needs (FSSAI, GSTIN, shop licence) | **Missing** |

## 3. System overview

```
 Customer web (Next.js PWA)     Shop console (/business)     Rider page (/r/<token>)   Admin (/admin)
            \                          |                           |                      /
             \________________________ | ________________________ /______________________/
                                       v
                          Backend API (Fastify, long-lived Node)
        auth · validation · rate limits · per-user DB role (RLS) · webhooks · cron
              |                     |                       |                   |
              v                     v                       v                   v
   Postgres + PostGIS        Cashfree PG +            Cashfree Subscriptions   Messaging
   (Supabase, RLS,           Easy Split               (shop's monthly plan)    (WhatsApp / SMS / FCM)
    SQL functions)           (order money → shop)
              ^
              |  Realtime (order status, rider position)
```

Keep the current shape. It is sound: one backend that is the only thing touching the
database and the payment provider, Supabase kept for login/storage/realtime, business
rules living in SQL functions that run under row level security. Do **not** split into
microservices at this stage; a modular monolith is correct for a team this size.

### Modules inside the backend

Group the routes by domain rather than by caller, so each domain owns its tables, its
rules and its tests:

| Module | Owns |
| --- | --- |
| `catalog` | shops, products, discovery |
| `orders` | cart, place order, order state machine |
| `payments` | customer payments, refunds, Cashfree order lifecycle |
| `payouts` | shop bank details, vendor status |
| `billing` (new) | plans, subscriptions, invoices, gating |
| `delivery` | riders, fleets, assignments, tracking links |
| `notifications` (new) | outbox + channel adapters |
| `admin` | approvals, subscriptions overview, audit |

## 4. The two money flows (keep them apart)

### 4.1 Order money — customer → shop, Localty never holds it

This is already how the code works and it is the right design:

1. `place_order()` computes the total from the database. The browser sends no amounts.
2. `POST /v1/payments/orders` creates a Cashfree order with
   `order_splits: [{vendor_id: <shop>, amount: <total>}]`.
3. Customer pays on Cashfree. Success is recorded only after the server asks Cashfree
   for the real status and amount (`confirmPaid`). Webhook and browser both call it;
   `mark_order_paid` is idempotent.
4. Cashfree settles to the shop's bank account on its schedule.

Things to decide / fix here:

- **Who pays the gateway fee?** Cashfree charges a percentage per online payment. Today
  the shop's *whole* order amount is split to the vendor, so the fee comes out of
  Localty's own Cashfree balance. At volume that is a hidden commission *paid by you*.
  Choose one and write it into the shop agreement: (a) shop bears it (split
  `amount − fee`, or let Cashfree deduct from the vendor), (b) Localty absorbs it and
  prices the subscription to cover it, (c) customer pays a visible convenience fee
  (contradicts "no fees" marketing). Option (a) with COD encouraged is the usual answer.
- **Settlement is not instant.** Show the shop its expected settlement date; add a
  payouts ledger page fed from Cashfree's vendor settlement APIs.
- **Reconcile daily.** A scheduled job should compare our `payments` rows against
  Cashfree's settlement/recon report and alert on any difference. This is the single
  most valuable safety net for a payments product.
- **COD cash** (`complete_delivery` records `cod_cash` with provider `other`) never
  passes through Localty. Rider-collected cash is between the shop and its rider.
  Record it, show it on the shop's end-of-day screen, but do not try to settle it.
- **Refunds**: the sweep exists; add it to a scheduler (see §9) and surface refund
  status to the customer. Also support partial refunds for a missing item, initiated by
  the shop.

### 4.2 Subscription money — shop → Localty (new)

Use **Cashfree Subscriptions** (recurring mandate: UPI AutoPay / eMandate / card) so you
do not build a billing engine. Localty is the *merchant* here, entirely separate from
the Easy Split vendor flow.

Tables (new migration):

```
plans(id, code, name, price_paise, interval, trial_days, active)
subscriptions(id, seller_id, plan_id, status, cashfree_subscription_id,
              current_period_start, current_period_end, trial_ends_at,
              grace_ends_at, cancel_at_period_end, created_at)
subscription_events(id, subscription_id, cashfree_event_id unique, type, payload, created_at)
invoices(id, subscription_id, number, amount_paise, gst_paise, status, paid_at, pdf_url)
```

Status machine:

```
trialing ──► active ──► past_due (payment failed) ──► grace ──► suspended
                 ▲                                                │
                 └────────────── payment succeeds ◄───────────────┘
        any ──► cancelled (at period end)
```

Gating rule, enforced **in SQL**, not just the UI. `nearby_sellers()` and `place_order()`
must both require `shop_is_billable(seller_id)`:

- `trialing`, `active`, `past_due` within the grace window → shop visible, can take orders.
- `suspended`, `cancelled` after period end → hidden from discovery, **new** orders
  rejected, but existing in-flight orders and payouts continue. Never strand a paid order.

Rules that avoid support pain:

- Free trial (e.g. 30 days) with no card required; ask for the mandate before it ends.
- 7-day grace period with reminders at T-7, T-3, T-1 and on failure.
- Webhooks are signed, de-duplicated by `cashfree_event_id`, and are the only thing
  that changes subscription status.
- GST: the subscription is a taxable service. Store GSTIN, generate a GST invoice per
  charge. Confirm the rate and invoicing rules with your CA before launch.
- Alternatives if mandates convert badly: prepaid plans (1 / 3 / 12 months, discount for
  longer) via a normal Cashfree payment link, with the same gating. Offer both.

## 5. Shop onboarding and bank verification

Today: apply → admin approves → shop saves PAN + bank → Cashfree creates the vendor and
runs a bank check → status `created / under_review / needs_clarification / activated /
rejected`. Good. Changes:

1. **Gate orders on a verified payout account for online payment only.** A shop with no
   verified bank can still run COD-only; the code already returns `SHOP_NOT_PAYOUT_READY`.
   Make the UI say so clearly on the shop's dashboard ("Online payments are off until
   your bank is verified").
2. **Penny-drop name match.** Cashfree returns the name registered with the bank. Compare
   it to the PAN / owner name and flag mismatches for admin review instead of trusting
   `ACTIVE`.
3. **Collect compliance data at application**: FSSAI licence number + expiry (required
   for food), GSTIN if registered, shop licence/photos. Store *references and status*, put
   documents in private storage, and let the admin approve against them.
4. **Re-verification on change.** Changing the bank account should drop the shop's
   online payments back to `under_review` until Cashfree re-validates, and notify the owner.
5. **Do not store the account number or PAN.** Already the case (only last four kept);
   keep it that way and make sure request bodies are excluded from error tracking.
6. **Order of onboarding** (single checklist on the shop dashboard):
   shop details → compliance docs → admin approval → bank details → subscription
   (trial starts) → first product → go live.

## 6. Delivery: dispatch by link

Requirement: once the shop confirms the order, send the rider a location link.

### Recommended model: shop's own riders via a tokenized link, no app login

Restaurants overwhelmingly use their own delivery staff. Making them sign up, apply and
be approved into a fleet is friction. Instead:

1. Shop adds riders by name + phone (a `riders` row owned by the shop). Optionally keep
   today's self-signup and invite-code path for freelance riders; both can coexist.
2. When the shop marks the order **packed / ready** (or accepts, if the shop prefers
   to dispatch early), the shop picks a rider, or the system auto-assigns by rules.
3. Backend creates a `delivery_tasks` row with a **random 128-bit token**, stores only its
   hash, sets an expiry, and sends the rider a WhatsApp/SMS link
   `https://localty.in/r/<token>`.
4. The link opens a lightweight page (no login) showing: shop and drop-off on a map with
   a "Navigate" button (Google Maps deep link), customer first name and the *delivery
   instructions*, amount of cash to collect, and buttons **Picked up** → **Delivered**.
5. While the page is open it posts the rider's position every ~10 s to the token
   endpoint; the customer sees it on the existing live map.
6. **Delivered** requires the customer's 6-digit code (already built) so a rider cannot
   close an order without handover.

Token rules: single order, expires at delivery or after N hours, revocable when the shop
reassigns, rate-limited, never logged. The page shows the customer's phone number only
as a masked call button routed through the backend if you add a calling provider;
otherwise show it only while the task is active.

Privacy: rider location is collected only while a task is active (already enforced in
`report_agent_location`). State this on the page and keep location history for a short
fixed period (e.g. 7 days), then delete.

### Data changes

```
riders(id, seller_id, name, phone, active, user_id null)       -- shop's own staff
delivery_tasks(id, order_id unique, rider_id, token_hash, expires_at,
               status, picked_up_at, delivered_at, cash_due_paise)
rider_locations(task_id, lat, lng, at)        -- or keep last position only
```

`delivery_assignments`/`claim_delivery` can stay for the open-pool/freelancer path. Do
not run two competing dispatch mechanisms on one order: add `dispatch_mode` to the order
(`shop_rider` | `pool`) fixed at accept time.

### Later (not now)

Auto-assignment by nearest free rider, batching two orders, third-party logistics
(Dunzo-style APIs) for shops without riders, proof-of-delivery photo. Do not build
these before the above is stable with real shops.

## 7. Order state machine

The status set already exists. Write it down as a table and **test it**; most real
production bugs here are illegal transitions and races.

```
pending ─ accept ─► accepted ─► preparing ─► packed ─► assigned ─► out_for_delivery ─► delivered
   │                  │                                    
payment_required ─► payment_confirmed ─►(accept)           
   │ reject/timeout/cancel ─► rejected | cancelled_by_customer | timed_out  (refund if paid)
```

Recommendations:

- Keep every transition inside a `security definer` SQL function that locks the order
  row (`for update`) — already the pattern. Add a `valid_transition(from, to)` check so a
  future endpoint cannot skip states.
- **Accept timeout**: migration 0020 removed it. Decide deliberately: with online-paid
  orders, an unanswered order holds the customer's money indefinitely. Reinstate a
  timeout (auto-cancel + refund) at least for paid orders, and call `expire_stale_orders()`
  from the scheduler.
- **Delivery code**: `random()` is not cryptographically strong and the code is
  generated in a column default. Use `gen_random_bytes` / `pgcrypto`, and lock out the
  code after 5 wrong attempts per order (rate limit exists per user, not per order).
- **Stock** is decremented at order time and restored on cancel; make sure rejection,
  timeout and refund paths all restore it, with a test for each.

## 8. Notifications

Today `notify()` writes a row. Nothing leaves the database. Add an **outbox**:

```
notifications_outbox(id, user_id | phone, channel, template, payload, status,
                     attempts, next_attempt_at, dedupe_key unique)
```

`notify()` inserts into it in the same transaction as the business change (so a rolled
back order never sends a message). A worker drains it and calls channel adapters:

| Event | To | Channel |
| --- | --- | --- |
| New order | Shop | Push + WhatsApp/SMS (a missed order is the #1 shop complaint) |
| Accepted / out for delivery / delivered | Customer | Push + SMS |
| Rider dispatch link | Rider | WhatsApp or SMS |
| Subscription reminders, payment failed | Shop owner | WhatsApp + email |
| Bank verification result | Shop owner | Email + in-app |

Use a transactional SMS/WhatsApp provider (India: DLT-registered templates are
mandatory for SMS; start that registration early, it takes days).

## 9. Background jobs

Today there is one cron endpoint. Run these from a scheduler with a secret header (or a
proper queue such as `pg-boss`, which uses the Postgres you already have):

| Job | Every |
| --- | --- |
| Refund sweep (exists) | 5 min |
| Expire unanswered orders + refund | 1 min |
| Drain notification outbox | 10 s (worker) |
| Subscription reminders, grace → suspended | hourly |
| Payment reconciliation vs Cashfree | daily |
| Delete old rider locations, expired tokens | daily |
| Re-check vendors stuck in `under_review` | 15 min |

Add job locking (`pg_advisory_lock`) so two instances never run the same sweep.

## 10. Security and compliance

Already good: token verified per request, RLS per user inside one transaction, webhook
signature + replay window, server-side amounts, rate limits, helmet, redacted logs.

Add:

- **Abuse and fraud**: per-phone and per-device limits on order placement and on COD
  (COD no-show is the biggest loss for a no-commission platform). Track
  rejected-delivery history; require online prepayment after repeated COD failures.
  (`cod_prepayment_required` exists per shop; make it automatic per customer too.)
- **Audit log** on every admin action and every bank/payout change (table exists;
  make writes mandatory on those paths).
- **Secrets**: backend-only; remove `SUPABASE_SERVICE_ROLE_KEY` from the website
  (README's "last step"), and disable the Data API once all screens use the backend.
- **Legal pages**: terms for shops (subscription, refunds, who bears gateway fees),
  customer terms, privacy policy (location data), refund/cancellation policy. Cashfree
  will ask for these at go-live.
- **DPDP Act (India)**: purpose-limited collection, consent for location, deletion on
  request, a named contact.
- **Backups**: enable Supabase point-in-time recovery before real money flows.
- Replace `ssl: { rejectUnauthorized: false }` on the DB pool with the provider's CA
  once you move past prototyping.

## 11. Quality: what "high quality" concretely needs

This is the largest gap. There are no tests and no CI.

1. **CI** (GitHub Actions): install, `tsc --noEmit`, lint, test, build, for both the
   website and the backend, on every PR. Protect `main`.
2. **Database tests** (pgTAP or a Node harness against a throwaway Postgres): the money
   identity, every order transition, stock restore on every cancel path, RLS (a customer
   cannot read another's order; a shop cannot read another shop's), `mark_order_paid`
   idempotency and `AMOUNT_MISMATCH`.
3. **Backend integration tests** with a fake Cashfree (the config already supports
   `CASHFREE_BASE_URL` for this): create order, webhook before verify, verify before
   webhook, duplicate webhooks, refund retry after crash, subscription failure → grace →
   suspension.
4. **End-to-end smoke** (Playwright is available): sign up → find shop → order → shop
   accepts → rider link → delivered, on every release.
5. **Observability**: Sentry (website + backend), structured logs with a request id,
   uptime check on `/healthz`, alerts on payment webhook failures, refund failures and
   outbox backlog.
6. **Environments**: `dev` (Cashfree sandbox) → `staging` (sandbox, production-like) →
   `prod`. Separate Supabase projects. Migrations applied by CI, never by hand.
7. **Migrations**: 24 files and a flattened `schema.sql` — pick one source of truth
   (keep migrations, generate `schema.sql` from them) and add a CI check that a fresh
   database built from the migrations matches it.
8. **Types**: generate `database.types.ts` from the database in CI instead of editing it.

## 12. Frontend architecture notes

- The shop console, rider page and customer app are one Next.js project. Keep that; add
  `/r/[token]` as a deliberately tiny, no-JS-framework-heavy page (riders are on cheap
  phones and weak networks).
- Make the customer app and the rider page **PWAs** (installable, offline shell). Web
  push for customers and shops removes much of the SMS cost.
- Remove the fixture data path (`src/lib/data/fixtures.ts`) from production builds so the
  site can never show demo shops when the backend is down; show an honest error instead.
- Add a shop-facing **subscription page** and a persistent banner for `past_due` /
  `grace`, and an **end-of-day** screen (orders, online vs COD, cash with riders).

## 13. Roadmap

**Phase 0 — foundation (do first, ~1–2 weeks)**
CI, test harness, Sentry, staging environment, scheduler for existing jobs, decide the
gateway-fee policy, reinstate order timeout for paid orders, stronger delivery code.

**Phase 1 — get paid (~2–3 weeks)**
Subscription tables + Cashfree Subscriptions, trial, gating in `nearby_sellers` and
`place_order`, shop billing page, GST invoices, reminder notifications, admin overview.

**Phase 2 — dispatch (~2 weeks)**
Notification outbox + one real channel (WhatsApp or SMS), `riders` + `delivery_tasks`,
tokenized rider page, live location to customer, shop "assign rider" UI.

**Phase 3 — trust and compliance (~1–2 weeks)**
FSSAI/GSTIN capture, bank-name match, re-verification on change, daily reconciliation,
audit coverage, legal pages, DPDP basics.

**Phase 4 — pilot**
10–20 shops in one locality, real money with low limits, daily manual reconciliation for
the first month, then widen.

## 14. Open decisions for you

1. Who bears the Cashfree gateway fee on online orders? (§4.1)
2. Subscription price, trial length and grace period; mandate vs prepaid plans? (§4.2)
3. Do shops dispatch their **own** riders only, or also an open freelancer pool? (§6)
4. WhatsApp vs SMS for rider links and shop alerts (cost and DLT effort). (§8)
5. Reinstate the accept timeout? What is the window? (§7)
6. Is a customer-facing delivery charge allowed later, or is "zero fees" a permanent
   promise? Marketing copy currently promises it everywhere (`tape.tsx`, `features.tsx`,
   `site-footer.tsx`), and `place_order()` hard-codes fees to 0.
