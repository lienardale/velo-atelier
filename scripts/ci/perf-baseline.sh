#!/usr/bin/env bash
# Stage the soft-tier baselines a perf.yml run recorded, for the bot PR.
#
# The `perf (nightly)` job ran the specs with `UPDATE_PERF_BASELINE=1`, so
# `scripts/perf/compare.ts` wrote `tests/perf/baselines/<project>.json` from
# THIS run and the job uploaded them in its `perf-nightly` artifact. The
# `perf baseline PR` job downloads that artifact to `$PERF_BASELINE_SOURCE`,
# calls this script, then opens the PR. It holds a write token (as
# `update-snapshots` does), so it builds and tests nothing: no dependency
# script or git hook runs there, only this script (node + Prettier).
#
# Refuses anything a reviewer should not have to catch: no file, a file that is
# not JSON, a baseline without presets, one that still carries its raw
# samples, or one recorded outside GitHub Actions.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

source_dir="${PERF_BASELINE_SOURCE:?PERF_BASELINE_SOURCE must point at the downloaded perf-nightly artifact}"
from="$source_dir/tests/perf/baselines"
if [[ ! -d "$from" ]] || [[ -z "$(find "$from" -maxdepth 1 -name '*.json' -print -quit)" ]]; then
  log_err "no baseline in $from — did the perf job run with update_baseline=true?"
  exit 1
fi

mkdir -p tests/perf/baselines
for file in "$from"/*.json; do
  node -e '
    const run = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const problems = [];
    if (!run.presets || Object.keys(run.presets).length === 0) problems.push("no presets");
    if ("samples" in run) problems.push("raw samples left in");
    if (!/github-actions|ubuntu/.test(String(run.runner))) problems.push(`runner "${run.runner}" is not a CI runner`);
    if (!run.three) problems.push("no three version");
    if (problems.length > 0) { console.error(`${process.argv[1]}: ${problems.join(", ")}`); process.exit(1); }
    console.log(`  ${require("node:path").basename(process.argv[1])}: ${Object.keys(run.presets).length} presets, ${run.repetitions} repetition(s), ${run.runner}, three ${run.three}`);
  ' "$file"
  cp "$file" tests/perf/baselines/
done

# The bot PR must pass `prettier --check .` like any other.
npx --no-install prettier --check tests/perf/baselines

summary "### Perf baselines staged"
summary ""
for file in tests/perf/baselines/*.json; do
  summary "- \`$file\`"
done
log_ok "baselines staged for the PR"
