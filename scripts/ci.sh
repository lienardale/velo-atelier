#!/usr/bin/env bash
# Local mirror of the GitHub Actions pipeline.
#
# It runs the EXACT scripts .github/workflows/ci.yml runs — that parity is the
# whole point: a green `npm run ci:local` means a green pipeline, and CI minutes
# are not spent on something the laptop could have caught. `.husky/pre-push`
# calls this with SKIP_BUILD=1.
#
# e2e, Lighthouse and perf are deliberately NOT here: they need a production
# build, browsers and several minutes. Run `npm run e2e:docker` for the full
# browser suite locally.
#
# A step whose target does not exist yet (no vitest config, no content, no
# Prisma schema — the state of a half-built repo) prints a WARNING and reports
# SKIP with exit 0. It must never report PASS: a gate that is not running has to
# be visible in the table.
#
# Env knobs:
#   SKIP_BUILD=1     skip `next build` (default in the pre-push hook; CI builds)
#   SKIP_DB=1        skip the integration tier (no Docker)
#   SKIP_SECURITY=1  skip secrets/audit/sast/trivy (offline; never before a push)
#   STEPS="lint …"   run only these steps, in this order
#
# Written for bash 3.2 (macOS system bash).
set -euo pipefail

# shellcheck source=scripts/ci/_lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/ci/_lib.sh"
cd "$PROJECT_ROOT"

ALL_STEPS="nvmrc lint typecheck content test-unit test-integration coverage secrets audit sast trivy build"

if [[ -n "${STEPS:-}" ]]; then
  STEPS_TO_RUN="$STEPS"
else
  STEPS_TO_RUN="$ALL_STEPS"
fi

drop_step() {
  local drop="$1" kept="" s
  for s in $STEPS_TO_RUN; do
    [[ "$s" == "$drop" ]] && continue
    kept="$kept $s"
  done
  STEPS_TO_RUN="${kept# }"
}

if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  drop_step build
fi
if [[ "${SKIP_DB:-0}" == "1" ]]; then
  drop_step test-integration
  log_warn "SKIP_DB=1 — the integration tier is not running (coverage will be lower)."
fi
if [[ "${SKIP_SECURITY:-0}" == "1" ]]; then
  for sec in secrets audit sast trivy; do
    drop_step "$sec"
  done
  log_warn "SKIP_SECURITY=1 — gitleaks/audit/semgrep/trivy disabled. Do NOT push this way."
fi

# The database tier expects Docker to be up; bring the container up here rather
# than in the step so the step stays a faithful copy of what CI runs.
case " $STEPS_TO_RUN " in
*" test-integration "*)
  if docker info >/dev/null 2>&1; then
    log_step "▶ docker compose up -d --wait"
    npm run db:up
    VITEST_REQUIRE_DB=1
    export VITEST_REQUIRE_DB
  else
    log_warn "Docker daemon not running — start Docker Desktop, or re-run with SKIP_DB=1"
    drop_step test-integration
  fi
  ;;
esac

# bash 3.2 errors on `${#arr[@]}` for an empty array under `set -u`, so the
# count is tracked explicitly.
names=()
statuses=()
times=()
recorded=0

record() {
  names[$recorded]="$1"
  statuses[$recorded]="$2"
  times[$recorded]="$3"
  recorded=$((recorded + 1))
}

overall_start=$(date +%s)
failed=0

for step in $STEPS_TO_RUN; do
  script="$PROJECT_ROOT/scripts/ci/${step}.sh"
  if [[ ! -f "$script" ]]; then
    log_err "step '$step' has no script: $script"
    record "$step" FAIL 0
    failed=1
    break
  fi

  status_file="$(mktemp "${TMPDIR:-/tmp}/velo-ci-step.XXXXXX")"
  printf "PASS\n" >"$status_file"

  start=$(date +%s)
  log_step "▶ $step"
  if CI_STEP_STATUS_FILE="$status_file" bash "$script"; then
    status="$(cat "$status_file")"
  else
    status="FAIL"
  fi
  end=$(date +%s)
  rm -f "$status_file"

  record "$step" "$status" "$((end - start))"

  if [[ "$status" == "FAIL" ]]; then
    failed=1
    break # fail fast: the first failure is the one worth reading
  fi
done

overall_end=$(date +%s)

printf "\n${C_BOLD}── summary ──${C_RESET}\n"
i=0
while [[ $i -lt $recorded ]]; do
  name="${names[$i]}"
  status="${statuses[$i]}"
  seconds="${times[$i]}"
  case "$status" in
  PASS) printf "  ${C_GREEN}✓ PASS${C_RESET}  %-16s %ss\n" "$name" "$seconds" ;;
  SKIP) printf "  ${C_YELLOW}- SKIP${C_RESET}  %-16s %ss\n" "$name" "$seconds" ;;
  *) printf "  ${C_RED}✗ FAIL${C_RESET}  %-16s %ss\n" "$name" "$seconds" ;;
  esac
  i=$((i + 1))
done
printf "  total: %ss\n\n" "$((overall_end - overall_start))"

if [[ "$failed" == "1" ]]; then
  log_err "ci:local failed"
  exit 1
fi
log_ok "ci:local passed"
