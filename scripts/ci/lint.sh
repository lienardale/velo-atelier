#!/usr/bin/env bash
# ESLint + Prettier. Identical command set locally and in CI.
#
# `--no-install` everywhere: if a binary is missing the answer is `npm ci`, not
# a silent download of some other version from the registry.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

log_step "eslint"
npx --no-install eslint .

log_step "prettier --check"
npx --no-install prettier --check .

log_ok "lint passed"
