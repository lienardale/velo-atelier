#!/usr/bin/env bash
# Secret scanning over the FULL git history with gitleaks.
#
# `gitleaks/gitleaks-action@v2` became licence-gated for organisations in 2024,
# so CI installs the CLI instead — pinned here, in one place, to the version the
# workflow is expected to reproduce. Locally we deliberately use whatever
# gitleaks the developer installed (brew): the point of the local mirror is to
# run the same *command*, and a newer ruleset can only find more.
#
# `.gitleaks.toml` carries the allowlist (`.env.example`, `.env.test`,
# `messages/**`, fakes, the seeded demo credentials) with a reason per entry.
GITLEAKS_VERSION="8.21.2"

source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

if ! command -v gitleaks >/dev/null 2>&1; then
  if [[ "${CI:-}" == "true" ]]; then
    arch="x64"
    [[ "$(uname -m)" == "aarch64" || "$(uname -m)" == "arm64" ]] && arch="arm64"
    os="$(uname -s | tr '[:upper:]' '[:lower:]')"
    install_pinned_tool gitleaks "$GITLEAKS_VERSION" \
      "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${os}_${arch}.tar.gz" \
      gitleaks
  else
    require_cmd gitleaks "brew install gitleaks  # https://github.com/gitleaks/gitleaks"
  fi
fi

gitleaks version

log_step "gitleaks detect (full history)"
# --redact keeps any match out of the log; --config makes local and CI identical.
gitleaks detect \
  --source . \
  --config "${PROJECT_ROOT}/.gitleaks.toml" \
  --no-banner \
  --redact

log_ok "no leaked secrets"
