#!/usr/bin/env bash
# Vercel build entry point (vercel.json -> buildCommand -> npm run vercel-build).
#
# Four steps, and the order is the point: everything that can refuse a
# deployment does so BEFORE the database is touched.
#
#   1. VERCEL_ENV must be one of Vercel's three values     -> or exit 1
#   2. NEXT_PUBLIC_TEST_HOOKS must be off                  -> or exit 1
#   3. the environment contract (scripts/check-env.ts)     -> or exit 1
#   4. migrate (production only), build, bundle guard
#
# Migrations run ONLY for the production deployment. Preview deployments share a
# single Neon `preview` branch and must never migrate it out from under another
# open PR. `tests/unit/deploy/migrate-on-deploy.test.ts` asserts this wiring and
# `tests/unit/deploy/vercel-build-guard.test.ts` executes the script.
set -euo pipefail

# ---------------------------------------------------------------------------
# 1. This script only makes sense on Vercel, and every guard was written to key
#    off VERCEL_ENV. Three still read it: the contract's flag refusal and its
#    production requirements (`lib/env.ts`), `scripts/bundle-guard.ts`, and the
#    migrate gate itself. The hooks refusal in step 2 used to — it fired only
#    `if VERCEL_ENV` — and no longer tests it, because this step has already
#    settled the question by the time it runs.
#
# Without the variable all four failed OPEN at once: run with it unset, this
# script used to build with NEXT_PUBLIC_TEST_HOOKS=1 and exit 0, having skipped
# the migration with one log line (measured in review, 2026-10-06). Vercel
# documents VERCEL_ENV as present only while the project exposes its system
# environment variables — a project setting. What a build sees with that
# setting off was not observed here; this guard is what makes it not matter:
# a build that cannot see VERCEL_ENV stops instead of shipping unguarded.
# Nothing but `vercel.json`'s buildCommand runs this file — a local or CI build
# is `npm run build` / `bash scripts/ci/build.sh`.
#
# A value outside the three is refused too. `lib/env.ts` types VERCEL_ENV as
# this same enum and fails closed on anything else, so such a deployment could
# not boot anyway; better to say so before migrating.
case "${VERCEL_ENV:-}" in
production | preview | development) : ;;
"")
  echo "✗ VERCEL_ENV is not set, and this is the Vercel build entry point." >&2
  echo "  Every deployment guard keys off it: without it the test-flag refusal is off" >&2
  echo "  and a production deployment would not migrate." >&2
  echo "  On Vercel: Settings → Environment Variables → the System Environment Variables" >&2
  echo "  checkbox (Vercel's docs: \"Enable access to System Environment Variables\")" >&2
  echo "  must be ticked — then redeploy." >&2
  echo "  Not on Vercel: run \`npm run build\` (or \`bash scripts/ci/build.sh\`), not this script." >&2
  exit 1
  ;;
*)
  echo "✗ VERCEL_ENV=${VERCEL_ENV} is not production, preview or development." >&2
  echo "  lib/env.ts accepts only those three and refuses to boot on anything else" >&2
  echo "  (see the comment on VERCEL_ENV there before changing either side)." >&2
  exit 1
  ;;
esac
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 2. The one half of the environment contract no later check can take back.
#
# NEXT_PUBLIC_TEST_HOOKS is inlined by the bundler (`next.config.ts` normalises
# it to a literal so the gate can be folded away), and Next does NOT run
# `register()` during a build. So by the time `instrumentation.ts` could object
# at boot, `window.__va` — a remote control for the 3D viewer — is already
# compiled into the JavaScript the deployment serves. And a boot refusal does
# not un-serve it: a refused server answers 500 for every page and route
# handler, but still hands out the files under `/_next/static` (measured with
# `next start` on Next 16.3.6, `tests/boot/env-contract.test.ts`).
#
# So it is refused here, before anything is run at all: refuse the whole
# deployment rather than migrate a database for a build that must not ship.
# Step 3 would refuse it as well — this guard stays in front of it because its
# message says what the flag DOES, and because it needs nothing installed.
# `scripts/bundle-guard.ts` refuses the same combination once more, after the
# compile, so the rule holds even if this entry point is bypassed.
#
# Accepts the same spellings as `lib/env.ts`'s `flag` (1 / true / yes). No test
# on VERCEL_ENV: step 1 has already established this is a deployment.
hooks="$(printf '%s' "${NEXT_PUBLIC_TEST_HOOKS:-}" | tr '[:upper:]' '[:lower:]')"
case "$hooks" in
1 | true | yes)
  echo "✗ NEXT_PUBLIC_TEST_HOOKS=${NEXT_PUBLIC_TEST_HOOKS} on a Vercel deployment (VERCEL_ENV=${VERCEL_ENV})." >&2
  echo "  It compiles window.__va — a remote control for the 3D viewer — into the shipped bundle." >&2
  echo "  Remove NEXT_PUBLIC_TEST_HOOKS in Vercel → Settings → Environment Variables," >&2
  echo "  from EVERY scope that has it (Production, Preview, Development), then redeploy." >&2
  echo "  A preview URL is public too: it is refused there as well, on purpose." >&2
  exit 1
  ;;
esac
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 3. The rest of the contract, evaluated NOW rather than at the first request.
#
# `instrumentation.ts` runs `getEnv()` when a server starts, and Next skips
# `register()` during a build. On its own that means a scope's VALUES — a
# 31-character AUTH_SECRET, an AUTH_URL without its scheme, a forbidden flag —
# are first evaluated by the deployed server, after this script has migrated
# and built: a live deployment whose pages answer 500, not a failed deploy
# (the 500s measured under `next start`; on Vercel expected, not observed —
# docs/deploy.md). And a pull request's preview evaluates the Preview scope
# only, so Production's values would be met for the first time by production.
#
# The build is handed the same scope's variables (it is how the migration below
# gets its database URL), so the same `parseEnv`, unweakened, runs here and a
# violation fails the BUILD — before the database is touched.
# `instrumentation.ts` stays as the runtime lock.
#
# Deliberately NOT in `npm run build` or `scripts/ci/build.sh`: CI builds
# without a production secret (`lib/env.ts`'s header promises that).
echo "▶ environment contract (VERCEL_ENV=${VERCEL_ENV})"
npx tsx scripts/check-env.ts
# ---------------------------------------------------------------------------

if [ "${VERCEL_ENV}" = "production" ]; then
  echo "▶ prisma migrate deploy (VERCEL_ENV=production)"
  npx prisma migrate deploy
else
  echo "▶ skipping prisma migrate deploy (VERCEL_ENV=${VERCEL_ENV})"
fi

npm run build

# The build that actually ships: no runtime evaluator, and no `window.__va`
# (step 2 refused the flag, so the guard asserts absence).
npx tsx scripts/bundle-guard.ts
