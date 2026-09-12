#!/usr/bin/env bash
# Lighthouse CI over the production build.
#
# `lighthouserc.cjs` owns the URL list, the assertions and the Chrome flags
# (SwiftShader, because the demo-bike pages render WebGL). This script only
# points `CHROME_PATH` at a browser that exists: in the Playwright container
# there is no system Chrome, but Playwright's own chromium is there.
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

log_step "lhci autorun"
npx --no-install lhci autorun

log_ok "lighthouse assertions passed"
