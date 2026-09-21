#!/usr/bin/env bash
# Playwright, one project per invocation.
#
# The workflow matrix passes `PLAYWRIGHT_PROJECT`; locally, run
# `bash scripts/ci/e2e.sh` for the default desktop project or set the variable.
# e2e never runs from `scripts/ci.sh` / the pre-push hook: it needs a production
# build, browsers and a database, and it is where the CI minute budget goes.
#
# `playwright.config.ts` owns the webServer, the global setup (migrate reset +
# seed against a `_test` database) and the GL flags; this script only decides
# which project runs and where the report goes.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

if [[ ! -f playwright.config.ts ]]; then
  skip_step "playwright.config.ts does not exist yet (W0-T3b)"
fi
if [[ -z "$(find tests/e2e -name '*.spec.ts' -print -quit 2>/dev/null)" ]]; then
  skip_step "tests/e2e/ has no specs yet"
fi

PLAYWRIGHT_PROJECT="${PLAYWRIGHT_PROJECT:-desktop-chromium}"

# The CI job runs inside mcr.microsoft.com/playwright:v1.63.0-noble, which
# already ships the browsers at /ms-playwright — installing there would need
# root and re-download them for nothing. Anywhere else, fetch them once.
if [[ ! -d /ms-playwright ]]; then
  log_step "playwright install (chromium, webkit)"
  npx --no-install playwright install chromium webkit
fi

extra=""
if [[ "${UPDATE_SNAPSHOTS:-0}" == "1" ]]; then
  # Baselines are byte-comparisons of Linux renders, and the COMMITTED ones come
  # from one place only: this script under perf.yml's `update-snapshots` job
  # (workflow_dispatch, update_snapshots=true), whose PR carries the
  # `visual-baseline` label. The amd64 container (`npm run e2e:update-snapshots`)
  # records for a local look, never for a commit. A laptop's fonts and GPU
  # produce images that would fail for everyone else.
  if [[ "${GITHUB_ACTIONS:-}" != "true" && ! -d /ms-playwright ]]; then
    log_err "UPDATE_SNAPSHOTS=1 outside CI and outside the amd64 container would"
    log_err "record host-specific baselines. Committed baselines are recorded by CI:"
    log_err "  gh workflow run perf.yml --ref <branch> -f update_snapshots=true"
    exit 1
  fi
  # The @snapshot tests ONLY. This run exists to record images: the whole suite
  # would let an unrelated failure fail the step, and the step after it — the
  # PR that carries the baselines — would never run. `changed` (the flag's own
  # default in @playwright/test 1.63, spelled out) writes a missing baseline and
  # rewrites only the ones that no longer match, so a refresh PR shows exactly
  # the images that moved.
  extra="--grep @snapshot --update-snapshots=changed"
  log_warn "recording screenshot baselines (@snapshot only)"
fi

log_step "playwright test --project $PLAYWRIGHT_PROJECT $extra"
# shellcheck disable=SC2086 -- $extra is set above to fixed flags, never user input; it splits on purpose.
npx --no-install playwright test --project "$PLAYWRIGHT_PROJECT" $extra

log_ok "e2e ($PLAYWRIGHT_PROJECT) passed"
