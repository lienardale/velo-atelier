#!/usr/bin/env bash
# The messenger of the scheduled advisory check (.github/workflows/advisories.yml).
#
# `audit` and `trivy` read a live advisory feed, and until this workflow only a
# pull request or a push ever ran them. On 2026-10-07 six advisories on `next`
# were published 5 h 38 min after `main`'s last CI run; nothing was pushed
# afterwards, and `main` stayed red by its own rule and green on GitHub for 41
# hours (`.debug/017` §2.7). The workflow now runs both gates on `main` every
# day. This script is what turns a red run into something a person reads.
#
# Per GitHub's documentation, a failed scheduled run notifies only the user who
# last changed the workflow's cron line, and only if their own settings send
# Actions failures. So this opens ONE issue on the first red run on `main` and
# comments on it on every later one. It NEVER closes it: on a day an advisory
# lands the registry serves it to some requests and not to others (`.debug/017`
# §2.6), so one green run is not a verdict. Whoever lands the fix closes it.
#
# Inputs, all from the workflow:
#   AUDIT_RESULT, TRIVY_RESULT  `needs.<job>.result` of the two gate jobs. Any
#                               value but `success` is reported — `failure`,
#                               `cancelled`, `skipped`, and EMPTY, which is how
#                               a job renamed without its `needs:` arrives. It
#                               fails closed.
#   GH_TOKEN                    the job's token: `issues: write`, and nothing
#                               else that writes.
#   GITHUB_*                    set by Actions.
#
# Exit status: 0 when the message was delivered, or there was none to deliver;
# non-zero when it could not be (a `gh` call failed). The gates' own red is on
# their own jobs, so a red report job means one thing only: the issue was not
# written.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

ISSUE_TITLE="Scheduled advisory check: main is red"

# Run anywhere else, this would write to the real repository with whatever
# `gh` credentials the shell holds. It is a workflow step and nothing more.
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  log_err "advisory-report.sh writes a GitHub issue: GitHub Actions only (GITHUB_ACTIONS is not 'true')"
  log_err "locally, run the gates themselves: bash scripts/ci/audit.sh && bash scripts/ci/trivy.sh"
  exit 1
fi

audit="${AUDIT_RESULT:-}"
trivy="${TRIVY_RESULT:-}"

if [[ "$audit" == "success" && "$trivy" == "success" ]]; then
  log_ok "both gates green on ${GITHUB_REF:-an unknown ref}: nothing to report"
  log_ok "an open issue stays open — one green run is not a verdict (.debug/017 §2.6)"
  exit 0
fi

# The issue's claim is "`main` is red". A dispatch on any other ref is someone
# looking at a branch, and the run's own red is already in front of them.
if [[ "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  log_warn "red on ${GITHUB_REF:-an unknown ref}, not refs/heads/main: no issue written (the run itself is red)"
  exit 0
fi

for name in GITHUB_REPOSITORY GITHUB_SERVER_URL GITHUB_RUN_ID GITHUB_SHA; do
  if [[ -z "${!name:-}" ]]; then
    log_err "$name is empty: cannot say which run is red"
    exit 1
  fi
done

# A result is one of a handful of words; anything else is shown as what it is
# not, rather than pasted into the issue.
shown() {
  if [[ -z "$1" ]]; then
    printf '(empty)'
  elif [[ "$1" =~ ^[a-z_]{1,20}$ ]]; then
    printf '%s' "$1"
  else
    printf '(unexpected value)'
  fi
}

run_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
body="$(
  printf '%s\n' \
    "The scheduled advisory check is red on \`main\` at ${GITHUB_SHA}: ${run_url}" \
    '' \
    '| Job | Script | Result |' \
    '| --- | --- | --- |' \
    "| \`npm audit (scheduled)\` | \`scripts/ci/audit.sh\` | $(shown "$audit") |" \
    "| \`trivy fs scan (scheduled)\` | \`scripts/ci/trivy.sh\` | $(shown "$trivy") |" \
    '' \
    'Both gates read a live advisory feed, so this goes red with nothing in the repository changed, and every pull request is red on the same required check until `main` is fixed (`.debug/017` §2.7). Fix first — the lowest release that clears the advisory, not the one `npm audit` proposes — and allow-list last (`CLAUDE.md`, "Environment"; `audit-ci-allowlist.md`).' \
    '' \
    'This workflow comments here on every red run on `main` and never closes this issue: on a day an advisory lands, one green run is not a verdict (`.debug/017` §2.6). Close it once the fix is on `main`.'
)"

# Matched on the exact title, over a listing rather than a search: the search
# index can lag a just-opened issue, and a lag here is a second issue.
listing="$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --limit 200 \
  --json number,title --jq '.[] | "\(.number)\t\(.title)"')"

number=""
while IFS=$'\t' read -r candidate title; do
  if [[ "$title" == "$ISSUE_TITLE" && "$candidate" =~ ^[0-9]+$ ]]; then
    number="$candidate"
    break
  fi
done <<<"$listing"

if [[ -n "$number" ]]; then
  gh issue comment "$number" --repo "$GITHUB_REPOSITORY" --body "$body"
  log_ok "commented on issue #${number}: ${ISSUE_TITLE}"
else
  gh issue create --repo "$GITHUB_REPOSITORY" --title "$ISSUE_TITLE" --body "$body"
  log_ok "opened an issue: ${ISSUE_TITLE}"
fi
