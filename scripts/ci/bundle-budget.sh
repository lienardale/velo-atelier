#!/usr/bin/env bash
# First-load JS budget, standalone.
#
# `build.sh` already runs this after `next build`; this wrapper exists so the
# nightly `perf.yml` workflow (and a developer poking at a bundle regression)
# can re-measure an existing `.next/` without rebuilding.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

# `.next/` and not `.next/app-build-manifest.json`: that file is a webpack
# artefact and a Turbopack build does not emit it. bundle-budget.ts resolves the
# per-route Turbopack manifests itself.
if [[ ! -d .next ]]; then
  skip_step "no .next/ — run scripts/ci/build.sh first"
fi

log_step "bundle budget"
npx --no-install tsx scripts/perf/bundle-budget.ts

log_ok "bundle budget respected"
