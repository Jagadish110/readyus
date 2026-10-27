# Deploying Localty (Render backend + Vercel website)

Order matters: the backend must be up before the website that talks to it goes live.

## 1. Backend on Render
1. Render > New > Blueprint > choose this repo and the branch to deploy. It reads `render.yaml`.
2. Fill the values it asks for. Copy them from your local `backend/.env`, except:
   - `DATABASE_URL`: use Supabase's **transaction pooler** address (port 6543), not the direct one.
   - `PUBLIC_API_URL`: leave empty on the first deploy, then set it to the `https://…onrender.com` address Render shows, and redeploy.
   - `CASHFREE_ENV` is `sandbox` until you switch to production keys (the two must match).
3. When it is live, open `https://<your-api>/readyz`. It must say `{"ok":true}`.

## 2. Scheduled jobs
In the GitHub repo: Settings > Secrets > Actions, add `API_URL` (the Render address) and `CRON_SECRET`
(the same value as on Render). `.github/workflows/scheduled-jobs.yml` then runs refunds, order expiry and billing.

## 3. Cashfree
In the Cashfree dashboard, set the webhook address to `https://<your-api>/v1/webhooks/cashfree`.

## 4. Website on Vercel
Set `NEXT_PUBLIC_API_URL` to the Render address, deploy the branch as a **production** deployment, then check
sign-in, browse, checkout and the owner Orders page on localty.in before announcing.
The live site today runs the older branch `localty-launch`; do not promote `master` until steps 1–3 are done.

## Traffic notes
- One backend instance, 10 database connections. Fine for early traffic; raise the Render plan and the pool
  (`max` in `backend/src/lib/db.ts`) together if `/readyz` slows down.
- Rate limit is 120 requests a minute per visitor IP, which only works with `TRUST_PROXY=true`.
- Owner and rider screens poll every 5–10 seconds; customers' order pages every 5 seconds while an order is active.
