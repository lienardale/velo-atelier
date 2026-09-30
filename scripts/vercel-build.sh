#!/usr/bin/env bash
# Vercel build entry point (vercel.json -> buildCommand -> npm run vercel-build).
#
# Migrations run ONLY for the production deployment. Preview deployments share a
# single Neon `preview` branch and must never migrate it out from under another
# open PR. `tests/unit/deploy/migrate-on-deploy.test.ts` asserts this wiring.
set -euo pipefail

# ---------------------------------------------------------------------------
# The one half of the environment contract a runtime check cannot cover.
#
# `instrumentation.ts` runs `getEnv()` at boot and refuses the three test flags
# whenever VERCEL_ENV is set. That is enough for the two flags that are read at
# request time — but NEXT_PUBLIC_TEST_HOOKS is inlined by the bundler
# (`next.config.ts` normalises it to a literal so the gate can be folded away),
# and Next does NOT run `register()` during a build. So by the time a runtime
# check could object, `window.__va` — a remote control for the 3D viewer — is
# already compiled into the JavaScript the deployment serves.
#
# This is therefore the only place the flag can be caught on Vercel, and it has
# to be before anything else happens: refuse the whole deployment rather than
# migrate a database for a build that must not ship. `scripts/bundle-guard.ts`
# refuses the same combination a second time, after the compile, so the rule
# holds even if this entry point is bypassed.
#
# Accepts the same spellings as `lib/env.ts`'s `flag` (1 / true / yes).
hooks="$(printf '%s' "${NEXT_PUBLIC_TEST_HOOKS:-}" | tr '[:upper:]' '[:lower:]')"
case "$hooks" in
1 | true | yes)
  if [ -n "${VERCEL_ENV:-}" ]; then
    echo "✗ NEXT_PUBLIC_TEST_HOOKS=${NEXT_PUBLIC_TEST_HOOKS} on a Vercel deployment (VERCEL_ENV=${VERCEL_ENV})." >&2
    echo "  It compiles window.__va — a remote control for the 3D viewer — into the shipped bundle." >&2
    echo "  Remove NEXT_PUBLIC_TEST_HOOKS in Vercel → Settings → Environment Variables," >&2
    echo "  from EVERY scope that has it (Production, Preview, Development), then redeploy." >&2
    echo "  A preview URL is public too: it is refused there as well, on purpose." >&2
    exit 1
  fi
  ;;
esac
# ---------------------------------------------------------------------------

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
