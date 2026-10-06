#!/usr/bin/env bash
# Validate renovate.json against Renovate's own schema.
#
# Renovate stops EVERYTHING on a configuration error — no dependency dashboard,
# no update PRs, nothing — so an invalid file looks exactly like a quiet week.
# W5 shipped one written in W1 and heard about it from Renovate's own "Action
# Required" issue, six days after the app was installed (`.debug/016` §4).
# Nothing in this repository had ever parsed the file: the `$schema` line is
# honoured by editors, not by any gate, and neither ESLint nor `tsc` nor a CI
# job reads it.
#
# `renovate-config-validator` ships inside the `renovate` package and is the
# only reader of `renovate.json` the repository can host itself. It is NOT one
# of scripts/ci.sh's steps and NOT a required status context: the install pulls
# the whole of Renovate (~350 MB on a cold npx cache; not timed on a runner),
# which is why the job that calls it is path-filtered — to `renovate.json`, to
# this script and to its own workflow file
# (.github/workflows/renovate-config.yml) — and a path-filtered context that
# never reports would block every other PR for ever (`.debug/016` §2).
#
# `--no-global` is not decoration. Handed a FILENAME, the validator treats it
# as a self-hosted GLOBAL config by default — it says so, `Validating
# renovate.json as global config` — and the global schema is WIDER than the
# repository schema the service applies. Measured on 44.108.1, one file both
# ways: a copy carrying `baseDir` and `redisUrl` passes as a global config
# (exit 0) and fails as a repo config with `The "baseDir" option is a global
# option reserved only for Renovate's global configuration and cannot be
# configured within a repository's config file.` (exit 1). Without the flag
# this job would be weaker than the service it stands in for, in the one
# direction that matters (docs/deploy.md §4.4).
#
# `--strict`, on the other hand, must NOT be added, however much it looks like
# the obvious companion flag. Measured on the pin below, same committed file:
# `--no-global` exits 0, `--no-global --strict` exits 1 — on `WARN: Config
# migration necessary`, which is the `customManagers[].fileMatch` ->
# `managerFilePatterns` RENAME. The service still honours the old spelling, so
# the flag would redden this job over a deprecation rather than a defect. The
# rename is its own PR (docs/deploy.md §4.4); until it lands, the flag stays off.
#
# Run it by hand after editing the file:
#
#   bash scripts/ci/renovate-config.sh              # renovate.json
#   bash scripts/ci/renovate-config.sh other.json   # any other copy
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

# Pinned, and never `@latest`.
#
# `scripts/ci/lint.sh` states this pipeline's rule — "`--no-install`
# everywhere: if a binary is missing the answer is `npm ci`, not a silent
# download of some other version from the registry" — and this is the one
# script that cannot obey the letter of it. The validator IS the whole of
# Renovate (~350 MB on a cold npx cache; not timed on a runner) for one
# path-filtered job — a file that changes a few times a year, and the pin
# below, which Renovate is expected to bump about weekly — so putting it in
# `devDependencies` would tax every `npm ci` in every job. It is therefore
# downloaded rather than installed — but at an exact version, because an
# unpinned `npx` runs whatever the registry served that minute, from outside
# the lockfile and so invisible to `audit-ci`. A supply-chain hold of the kind
# `renovate.json` imposes on every real dependency (`minimumReleaseAge`) is
# worth at least this much here — which is also why the pin below is a release
# at least SEVEN DAYS old, not the newest one that works. Renovate ships several versions a day (TWENTY-FOUR
# 44.1xx releases across 2026-09-29 and 2026-09-30 — 13 then 11, counted from
# the registry's own `time` map), so "latest" and "latest when I wrote this" are
# the same unheld package.
#
# Renovate keeps the pin current: renovate.json's second `customManagers`
# entry matches the line below, so a bump arrives as an ordinary PR — held the
# same 7 days as everything else, and validated by this very job. That last
# clause was false when it was first written: the bump edits THIS file and no
# other, and the workflow was path-filtered to `renovate.json` alone, so the
# job would not have started on it. This script is now one of the workflow's
# `paths:` (tests/unit/ci/required-checks.test.ts pins the list). Nothing but
# that regex may be on the line, and no date beside it: Renovate rewrites the
# version and would leave any comment about it behind, lying.
RENOVATE_VERSION="44.108.1"

CONFIG="${1:-renovate.json}"

if [[ ! -f "$CONFIG" ]]; then
  log_err "no such Renovate config: $CONFIG (looked from $PROJECT_ROOT)"
  exit 1
fi

log_step "renovate-config-validator --no-global $CONFIG (renovate@$RENOVATE_VERSION)"

# `--yes` keeps the download non-interactive on a runner; `--no-global` is
# what makes this a REPOSITORY config check (see the header).
#
# The line stands alone on purpose. Its exit status IS the job's verdict, and
# `set -e` (in `_lib.sh`) is what carries it out of this script: `|| true`
# after it, or an `if !` around it, leaves every flag above in place and turns
# the gate into a green tick. tests/unit/ci/renovate-config.test.ts runs this
# script against a stand-in `npx` that fails, and expects to fail with it.
npx --yes --package "renovate@$RENOVATE_VERSION" -- renovate-config-validator --no-global "$CONFIG"

log_ok "$CONFIG is valid Renovate configuration"
