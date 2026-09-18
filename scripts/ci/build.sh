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

# `/api/health` opens a connection, so the boot check needs a database URL. In
# CI the workflow's `env:` block provides it (the service container); locally
# there is no `.env` in a fresh clone, so fall back to the committed `.env.test`
# — real environment variables always win.
if [[ -z "${POSTGRES_URL:-}" && -f .env.test ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ -n "${!key:-}" ]] && continue
    export "$key=$value"
  done <.env.test
fi

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

log_ok "build passed"
