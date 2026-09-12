#!/usr/bin/env bash
# Dependency vulnerability audit.
#
# `audit-ci` wraps `npm audit` and fails on the severity threshold in
# `audit-ci.json` (moderate and above). Advisories are fetched live, so this
# step can start failing without anything in the repo changing — that is the
# point. Every allow-listed GHSA is justified in `audit-ci-allowlist.md`.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

log_step "npm audit (audit-ci)"
npx --no-install audit-ci --config "${PROJECT_ROOT}/audit-ci.json"

log_ok "dependency audit clean"
