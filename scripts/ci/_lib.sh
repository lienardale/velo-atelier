#!/usr/bin/env bash
# Shared helpers for scripts/ci/* — sourced by every step script.
#
# Sourcing this file is the FIRST thing every step does, because it is what
# guarantees the step behaves identically in three very different shells:
#
#   1. the developer's terminal            (nvm-managed Node, tools from brew)
#   2. Claude Code / any non-login shell   (~/.zshrc is NOT read -> no node)
#   3. GitHub Actions                      (actions/setup-node put node on PATH,
#                                           nvm is absent)
#
# Hence the nvm line below: it runs before `set -u` so a missing ~/.nvm is a
# no-op rather than an error, and it is skipped entirely on a runner.
# shellcheck disable=SC1091
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" && nvm use --silent 24

set -euo pipefail

# Project root — every script runs from here regardless of the caller's cwd.
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
export PROJECT_ROOT

# Colours — disabled when stdout is not a TTY so CI logs stay readable.
if [[ -t 1 ]]; then
  C_RESET="\033[0m"
  C_BOLD="\033[1m"
  C_BLUE="\033[34m"
  C_GREEN="\033[32m"
  C_RED="\033[31m"
  C_YELLOW="\033[33m"
else
  C_RESET=""
  C_BOLD=""
  C_BLUE=""
  C_GREEN=""
  C_RED=""
  C_YELLOW=""
fi
export C_RESET C_BOLD C_BLUE C_GREEN C_RED C_YELLOW

log_step() { printf "${C_BOLD}${C_BLUE}::%s${C_RESET}\n" " $*"; }
log_ok() { printf "${C_GREEN}::%s${C_RESET}\n" " $*"; }
log_err() { printf "${C_RED}::%s${C_RESET}\n" " $*" >&2; }
log_warn() { printf "${C_YELLOW}:: WARNING%s${C_RESET}\n" " $*" >&2; }

# require_cmd <binary> <install hint>
# Exits non-zero with a clear message when a tool is missing — a security check
# must never silently disappear.
require_cmd() {
  local cmd="$1"
  local hint="${2:-}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_err "missing required tool: $cmd"
    [[ -n "$hint" ]] && log_err "install: $hint"
    exit 127
  fi
}

# skip_step <reason...>
#
# The whole pipeline exists from the first commit, but most of what it gates is
# written in later waves. A step whose target does not exist yet must be LOUD
# and HARMLESS: it prints a warning, records SKIP, and exits 0. It must never
# print PASS (that would hide a gate that is not actually running) and never
# fail the run (that would make the pipeline useless until the last wave).
#
# scripts/ci.sh passes CI_STEP_STATUS_FILE so it can tell SKIP from PASS in the
# summary table. Run standalone (or from a workflow job) the marker is simply
# dropped and the exit code stays 0.
skip_step() {
  log_warn "SKIP — $*"
  if [[ -n "${CI_STEP_STATUS_FILE:-}" ]]; then
    printf "SKIP\n" >"$CI_STEP_STATUS_FILE"
  fi
  exit 0
}

# load_env_contract_defaults [file]
#
# Fill in, from the committed `.env.test`, every variable `lib/env.ts` requires
# that is not already set. A real environment variable always wins, so a CI
# `env:` block (Postgres on host `postgres`, not `localhost`) and a worktree's
# own exports are untouched.
#
# Why a step needs this at all: `instrumentation.ts` runs `getEnv()` on every
# `next start` (W5), and the `next` CLI defaults NODE_ENV to production, so a
# started server with no AUTH_SECRET or no AUTH_URL now answers 500 to every
# request instead of failing later and elsewhere. Two steps start a server from an environment
# that was never complete — `build.sh`'s boot check and the `npm run start`
# that `lighthouse.sh` has lhci run — and `.env.test` is exactly the set of
# values CI already runs against (gitleaks allowlists the file; nothing in it
# is a credential).
#
# THE THREE TEST FLAGS ARE NEVER TAKEN FROM THE FILE. `ENABLE_TEST_PAGES`,
# `NEXT_PUBLIC_TEST_HOOKS` and `NEXT_PUBLIC_DEMO_LOGIN` open `/dev/*`, ship
# `window.__va` and print demo credentials. A step that wants one sets it
# deliberately (build.sh does, and pins the hooks OFF by default); a step that
# does not must never acquire one by reading a file.
load_env_contract_defaults() {
  local file="${1:-$PROJECT_ROOT/.env.test}"
  [[ -f "$file" ]] || return 0
  local key value
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[[:space:]]*(#|$) ]] && continue
    case "$key" in
    ENABLE_TEST_PAGES | NEXT_PUBLIC_TEST_HOOKS | NEXT_PUBLIC_DEMO_LOGIN) continue ;;
    esac
    [[ -n "${!key:-}" ]] && continue
    export "$key=$value"
    printf "  %s <- %s (was unset)\n" "$key" "$(basename -- "$file")"
  done <"$file"
}

# summary <markdown...>  — append to the GitHub job summary, echo it locally.
summary() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf "%s\n" "$*" >>"$GITHUB_STEP_SUMMARY"
  else
    printf "%s\n" "$*"
  fi
}

# install_pinned_tool <name> <version> <url> <tar member>
# Downloads a pinned release tarball and puts it on PATH. Outside the repository
# on purpose (RUNNER_TEMP on Actions, /tmp otherwise) so a downloaded binary can
# never end up staged by a careless `git add -A`.
#
# Only ever used on a runner: locally we want the developer's own (brew) copy, so
# the version they debug with is the version they installed.
install_pinned_tool() {
  local name="$1" version="$2" url="$3" member="$4"
  local dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/velo-ci-tools"
  mkdir -p "$dir"
  if [[ ! -x "$dir/$name" ]]; then
    log_step "installing $name $version (CI only)"
    curl -sSfL "$url" | tar -xz -C "$dir" "$member"
    chmod +x "$dir/$name"
  fi
  PATH="$dir:$PATH"
  export PATH
}
