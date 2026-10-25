# ReadyUs backend

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

Call this with `Authorization: Bearer $CRON_SECRET` (Render/Railway cron, GitHub
Actions, cron-job.org, ...):

| Job | Call | How often |
|---|---|---|
| Refund online payments on declined/cancelled orders | `POST /internal/refunds/sweep` | every 5 minutes |

## Cashfree

Webhook URL: `https://<this server>/v1/webhooks/cashfree`, event `PAYMENT_SUCCESS_WEBHOOK`.
Webhooks are signed with `CASHFREE_SECRET_KEY`. Use `CASHFREE_ENV=sandbox` until you go live.
Shops are paid through Cashfree Easy Split vendors, so enable Easy Split on your account.

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
