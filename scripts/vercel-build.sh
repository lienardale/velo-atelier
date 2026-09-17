#!/usr/bin/env bash
# Vercel build entry point (vercel.json -> buildCommand -> npm run vercel-build).
#
# Migrations run ONLY for the production deployment. Preview deployments share a
# single Neon `preview` branch and must never migrate it out from under another
# open PR. `tests/unit/deploy/migrate-on-deploy.test.ts` asserts this wiring.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "▶ prisma migrate deploy (VERCEL_ENV=production)"
  npx prisma migrate deploy
else
  echo "▶ skipping prisma migrate deploy (VERCEL_ENV=${VERCEL_ENV:-unset})"
fi

npm run build

# The build that actually ships: no runtime evaluator, and no `window.__va`
# (production never sets NEXT_PUBLIC_TEST_HOOKS, so the guard asserts absence).
npx tsx scripts/bundle-guard.ts
