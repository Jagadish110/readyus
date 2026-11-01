# Deploying Localty (Render backend + Vercel website)

Order matters: the backend must be up before the website that talks to it goes live.

## 0. Supabase, once, before launch
1. Every migration in `supabase/migrations` is applied. (`0037_close_direct_access_gaps.sql`, which closes the gaps
   listed at its top, was applied to the live project on 1 Nov 2026; a new project gets it with the rest.)
2. Dashboard > Integrations > Data API > Overview: **turn Enable Data API off**. Neither the website nor the backend uses it (the backend
   talks to Postgres directly), but while it is on anyone holding the public key can reach the tables, including
   PostGIS's `spatial_ref_sys`, which Supabase does not let us protect and which every location search depends on.
   Sign-in and file uploads do not use it and keep working. Check: `https://<project>.supabase.co/rest/v1/sellers`
   with the public key must stop answering 200.
3. Authentication > Settings: turn on leaked password protection.
4. Google Cloud > Credentials: restrict the Maps key to HTTP referrers `https://localty.in/*` and `https://www.localty.in/*`.
5. Email: follow `docs/EMAIL.md`. Without it, sign-up emails reach only your Supabase team, not customers.
   Its step 3 can be done now; step 4 (the Localty designs) comes after the website in step 4 below is live.

## 1. Backend on Render
1. Render > New > Blueprint > choose this repo and the branch to deploy. It reads `render.yaml`.
2. Fill the values it asks for. Copy them from your local `backend/.env`, except:
   - `DATABASE_URL`: use Supabase's **transaction pooler** address (port 6543), not the direct one.
   - `PUBLIC_API_URL`: leave empty on the first deploy, then set it to the `https://…onrender.com` address Render shows, and redeploy.
   - `CASHFREE_ENV` is `sandbox` until you switch to production keys (the two must match).
   - `INTERNAL_API_KEY`: a new random value (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`),
     the **same** on `localty-api` and `localty-web`. Without it every page the website renders shares one rate limit,
     and busy hours start failing with 429s.
   - Optional, recommended: `DATABASE_CA_CERT` with Supabase's SSL certificate (Database settings > SSL configuration),
     so the database connection is verified, not only encrypted.
3. When it is live, open `https://<your-api>/readyz`. It must say `{"ok":true}`.

## 2. Scheduled jobs
In the GitHub repo: Settings > Secrets > Actions, add `API_URL` (the Render address) and `CRON_SECRET`
(the same value as on Render). `.github/workflows/scheduled-jobs.yml` then runs refunds, order expiry and billing.

## 3. Cashfree
In the Cashfree dashboard, set the webhook address to `https://<your-api>/v1/webhooks/cashfree`.
For real money: production keys in `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` and `CASHFREE_ENV=production`
together (the server refuses to start on a mix), and set the webhook again in the production dashboard.

## 4. Website on Vercel
Set `NEXT_PUBLIC_API_URL` to the Render address and `INTERNAL_API_KEY` to the backend's value (a plain variable,
never `NEXT_PUBLIC_`). The website needs nothing else secret: remove `SUPABASE_SERVICE_ROLE_KEY`, `CASHFREE_*` and
`CRON_SECRET` from its environment if they were ever added. Deploy the branch as a **production** deployment, then
check sign-in, browse, checkout and the owner Orders page on localty.in before announcing.
The live site today runs the older branch `localty-launch`; do not promote `master` until steps 0–3 are done.

## Traffic notes
- One backend instance, 10 database connections (`DATABASE_POOL_MAX`). Fine for early traffic; raise the Render
  plan, the pool and the Supabase compute size together if `/readyz` slows down.
- Every query gives up after 15 seconds, so one slow query cannot hold a connection the others are waiting for.
- Rate limit is 120 requests a minute per visitor (240 on the public catalogue). Render keeps whatever a caller
  writes in `X-Forwarded-For`, so the visitor's address comes from Cloudflare's `cf-connecting-ip`
  (`CLIENT_IP_HEADER` in `render.yaml`); pages the website renders pass the visitor along with `INTERNAL_API_KEY`.
- A login confirmed by Supabase is trusted for 30 seconds before the backend asks again; roles are checked on every call.
- Owner and rider screens poll every 5–10 seconds; customers' order pages every 5 seconds while an order is active.
