#!/usr/bin/env bash
# WebGL performance gate.
#
# Two very different kinds of assertion live in the `perf` / `perf-mobile`
# Playwright projects:
#   * HARD  — draw calls, triangles, programs, materials, device pixel ratio,
#             drawing-buffer size, one WebGL context, geometry freed.
#             Deterministic: they fail the job.
#   * SOFT  — frame cost, long frames, build time, tap latency (`@soft`). CI
#             renders through SwiftShader (software), so a number there says
#             nothing on its own; the spec writes it to `.perf/<project>.json`
#             and `scripts/perf/compare.ts` turns it into a summary with the
#             ladder (>150 % warn, >300 % fail vs tests/perf/baselines/;
#             long frames only ever warn on a software renderer, which CI is:
#             scripts/perf/ladder.ts has the W4 ruling).
#
# `UPDATE_PERF_BASELINE=1` (perf.yml, `update_baseline=true`) makes compare.ts
# copy this run into tests/perf/baselines/ instead; it refuses outside Actions.
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

# A stale run file must never be compared as if this run had written it (a
# soft test that crashed before writing would otherwise report LAST run's
# numbers). Only this directory, only run files; the committed local GPU runs
# (`local-*.json`) are left alone.
perf_dir="$PROJECT_ROOT/.perf"
if [[ -n "$PROJECT_ROOT" && -d "$perf_dir" ]]; then
  find "$perf_dir" -maxdepth 1 -type f \( -name '*.json' -o -name '*.tmp' \) ! -name 'local-*.json' -print -delete |
    sed 's/^/  removed stale /'
fi

# One id for every repetition of this invocation, so tests/perf/_record.ts
# merges the `--repeat-each` samples into one run file and never into an old one.
export PERF_RUN_ID="${PERF_RUN_ID:-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$(date +%s)}"

repeat=""
if [[ -n "${PERF_REPEAT:-}" ]]; then
  # The nightly run repeats each spec (5 in perf.yml) so the recorded median is
  # not one unlucky SwiftShader frame.
  repeat="--repeat-each=${PERF_REPEAT}"
fi

# `--workers=1`: one browser at a time. Each perf project already runs one
# worker, but the config's CI default (2) let `perf` and `perf-mobile` run side
# by side on the runner's 4 vCPUs, so every soft timing measured the other
# project too. Tap latency crossed the 300 % FAIL line on one sample in 70 in
# three nightlies (.debug/012) — noise the ladder would have reported as a
# regression. Serial costs job time, not accuracy, and the baselines are
# recorded under the same condition; the thresholds did not move.
log_step "playwright test --workers=1 --project perf --project perf-mobile $repeat (run $PERF_RUN_ID)"
# shellcheck disable=SC2086 -- $repeat is a single controlled flag, not user input.
npx --no-install playwright test --workers=1 --project perf --project perf-mobile $repeat

if [[ -f scripts/perf/compare.ts ]]; then
  log_step "compare against baselines"
  npx --no-install tsx scripts/perf/compare.ts
fi

log_ok "perf counters within budget"
