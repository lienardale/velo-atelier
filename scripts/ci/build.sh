#!/usr/bin/env bash
# Production build + the two things that only a real build can tell us:
#
#   1. `npm run build`  — content-check, then `next build` (Turbopack).
#   2. bundle guard     — no `new Function`/`eval` in the shipped JS, and
#                         `window.__va` present iff NEXT_PUBLIC_TEST_HOOKS=1.
#                         CI builds the e2e artifact with the flag ON, so CI
#                         proves the marker is findable; `npm run ci:local`
#                         builds with it off and proves the hooks stay out.
#   3. bundle budget    — first-load JS per route against perf.budgets.json,
#                         and "no WebGL chunk on the home/guide routes".
#   4. boot check       — `next start` and curl `/api/health`. This is the
#      tripwire for the Prisma 7 + Turbopack server-external resolution bug
#      (prisma/prisma#29025): it only shows up in a started production server,
#      never during `next build`. If it ever fires, the documented fallback is
#      `prisma-client-js` or `next build --webpack`, recorded in `.debug/`.
#
# `ENABLE_TEST_PAGES=1` so `/dev/*` is reachable for the e2e job that consumes
# this build; it is read at request time and never set on Vercel.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

export ENABLE_TEST_PAGES="${ENABLE_TEST_PAGES:-1}"

# Default OFF, and exported so it wins over `.env.local`.
#
# `.env.example` ships `NEXT_PUBLIC_TEST_HOOKS=1` (a developer wants the hooks in
# `npm run dev`), and `next build` loads `.env.local`. So the absent direction of
# the bundle guard — the one that proves `window.__va` stays out of a build that
# did not ask for it — was never actually exercised by `npm run ci:local`, only
# by a hand-run build with the variable unset (.debug/004 §1 claims otherwise,
# .debug/009 corrects it). A real environment variable beats every `.env*` file,
# so pinning it here restores what the header above says: CI's `build` job sets
# `1` in its own `env:` block and still wins, `ci:local` and Vercel prove `0`.
export NEXT_PUBLIC_TEST_HOOKS="${NEXT_PUBLIC_TEST_HOOKS:-0}"

# Baked into the HTML at build time: canonical, hreflang and og:url come from it.
# The lighthouse job serves this build on :3100 and audits it there, so a build
# without it emits canonicals for :3000 and every `categories.seo` assertion
# fails with "Points to another hreflang location" — locally only, which made it
# look like a real regression twice during the W2 integration. CI's own `env:`
# block sets the same value and still wins.
export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-http://localhost:3100}"

log_step "next build"
npm run build

log_step "bundle guard"
npx --no-install tsx scripts/bundle-guard.ts

if [[ -f scripts/perf/bundle-budget.ts ]]; then
  log_step "bundle budget"
  npx --no-install tsx scripts/perf/bundle-budget.ts
else
  log_warn "scripts/perf/bundle-budget.ts missing — skipping the bundle budget"
fi

if [[ ! -f app/api/health/route.ts ]]; then
  log_warn "app/api/health/route.ts not present yet (W0-T4) — skipping the boot check"
  log_ok "build passed"
  exit 0
fi

# The boot check starts a real server, so it needs the whole environment
# contract, not just a database URL: since W5 `instrumentation.ts` runs
# `getEnv()` before the server answers its first request, and the `next` CLI
# makes every `next start` NODE_ENV=production, so a missing AUTH_SECRET or
# AUTH_URL now makes every page and route handler answer 500 — `/api/health`
# included — rather than surfacing later and elsewhere. The curl loop below is
# what turns that into a failed step: there is no exit code to read, and Next
# prints "Ready" all the same.
#
# It used to be "if POSTGRES_URL is unset, load the whole of .env.test", which
# was all-or-nothing: CI sets POSTGRES_URL in the job's `env:` block, so CI
# loaded NOTHING and the started server had no AUTH_URL at all. Per key, with a
# real variable always winning, is what makes both paths complete. The three
# test flags are never read from the file (see `_lib.sh`) — the two that matter
# here are exported above, deliberately.
#
# This runs AFTER `npm run build` on purpose: `NEXT_PUBLIC_*` is inlined by the
# bundler, so a value acquired here must never be able to reach the bundle.
load_env_contract_defaults

BOOT_PORT="${BOOT_PORT:-3001}"
BOOT_LOG="$(mktemp "${TMPDIR:-/tmp}/velo-boot.XXXXXX")"
BOOT_PID=""

cleanup() {
  if [[ -n "$BOOT_PID" ]] && kill -0 "$BOOT_PID" 2>/dev/null; then
    kill "$BOOT_PID" 2>/dev/null || true
    wait "$BOOT_PID" 2>/dev/null || true
  fi
  rm -f "$BOOT_LOG"
}
trap cleanup EXIT

log_step "boot check (next start -p $BOOT_PORT, GET /api/health)"
npx --no-install next start -p "$BOOT_PORT" >"$BOOT_LOG" 2>&1 &
BOOT_PID=$!

ok=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${BOOT_PORT}/api/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  if ! kill -0 "$BOOT_PID" 2>/dev/null; then
    break
  fi
  sleep 2
done

if [[ "$ok" != "1" ]]; then
  log_err "the production server never answered /api/health"
  cat "$BOOT_LOG" >&2
  exit 1
fi

body="$(curl -fsS "http://127.0.0.1:${BOOT_PORT}/api/health")"
printf "  /api/health -> %s\n" "$body"
case "$body" in
*'"ok":true'*) : ;;
*)
  log_err "/api/health did not report ok:true"
  exit 1
  ;;
esac

# Stop it before the next step: the `boot` project starts servers of its own
# and must not share the runner with this one.
cleanup
BOOT_PID=""

# The boot check above proves this build starts. The `boot` Vitest project
# proves the OTHER direction — that a poisoned deployment environment answers
# no page and no route handler — by spawning `next start` against this same
# `.next` and sampling `/api/health`. It lives here and not in
# `tests/integration/` because the CI `integration` job has no build: a spec
# placed there would skip vacuously and prove nothing. The project is only
# defined when `.next/BUILD_ID` exists (vitest.config.ts), so `npm test` in a
# fresh clone never sees it.
#
# THIS LINE IS THE ONLY LINK between `tests/boot/` and any gate: the unit job
# names its four projects, coverage only merges blobs, and pre-push skips the
# build. `tests/unit/deploy/boot-tier-gate.test.ts` fails if it goes.
log_step "boot contract (vitest --project boot)"
npx --no-install vitest run --project boot

log_ok "build passed"
