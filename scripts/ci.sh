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
#   KEEP_GENERATED=1 do NOT delete the generated trees first (see below)
#
# THE ONE PLACE THIS MIRROR IS NOT FAITHFUL, and why it deletes things: every CI
# job is a SEPARATE fresh checkout, while every step here shares this one working
# tree. So a gitignored generated tree left behind by an earlier build silently
# satisfies a later step, and the same commit is green here and red there — it
# happened twice, with `.content-collections` and then with
# `lib/content/generated` (which took down seven jobs; .debug/004 §10). The
# trees are therefore removed before the run, so each step has to generate what
# it needs exactly as its CI job does.
#
# Written for bash 3.2 (macOS system bash).
set -euo pipefail

# shellcheck source=scripts/ci/_lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/ci/_lib.sh"
cd "$PROJECT_ROOT"

ALL_STEPS="nvmrc lint typecheck content test-unit test-integration coverage secrets audit sast trivy build"

# Only ever these two paths, only ever under the repo root, and only what is
# gitignored and regenerable: `content-collections build` and
# `content-check --emit` write them back.
if [[ -z "${KEEP_GENERATED:-}" ]]; then
  for generated in lib/content/generated .content-collections; do
    if [[ -e "$PROJECT_ROOT/$generated" ]]; then
      rm -rf "${PROJECT_ROOT:?}/$generated"
      printf ':: removed %s (a fresh CI checkout has none)\n' "$generated"
    fi
  done
fi

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

# `host port` of the database the integration tier will use: the shell wins over
# `.env.test`, exactly as in scripts/ci/test-integration.sh. Empty when unknown.
integration_db_endpoint() {
  local url="${POSTGRES_URL_NON_POOLING:-${POSTGRES_URL:-}}"
  if [[ -z "$url" && -f "$PROJECT_ROOT/.env.test" ]]; then
    url="$(sed -n 's/^POSTGRES_URL_NON_POOLING=//p' "$PROJECT_ROOT/.env.test" | head -1)"
  fi
  [[ -n "$url" ]] || return 0
  node -e 'try { const u = new URL(process.argv[1]); console.log(`${u.hostname} ${u.port || 5432}`) } catch {}' "$url"
}

# Does something already answer on that host:port? A TCP connect, nothing more.
port_answers() {
  node -e '
    const s = require("node:net").connect({ host: process.argv[1], port: Number(process.argv[2]) });
    s.setTimeout(1500, () => process.exit(1));
    s.once("connect", () => { s.end(); process.exit(0); });
    s.once("error", () => process.exit(1));
  ' "$1" "$2"
}

# A linked `git worktree` (not the main checkout).
in_linked_worktree() {
  local dir common
  dir="$(git -C "$PROJECT_ROOT" rev-parse --path-format=absolute --git-dir 2>/dev/null)" || return 1
  common="$(git -C "$PROJECT_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  [[ "$dir" != "$common" ]]
}

# The database tier expects Docker to be up; bring the container up here rather
# than in the step so the step stays a faithful copy of what CI runs.
#
# `npm run db:up` is only ever run when nothing answers yet, and never from a
# linked worktree. docker-compose.yml pins `container_name`, and the compose
# project name is the directory name, so from a worktree `docker compose up`
# either creates a second project fighting over that name or — with the project
# name forced — RECREATES the container every other checkout is using (both
# observed with `--dry-run`, W4 setup). The pre-push hook runs this script, so
# without this guard every push from a worktree was one `db:up` away from that.
case " $STEPS_TO_RUN " in
*" test-integration "*)
  if docker info >/dev/null 2>&1; then
    endpoint="$(integration_db_endpoint)"
    where="${endpoint/ /:}"
    # shellcheck disable=SC2086 # "host port" is split on purpose
    if [[ -n "$endpoint" ]] && port_answers $endpoint; then
      log_step "▶ database already up at $where — not touching compose"
    elif in_linked_worktree; then
      log_err "nothing answers at ${where:-the integration database} and this is a linked git worktree."
      log_err "Start the database from the main checkout (npm run db:up there), or re-run with SKIP_DB=1."
      exit 1
    else
      log_step "▶ docker compose up -d --wait"
      npm run db:up
    fi
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
