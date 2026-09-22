#!/usr/bin/env bash
# Lighthouse CI over the production build.
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
