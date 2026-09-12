#!/usr/bin/env bash
# Static application security testing with Semgrep.
#
# Rulesets: OWASP Top 10 + the TypeScript / JavaScript / Next.js / React packs.
# They are fetched from semgrep.dev on every run, so new patterns start applying
# without a bump here.
#
# The `SAST (semgrep)` job calls THIS script rather than inlining the semgrep
# invocation (skipper-website inlines it — that divergence is what let its CI
# and its local mirror drift apart, and the plan calls it out explicitly).
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

if ! command -v semgrep >/dev/null 2>&1; then
  if [[ "${CI:-}" == "true" ]]; then
    log_step "installing semgrep"
    if command -v pipx >/dev/null 2>&1; then
      pipx install semgrep >/dev/null
      PATH="$HOME/.local/bin:$PATH"
      export PATH
    else
      python3 -m pip install --quiet --user semgrep
      PATH="$HOME/.local/bin:$PATH"
      export PATH
    fi
  else
    require_cmd semgrep "brew install semgrep  # or: pipx install semgrep"
  fi
fi

log_step "semgrep (OWASP Top 10 + TS + JS + Next.js + React)"
# --error   findings exit non-zero (this is a gate, not a report)
# --metrics off  keeps this repo off the public counter
# One rule is excluded, with a reason:
#   generic-api-key            gitleaks owns secret detection here, and
#                              `.gitleaks.toml` is the one place that decision is
#                              recorded. Two allowlists would drift.
semgrep scan \
  --config p/owasp-top-ten \
  --config p/typescript \
  --config p/javascript \
  --config p/nextjs \
  --config p/react \
  --error \
  --quiet \
  --metrics off \
  --timeout 60 \
  --exclude-rule generic.secrets.security.detected-generic-api-key.detected-generic-api-key \
  --exclude lib/generated \
  --exclude .content-collections \
  --exclude .next \
  --exclude coverage

log_ok "SAST clean"
