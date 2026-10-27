#!/usr/bin/env bash
# Starts the sign-in stand-in, the backend and the website for the browser tests.
# Needs a database that already has the migrations, seed.sql and e2e/seed-people.sql applied:
#   DATABASE_URL=postgres://... bash e2e/start-stack.sh
# Leaves the three servers running in the background; logs go to e2e/.logs.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL}"
mkdir -p e2e/.logs

node e2e/auth-stub.mjs > e2e/.logs/auth.log 2>&1 &

(cd backend && \
  NODE_ENV=development PORT=4000 SUPABASE_URL=http://localhost:54321 \
  SUPABASE_SERVICE_ROLE_KEY=e2e-service-role-key-0123456789 CRON_SECRET=e2e-cron-secret-0123456789 \
  ALLOWED_ORIGINS=http://localhost:3100 DATABASE_URL="$DATABASE_URL" \
  npx tsx src/server.ts > ../e2e/.logs/backend.log 2>&1) &

export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export NEXT_PUBLIC_API_URL=http://localhost:4000
export NEXT_TELEMETRY_DISABLED=1
if [ ! -f .next/BUILD_ID ]; then npm run build > e2e/.logs/build.log 2>&1; fi
npx next start -p 3100 > e2e/.logs/web.log 2>&1 &

for i in $(seq 1 60); do
  if curl -fs localhost:4000/readyz >/dev/null && curl -fs -o /dev/null localhost:3100/sign-in; then echo "stack ready"; exit 0; fi
  sleep 2
done
echo "stack did not start" >&2; tail -20 e2e/.logs/*.log >&2; exit 1
