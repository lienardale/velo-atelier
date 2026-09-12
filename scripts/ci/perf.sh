#!/usr/bin/env bash
# WebGL performance gate.
#
# Two very different kinds of assertion live in the `perf` / `perf-mobile`
# Playwright projects:
#   * HARD  — draw calls, triangles, texture memory, device pixel ratio,
#             drawing-buffer size. Deterministic, they fail the job.
#   * SOFT  — frame times. CI renders through SwiftShader (software), so a
#             number there says nothing about a real GPU; `scripts/perf/
#             compare.ts` turns them into a summary with the warn/fail ladder
#             (>150 % warn, >300 % fail vs the recorded baseline).
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

if [[ ! -f playwright.config.ts ]]; then
  skip_step "playwright.config.ts does not exist yet (W0-T3b)"
fi
if [[ -z "$(find tests/perf -name '*.spec.ts' -print -quit 2>/dev/null)" ]]; then
  skip_step "tests/perf/ has no specs yet"
fi

if [[ ! -d /ms-playwright ]]; then
  log_step "playwright install (chromium)"
  npx --no-install playwright install chromium
fi

repeat=""
if [[ -n "${PERF_REPEAT:-}" ]]; then
  # The nightly run repeats each spec (5 by default in perf.yml) so the median
  # is not one unlucky SwiftShader frame.
  repeat="--repeat-each=${PERF_REPEAT}"
fi

log_step "playwright test --project perf --project perf-mobile $repeat"
# shellcheck disable=SC2086 -- $repeat is a single controlled flag, not user input.
npx --no-install playwright test --project perf --project perf-mobile $repeat

if [[ -f scripts/perf/compare.ts ]]; then
  log_step "compare against baselines"
  npx --no-install tsx scripts/perf/compare.ts
fi

log_ok "perf counters within budget"
