# Localty backend

The only thing that talks to the database and to Cashfree. The website sends it the
signed-in user's Supabase login token; it checks the token, validates the request,
and runs it.

```
Browser (Next.js)  ──token──►  this server  ──►  Postgres (direct connection)
                                    └──────────►  Cashfree
```

Supabase is still used for **login only** (sign-in, sign-up, Google). Nothing in the
website reads or writes a data table.

## Run it

```bash
cd backend
cp .env.example .env      # then fill it in
npm install
npm run dev               # http://localhost:4000
```

It refuses to start if a secret is missing or still a placeholder. Without
`DATABASE_URL` it starts but data routes answer `503`.

`DATABASE_URL` is Supabase → **Connect** → *Transaction pooler* (it contains the
database password, so keep it only in `backend/.env`).

## How requests are made safe

| Layer | What it does |
|---|---|
| Auth | Every route except `/v1/public/*` and webhooks needs `Authorization: Bearer <Supabase token>`, checked with Supabase on each call. |
| Validation | Every body, query and param is parsed with zod; unknown or oversized input is rejected. |
| Per-user database role | Each request runs in one transaction as `authenticated` with the user's id in the JWT claims, so row level security and every database function apply exactly as written. |
| Ownership | Seller routes find the shop from who you are, never from an id you send. |
| Money | Amounts come from the database. Cashfree secrets never leave this server. Webhooks and checkout are signature-checked. |
| Transport | helmet headers, CORS limited to `ALLOWED_ORIGINS`, rate limits per route, 100 KB body limit. |
| Errors and logs | Callers get a short message; details stay in logs. Tokens and signatures are redacted from logs. |

Three database entry points live in `src/lib/db.ts`: `asAnon` (public catalogue),
`asUser` (signed-in people) and `asService` (webhooks, payouts and scheduled jobs,
which bypass row level security and so only run code that has already decided what
is allowed).

## Scheduled jobs

Each is called with `Authorization: Bearer $CRON_SECRET`. `.github/workflows/scheduled-jobs.yml` does
this from GitHub Actions once the `API_URL` and `CRON_SECRET` repository secrets are set; any other
scheduler (Render/Railway cron, cron-job.org) works the same way. All of them are safe to run twice.

| Job | Call | How often |
|---|---|---|
| Close orders nobody will act on: paid orders the shop ignored past the deadline become `timed_out`; orders left unpaid for 30 minutes are cancelled and their stock returned | `POST /internal/orders/expire` | every 5 minutes |
| Refund online payments on declined/cancelled/timed-out orders | `POST /internal/refunds/sweep` | every 5 minutes (right after the one above) |
| Send due browser alerts (the server also does this itself every 3 seconds; this is the safety net) | `POST /internal/push/drain` | every 5 minutes |
| In-app reminders: trial ending, payment overdue, shop hidden, FSSAI licence expiring or missing | `POST /internal/billing/reminders` | hourly |
| Ask Cashfree about subscriptions whose webhook may have been missed | `POST /internal/billing/resync` | every 4 hours |

## Subscription (monthly fee from shops)

Localty's only income. Separate from order money, which never touches Localty.

- A shop gets a 30-day free trial when an admin approves it (database trigger). Plan price, trial
  and grace days live in `subscription_plans`; the price is a placeholder, change it with an `UPDATE`
  before real shops subscribe. A shop keeps the price it started with.
- The owner approves a monthly automatic payment (UPI AutoPay / eNACH / card) at Cashfree Subscriptions
  from `/business/billing`. The first charge is scheduled for the day the trial ends.
- **State is derived from the clock**, never stored: `trialing`, `active`, `past_due` (5 grace days),
  `suspended`. A shop is hidden on time even if a job or webhook is late. A suspended shop is hidden
  from discovery and `place_order()` refuses new orders; orders already placed carry on.
- Success is never taken from the browser or a webhook body. After any signal the server fetches the
  subscription and its payments from Cashfree and records each charge once (`subscription_payments`).
- Webhook: the same `/v1/webhooks/cashfree` URL; enable the subscription events in Cashfree's webhook
  settings too (at least status-changed and payment events).
- `platform_settings.billing_enforced = false` stops hiding any shop (emergency switch).

| Route | What it does |
|---|---|
| `GET /v1/seller/billing` | The owner's plan and state |
| `POST /v1/seller/billing/subscribe` | Creates the mandate request and returns a Cashfree session |
| `POST /v1/seller/billing/verify` | Re-checks with Cashfree after the approval window closes |
| `POST /v1/seller/billing/cancel` | Stops future charges; what is paid for stays valid |

## Tests

```bash
cd backend && npm test                      # unit tests only (database tests are skipped)
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/localty_test npm test
```

The database tests need a Postgres with PostGIS and **rebuild that database from `supabase/migrations`
on every run** (a small Supabase stand-in is in `test/db/supabase-shim.sql`). The URL must be local and
its name must contain `test`, or the run refuses to start. CI does this against `postgis/postgis:16-3.4`.

## Cashfree (online payments)

Each shop becomes an **Easy Split vendor** when it saves its bank details on the Payouts
page. An online order is created at Cashfree with a split that sends the shop's whole
share to its vendor, so Localty never holds the money.

1. Cashfree dashboard -> **Developers -> API Keys**: copy the *sandbox* App ID and Secret
   Key into `backend/.env` (`CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV=sandbox`).
2. Easy Split must be enabled on the account (Cashfree enables it on request).
3. **Webhook:** Developers -> Webhooks, URL `https://<this server>/v1/webhooks/cashfree`,
   enable the payment success event. Cashfree signs it with the secret key; there is no
   separate webhook secret. Orders also carry this address when `PUBLIC_API_URL` is set.
4. Payment success is never taken from the browser or the webhook body: the server asks
   Cashfree for the order's real status and amount, then records it.
5. Going live: switch to the production keys and `CASHFREE_ENV=production`.

| Route | What it does |
|---|---|
| `POST /v1/payments/orders` | Creates (or reuses) the Cashfree order with the split and returns a payment session |
| `POST /v1/payments/verify` | Checks with Cashfree whether the order is paid and records it |
| `POST /v1/webhooks/cashfree` | Signed webhook; does the same check |
| `POST /v1/seller/payout` | Creates or updates the shop's vendor from its bank details |
| `POST /v1/seller/orders/:id/assign` | The shop assigns one of its own riders to a packed order (and may change the rider until pickup) |
| `POST /internal/refunds/sweep` | Refunds orders that ended without delivery |

## Deploy

Needs a host that runs a long-lived Node process (Render, Railway, Fly). Vercel is for
the website only.

```bash
npm install && npm run build
node dist/server.js
```

Set the same variables as `.env.example`, plus `NODE_ENV=production`,
`HOST=0.0.0.0`, `TRUST_PROXY=true` (the host's proxy sits in front) and
`ALLOWED_ORIGINS=https://your-site.com`. In the website's environment set
`NEXT_PUBLIC_API_URL=https://<this server>`.

## The last step: close the old door

Until this is done, someone with your public Supabase key and their own login could
still query tables directly (row level security still protects them, but the point
of this server is that they should not be able to try).

After every screen works through the backend: Supabase dashboard → **Project
Settings → Data API → disable the Data API**. Login, file storage and this server's
direct connection keep working. To undo it, switch it back on.

Then remove `SUPABASE_SERVICE_ROLE_KEY` from the website's `.env.local`; only this
server needs it now (for signing photo uploads).
