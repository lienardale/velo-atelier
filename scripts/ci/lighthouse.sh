#!/usr/bin/env bash
# Lighthouse CI over the production build. `npm run lhci` runs this file too:
# a bare `lhci autorun` starts `npm run start` from whatever the shell holds,
# and from a README-style `.env.local` (Google pair empty) that server is
# refused by the environment contract — after printing the "Ready" that lhci
# takes as its cue, and then answering 500 for every page (the server's side
# measured in review, 2026-10-06; lhci itself was not run against it).
#
# `lighthouserc.cjs` owns the URL list, the assertions and the Chrome flags
# (SwiftShader, because the demo-bike pages render WebGL). This script points
# `CHROME_PATH` at a browser that exists — in the Playwright container there is
# no system Chrome, but Playwright's own chromium is there — and, pass or fail,
# prints every run and the median per URL (scripts/perf/lighthouse-report.ts),
# to the log and the job summary: the measured source every Lighthouse pin is
# taken from. The step's exit code is still lhci's.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

if [[ ! -f lighthouserc.cjs ]]; then
  skip_step "lighthouserc.cjs does not exist yet"
fi
if [[ ! -d .next ]]; then
  skip_step "no .next/ — run scripts/ci/build.sh first"
fi
if [[ ! -d content/guides ]]; then
  # Half of the URL list in lighthouserc.cjs is guide pages; scoring 404s tells
  # us nothing. The gate turns on with the content (W2-T4).
  skip_step "content/guides/ does not exist yet — the Lighthouse URL list is not routable"
fi

if [[ -z "${CHROME_PATH:-}" ]]; then
  detected="$(node -e "
    try {
      console.log(require('playwright-core').chromium.executablePath());
    } catch {
      /* playwright not installed here — leave CHROME_PATH to lhci */
    }
  " 2>/dev/null || true)"
  if [[ -n "$detected" && -x "$detected" ]]; then
    CHROME_PATH="$detected"
    export CHROME_PATH
    printf "  CHROME_PATH=%s\n" "$CHROME_PATH"
  fi
fi

# lhci starts the server itself (`startServerCommand: npm run start`), and since
# W5 `instrumentation.ts` validates the environment before that server answers.
# The job's `env:` block carries a database URL and AUTH_SECRET but no AUTH_URL,
# so without this the server would be refused — and nothing would stop lhci
# there: Next prints "Ready" (lhci's ready pattern) and then answers 500 for
# every page, so the audit starts against a server that serves none. Derive
# AUTH_URL from the origin actually being audited — a worktree moves both with
# LHCI_BASE_URL — and take everything else still missing from `.env.test`.
# Real environment variables win; the three test flags are never read from the
# file, so what the page renders is decided by the BUILD, exactly as before.
#
# Locally that "everything else" includes the database URLs, so the audited
# server runs on `.env.test`'s `_test` database unless the shell exports its
# own (see `load_env_contract_defaults`). `.env.local` is still read by
# `next start` for whatever remains unset — the three test flags, typically.
export AUTH_URL="${AUTH_URL:-${LHCI_BASE_URL:-http://localhost:3100}}"
load_env_contract_defaults

# Old runs must not be reported as this one's.
rm -rf "${PROJECT_ROOT:?}/.lighthouseci"

log_step "lhci autorun"
status_code=0
npx --no-install lhci autorun || status_code=$?

log_step "lighthouse report (every run, and the medians)"
npx --no-install tsx scripts/perf/lighthouse-report.ts || log_warn "lighthouse-report failed; the assertions above still decide"

if [[ "$status_code" != "0" ]]; then
  log_err "lighthouse assertions failed (lhci exit $status_code) — the table above has every run"
  exit "$status_code"
fi
log_ok "lighthouse assertions passed"
