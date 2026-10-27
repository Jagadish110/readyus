# Running Localty in production

What to set up, what to watch, and what to do when something goes wrong. Nothing here
needs a company registration to start; the payment and tax parts are marked.

## Deploy

| Piece | Where | How |
|---|---|---|
| Website | Vercel (or any Next.js host) | Connect the repo. Set the `NEXT_PUBLIC_*` variables from `.env.example`. |
| Backend | Any host that runs a container | `backend/Dockerfile` builds it. It listens on `PORT` (default 4000) on all addresses. Set the variables from `backend/.env.example`. |
| Database, login, files | Supabase | Apply `supabase/migrations/*.sql` in order (`npx supabase db push`). |
| Scheduled jobs | GitHub Actions | `.github/workflows/scheduled-jobs.yml`; set the `API_URL` and `CRON_SECRET` secrets. |

The backend refuses to start with a missing or placeholder secret, so a bad deploy fails
loudly instead of running half-configured.

## Health checks

- `GET /healthz` — the process is up. Use it as the container's liveness probe.
- `GET /readyz` — the process is up **and** can reach the database. Point your uptime
  monitor (UptimeRobot, Better Stack, the host's own) at this one, every minute, and alert
  by email or phone on two failures in a row.

## Environments

Keep two Supabase projects: **staging** and **production**. Apply every migration to
staging first, click through the flows in `docs/TESTING.md`, then apply to production.
Use Cashfree **sandbox** keys on staging and live keys only on production. Never point a
staging backend at the production database.

## Backups

- Supabase takes daily backups on paid plans. Turn on **Point-in-time recovery** before the
  first real order: it is what lets you restore to a minute before a mistake.
- Once a quarter, restore a backup into a scratch project and check that orders and
  payments are there. A backup you have never restored is a hope, not a backup.
- Uploaded licences are in the private `seller-documents` bucket; Supabase backs up the
  database, **not** storage objects, so export that bucket occasionally.

## Errors and logs

The backend writes one JSON line per request and per error, with tokens and signatures
removed. Ship them to wherever you read logs (the host's log view is enough to begin
with) and set an alert on the count of `"level":50` lines.

Sentry or a similar service is **not wired in**. Adding it is a small change to
`backend/src/app.ts` (report inside the existing error handler) and to the website's
`error.tsx`, but it needs a DSN and a decision about what personal data may leave the
system, so it is left until you choose a provider.

## Browser tests in CI

`.github/workflows/ci.yml` has an **End-to-end** job. It builds a throwaway Postgres from
the migrations and demo seed, starts the backend and website next to a small stand-in for
Supabase login (`e2e/auth-stub.mjs`), and drives a real browser through the main
screens (`e2e/smoke.spec.ts`). Run it yourself with:

```bash
DATABASE_URL=postgres://… bash e2e/start-stack.sh   # database already seeded: migrations, supabase/seed.sql, e2e/seed-people.sql
npx playwright test
```

It proves the screens load and the pause-a-shop path works end to end. It does **not**
exercise real Supabase login or Cashfree; do those once by hand on staging before launch.

## Security headers

The website sends `nosniff`, `X-Frame-Options: DENY`, a strict referrer policy, a
permissions policy and HSTS. A full Content-Security-Policy is not set yet: Next.js needs
a per-request nonce for its inline scripts, and the Cashfree checkout needs its domains
allowed. Add it in report-only mode first and watch for violations before enforcing.

## When something goes wrong

| Symptom | First thing to check |
|---|---|
| Customers say a shop vanished | Admin → Shops: is it paused, unpaid, or missing a valid FSSAI licence? The shop's own dashboard banner says which. |
| Money taken but order unpaid | Cashfree dashboard for the order; then `POST /internal/refunds/sweep` is safe to run again. |
| Refunds not arriving | Admin → Overview shows "Refunds being processed". If it does not fall, check the scheduled-jobs workflow ran. |
| No browser alerts | `POST /internal/push/drain`; check VAPID keys are set and unchanged. |
| A rider is misbehaving | Admin → Riders → Pause (not possible mid-delivery; reassign first). |
| Someone asks to delete their data | They can do it themselves in Account. If they cannot sign in, `anonymize_customer(user_id)` does it from the database. |
