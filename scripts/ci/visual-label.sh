#!/usr/bin/env bash
# Guard on Playwright screenshot baselines.
#
# Baselines are byte-comparisons produced on amd64 Linux. A baseline updated
# from a laptop, or updated to make a real regression go away, is invisible in a
# diff — it just looks like "a screenshot changed". So a PR that touches
# `tests/e2e/__screenshots__/**` must carry the `visual-baseline` label, which
# is a human saying "I looked at these images and they are correct".
#
# The job that calls this is itself path-filtered, so outside such a PR the
# script has nothing to check and says so.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

LABEL="visual-baseline"
PR_NUMBER="${PR_NUMBER:-}"

if [[ -z "$PR_NUMBER" && -n "${GITHUB_REF:-}" ]]; then
  case "$GITHUB_REF" in
  refs/pull/*/merge | refs/pull/*/head)
    PR_NUMBER="${GITHUB_REF#refs/pull/}"
    PR_NUMBER="${PR_NUMBER%%/*}"
    ;;
  esac
fi

if [[ -z "$PR_NUMBER" ]]; then
  skip_step "not a pull request — nothing to label-check"
fi

require_cmd gh "brew install gh  # https://cli.github.com"

log_step "gh pr view $PR_NUMBER --json labels"
labels="$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name')"
printf "  labels: %s\n" "$(echo "$labels" | tr '\n' ' ')"

if ! printf "%s\n" "$labels" | grep -qx "$LABEL"; then
  log_err "this PR changes tests/e2e/__screenshots__/** but is not labelled '$LABEL'"
  log_err "review the new baselines, then add the label (they are regenerated only on CI"
  log_err "or in the amd64 container: npm run e2e:update-snapshots)"
  exit 1
fi

log_ok "visual baselines are labelled '$LABEL'"
