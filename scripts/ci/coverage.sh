#!/usr/bin/env bash
# THE coverage gate (80 % lines/branches/functions/statements, with the tighter
# per-glob thresholds declared in vitest.config.ts).
#
# It merges the blob reports produced by `test-unit.sh` and
# `test-integration.sh` and re-runs coverage over the union. Merging is not a
# nicety: `lib/db/**` is only exercised by the integration tier and
# `components/**` only by the unit tier, so either job alone is below threshold.
#
# In CI this job runs with `if: !cancelled()` so that a failing test tier still
# produces a coverage report — which means the script itself has to refuse to
# report a green gate when a tier did not pass. `UNIT_RESULT` and
# `INTEGRATION_RESULT` are the `needs.<job>.result` values passed by the
# workflow ('' when run locally).
#
# The markdown table for `$GITHUB_STEP_SUMMARY` is written by the workflow's one
# `jq` step (see .github/workflows/ci.yml) rather than from here, so that every
# `- run:` line in a job body is either `npm ci` or `bash scripts/ci/<step>.sh`.
#
# Written for bash 3.2 (the macOS system bash): no `${var,,}`, no associative
# arrays, no `mapfile`.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

check_tier() {
  local label="$1" value="$2"
  if [[ -n "$value" && "$value" != "success" && "$value" != "skipped" ]]; then
    log_err "$label tier result is '$value' — refusing to compute a coverage verdict"
    exit 1
  fi
}

check_tier unit "${UNIT_RESULT:-}"
check_tier integration "${INTEGRATION_RESULT:-}"

if [[ ! -f vitest.config.ts ]]; then
  skip_step "vitest.config.ts does not exist yet (W0-T3b)"
fi

shopt -s nullglob
blobs=(.vitest-reports/*.json)
shopt -u nullglob

if [[ ${#blobs[@]} -eq 0 ]]; then
  log_warn "no blob reports in .vitest-reports/ — running the whole suite instead"
  log_step "vitest run --coverage"
  npx --no-install vitest run --coverage
else
  log_step "vitest run --merge-reports (${#blobs[@]} blob report(s))"
  npx --no-install vitest run --merge-reports=.vitest-reports --coverage
fi

if [[ -f coverage/coverage-summary.json ]] && command -v jq >/dev/null 2>&1; then
  log_step "coverage totals"
  jq -r '.total | "  lines      \(.lines.pct) %\n  branches   \(.branches.pct) %\n  functions  \(.functions.pct) %\n  statements \(.statements.pct) %"' \
    coverage/coverage-summary.json
fi

log_ok "coverage gate passed"
