#!/usr/bin/env bash
# Everything that runs without a database: unit, ui (jsdom), bike3d (jsdom +
# three), security.
#
# This step is NOT the coverage gate. It writes a blob report plus raw coverage
# so `coverage.sh` can merge it with the integration run and enforce the 80 %
# thresholds once — a per-job threshold would fail on files the other job
# covers. Blob and default reporters are combined on purpose (verified on
# Vitest 4.1.11): CI needs the blob, a human needs to see which test failed.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

if [[ ! -f vitest.config.ts ]]; then
  skip_step "vitest.config.ts does not exist yet (W0-T3b)"
fi

# `tests/security/checkup-input.test.ts` imports `lib/content/generated/*` —
# the step-key and reason-key enums the checkup payload is validated against
# (W3-T1). They are generated and gitignored (CLAUDE.md), and this job runs
# neither `typecheck` nor `build`, which are the other two places that write
# them; `test-integration.sh` already carries the same three lines for the seed.
log_step "content:generate"
npx --no-install tsx scripts/content-check.ts --emit

log_step "vitest run (unit, ui, bike3d, security)"
npx --no-install vitest run \
  --project unit \
  --project ui \
  --project bike3d \
  --project security \
  --reporter=default \
  --reporter=blob \
  --outputFile.blob=.vitest-reports/unit.json \
  --coverage \
  --coverage.reporter=json

log_ok "unit tier passed"
