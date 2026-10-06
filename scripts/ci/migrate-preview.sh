#!/usr/bin/env bash
# Apply Prisma migrations to the shared Neon `preview` branch.
#
# `scripts/vercel-build.sh` runs `prisma migrate deploy` ONLY when
# `VERCEL_ENV=production` — deliberately: every preview deployment shares one
# Neon branch, and a preview that migrated would rewrite the schema under every
# other open PR (tests/unit/deploy/migrate-on-deploy.test.ts pins that). The
# consequence nobody had drawn is that then NOTHING migrates `preview`. W5
# branched it from an empty `production`, production was migrated later and
# alone, and six days on the preview branch still had no `_prisma_migrations`
# table — while `/api/health` (a bare `SELECT 1`) and `/velo/demo` (code-backed)
# both answered 200 (`.debug/016` §3).
#
# So one writer, once per landed migration: this script, called by
# .github/workflows/migrate-preview.yml on a push to `main` that touches
# `prisma/migrations/**`, and by `gh workflow run migrate-preview.yml --ref main`
# by hand — which is also the bootstrap. ("Once per landed migration" has a
# hole, spelled out in the workflow's header: per GitHub's documentation, not
# observed, a push of more than 300 changed files can start no run at all, and
# the dispatch is then the only writer.) Nothing here asks for the connection
# string on a command line, and nothing should: a string that has been in a
# shell's history is not a secret any more (docs/deploy.md §4.5).
#
#   - `migrate deploy` only. Never `migrate dev`, never a seed, never
#     `ALLOW_REMOTE_SEED`: nothing outside the repository's own local scripts
#     writes rows into a Neon branch.
#   - `main` only — as far as a script can say so. A `workflow_dispatch` takes
#     a `--ref`, and any other ref would apply ITS unmerged migrations to the
#     branch every open PR reads. But a dispatch runs the script of the ref it
#     names, so this rule is enforced by that ref's OWN copy of this file: it
#     stops an accidental `--ref`, not a branch that edits the script.
#   - The DIRECT (unpooled) URL. Prisma's advisory migration lock and DDL do
#     not survive a transaction pooler (prisma.config.ts, lib/db/env.ts), so a
#     pooled endpoint is refused rather than attempted.
#   - The PREVIEW endpoint, asserted before anything is contacted. Production
#     lives in the same Neon project, one branch selector away in the console,
#     and its string is shaped exactly like this one. The first version of
#     this script compared the host with nothing: given a production-shaped
#     host it went straight on to `migrate deploy` and, when that answered 0,
#     finished green under a summary that said `preview` (measured in review,
#     2026-10-06 — on a `.invalid` host and a stand-in `npx`, no database).
#   - A database that ALREADY EXISTS — checked after the run, because nothing
#     here knows its name before it. `migrate deploy` creates a database that
#     is missing and then migrates it: a secret with the right host and a
#     wrong path ended green, with the database the previews read untouched
#     (measured, 2026-10-06; the block after the pipe below says on what). A
#     preview migration never has a database to create, so Prisma saying it
#     created one is a failed run. The NAME itself is not asserted — that
#     would take a fourth input — so a path naming ANOTHER database that
#     already exists on the endpoint is still migrated, green: the
#     `→ <host>/<name>` line is the only tell.
#   - No secret, no failure — but only until the bootstrap is done. The
#     repository secret is added by hand after the preview branch's password
#     is rotated, so until it exists this skips instead of painting `main` red
#     (docs/deploy.md §4.5). The repository VARIABLE below is what stops that
#     grace period lasting for ever.
#
# Env:
#   NEON_PREVIEW_DIRECT_URL     the direct connection string of the Neon
#                               `preview` branch (repository SECRET).
#   PREVIEW_MIGRATIONS_ENABLED  "1" once that secret exists (repository
#                               VARIABLE).
#   NEON_PREVIEW_ENDPOINT       the name of the preview branch's endpoint
#                               without its id, e.g. `ep-plain-block`
#                               (repository VARIABLE — `.debug/016` §3 already
#                               publishes it, so it is not a secret).
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

SECRET_NAME="NEON_PREVIEW_DIRECT_URL"
ENABLE_VAR="PREVIEW_MIGRATIONS_ENABLED"
ENDPOINT_VAR="NEON_PREVIEW_ENDPOINT"
DISPATCH="gh workflow run migrate-preview.yml --ref main"
VARIABLES_UI="Settings → Secrets and variables → Actions → Variables"

# --- only `main` writes to the shared branch --------------------------------
#
# `gh workflow run migrate-preview.yml --ref <feature-branch>` checks that
# branch out and runs THIS script from it, against the one database every open
# PR's preview deployment reads. docs/deploy.md §1 and §4.5 always spell
# `--ref main`, and this refuses the other spellings. It fails rather than
# skipping: a dispatch is somebody asking for a migration, and answering one
# with silence is the failure this workflow exists to remove.
#
# What it is worth, exactly: the guard is whatever the DISPATCHED ref's copy of
# this file says it is, and the repository secret is handed to that run either
# way. So it catches the mistake (a `--ref` that should have been `main`) and
# not the edit (a branch that changed these lines). A GitHub Environment
# restricted to `main`, holding the secret, is what would make "main only"
# GitHub's rule instead of this script's; it is not set up. Outside Actions
# there is no ref to read and the guard says nothing, which is what lets the
# unit tier execute every other refusal below.
if [[ -n "${GITHUB_ACTIONS:-}" && "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  log_err "refusing to migrate \`preview\` from ${GITHUB_REF:-<no ref>} — only refs/heads/main may."
  log_err "An unmerged branch's prisma/migrations/** must not reach the shared preview database."
  log_err "Re-run it as: $DISPATCH"
  exit 1
fi

# --- the switch, read on EVERY run ------------------------------------------
#
# Only `1` arms it. A plausible typo — `true`, `yes`, `on`, `TRUE` — reads as
# "enabled" to a human and as "unset" to a `== "1"` compare.
#
# This check used to sit inside the empty-secret branch below, which made its
# own comment false: the documented bootstrap sets the secret and the variable
# in one sitting, so at the keyboard the secret was never empty and the switch
# was never looked at. Measured in review (2026-10-06) with the secret present:
# `true`, `0` and an unset variable all went on to `migrate deploy`, green, and
# said nothing. The typo then surfaced only on the day the secret went missing
# — the one day nobody is looking.
#
# The value is echoed back only when it is a short word. This log is public,
# and every other value this script prints is cut or held to a charset; this
# one was printed verbatim, and a variable is a field somebody pastes into.
# Measured in review (2026-10-06, stand-in `npx`): a switch holding a pasted
# connection URL came back whole, password included. `true`, `yes`, `on`, `0`
# — the typos this message is for — are letters and digits, eight at most;
# anything else is reported by its length.
enabled="${PREVIEW_MIGRATIONS_ENABLED:-}"
if [[ -n "$enabled" && "$enabled" != "1" ]]; then
  if [[ "$enabled" =~ ^[A-Za-z0-9]{1,8}$ ]]; then
    shown_enabled="'$enabled'"
  else
    shown_enabled="a value of ${#enabled} characters, not shown here"
  fi
  log_err "$ENABLE_VAR is set to $shown_enabled; the only value that arms it is 1."
  log_err "Set it to 1 ($VARIABLES_UI) — or clear it, if"
  log_err "$SECRET_NAME has not been added yet: docs/deploy.md §4.5."
  exit 1
fi

# --- the secret, and what its absence means ---------------------------------
#
# GitHub hands a step the EMPTY STRING for a secret that does not exist, so an
# empty value cannot be told apart from a deleted, renamed or org-scoped-away
# one. Left at that, the bootstrap skip would come back silently the day the
# secret went missing — the same green-and-quiet shape as the drift being
# fixed, one level up. So the maintainer sets a repository VARIABLE alongside
# the secret, and from then on an empty secret is a failure.
if [[ -z "${NEON_PREVIEW_DIRECT_URL:-}" ]]; then
  if [[ "$enabled" == "1" ]]; then
    log_err "$ENABLE_VAR is 1 but $SECRET_NAME is empty — \`preview\` was NOT migrated."
    log_err "The secret has been deleted, renamed, or scoped away from this repository."
    log_err "Re-add it (Settings → Secrets and variables → Actions), or clear $ENABLE_VAR if"
    log_err "the preview branch is deliberately no longer migrated: docs/deploy.md §4.5."
    exit 1
  fi
  # The one green way out, and only for the bootstrap: neither the secret nor
  # the switch has ever been set. It points at the dispatch and at nothing
  # else — the message this replaced ended "migrate it by hand (§1)", i.e. sent
  # the reader to a command with the connection string inline.
  skip_step "$SECRET_NAME is not set — the Neon \`preview\` branch was NOT migrated.
   Bootstrap, in one sitting (docs/deploy.md §4.5): rotate the \`preview\` branch's
   password in the Neon console; add the repository secret $SECRET_NAME (that
   branch's DIRECT connection string) and the repository variables $ENABLE_VAR=1
   and $ENDPOINT_VAR=<the endpoint's name, without its id>; then run
     $DISPATCH
   That dispatch IS the first migration. The string goes into the secret store and
   nowhere else — never onto a command line."
fi

# The other half of the pair. The secret is here; if the switch is not, the
# grace period above is still open and nobody knows: this run would migrate,
# green, and the day the secret disappeared the job would go straight back to
# the skip. "Set both in the same sitting" is only a rule if forgetting one of
# them is red.
if [[ "$enabled" != "1" ]]; then
  log_err "$SECRET_NAME is set but $ENABLE_VAR is not 1 — \`preview\` was NOT migrated."
  log_err "The bootstrap's grace period was never ended: with the switch unset, a secret that is"
  log_err "later deleted or renamed puts this job back to a green skip that migrates nothing."
  log_err "Set the repository variable $ENABLE_VAR to 1"
  log_err "($VARIABLES_UI), then:"
  log_err "  $DISPATCH"
  exit 1
fi

# --- which database: the endpoint is asserted, not assumed ------------------
#
# Fails CLOSED. A secret with no endpoint to hold it to is the first version of
# this script again, and an unset variable is exactly what a misspelt variable
# NAME looks like from in here.
#
# What the variable holds, and where to read it — said by both refusals that
# send somebody off to set it. The assertion is only worth the independence of
# its two sides: read off the same Connection details panel as the string, a
# branch selector left on `production` yields a secret and a variable that
# agree with each other, and production's endpoint passes. So the value comes
# from somewhere that selector cannot reach.
endpoint_value_hint() {
  log_err "$ENDPOINT_VAR is the first label of the \`preview\` host without its trailing -<id>"
  log_err "(ep-<word>-<word>). Read it from docs/deploy.md §4.5 or .debug/016 §3 (or the Neon console's"
  log_err "branch list) — never from the panel the connection string is copied from, where a branch"
  log_err "selector left on the wrong branch agrees with itself."
}

expected_endpoint="${NEON_PREVIEW_ENDPOINT:-}"
if [[ -z "$expected_endpoint" ]]; then
  log_err "$ENDPOINT_VAR is empty — refusing to migrate a database nothing has identified."
  log_err "Nothing was contacted. Set that repository variable"
  log_err "($VARIABLES_UI): docs/deploy.md §4.5."
  endpoint_value_hint
  exit 1
fi
# The value is compared as a literal and echoed back (cut short) on a mismatch,
# so it is held to a hostname's alphabet like the host itself, further down.
if [[ ! "$expected_endpoint" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]]; then
  log_err "$ENDPOINT_VAR is not an endpoint name: letters, digits, '-' and '.' only,"
  log_err "with no space and no scheme (ep-<word>-<word>): docs/deploy.md §4.5."
  exit 1
fi

# Prisma reads the URL through prisma.config.ts -> readDatabaseUrls().direct,
# which is POSTGRES_URL_NON_POOLING (or Neon's own DATABASE_URL_UNPOOLED).
# There is deliberately no fallback from direct to pooled, so this one name is
# all `migrate deploy` needs.
export POSTGRES_URL_NON_POOLING="$NEON_PREVIEW_DIRECT_URL"

# Which database, never the credentials — and never the whole endpoint either.
# This log is PUBLIC (so is the repository) and `$GITHUB_STEP_SUMMARY` more so.
# What is shown is the first 14 CHARACTERS of the host. That is "the two words
# of the endpoint" only because both of this project's endpoints happen to be
# `ep-` + 5 + 5 letters — `.debug/016` §3 prints exactly `ep-quiet-river-…` /
# `ep-plain-block-…` — and on an endpoint named otherwise the cut lands inside
# a word or three characters into the id (measured in review: `ep-shy-sun-a1b…`,
# `ep-delicate-bu…`). The rest of the host only helps a stranger address it.
#
# Truncating THIS line is not enough, and the first version of it published the
# host regardless: `migrate deploy` announces its own datasource on the very
# next line — `Datasource "db": PostgreSQL database "neondb", schema "public"
# at "<the whole host>"` — and names it again in a P1001. Measured, not
# reasoned about. So Prisma's output is filtered below, and the test that guards
# this log runs the real command rather than stopping at a refusal.
#
# The probe answers one question — is this string a connection URL whose host
# is the one Prisma will dial? — and anything else gets ONE generic message that
# prints nothing from the value. Its rules, each for a string that was measured
# getting through without it:
#
#   - `new URL()` alone is too generous: `foo:bar` parses, yields an empty
#     hostname, and had this log say `prisma migrate deploy → bar` before
#     Prisma refused it with P1013. A log line naming a database that was never
#     contacted is worse than no log line.
#   - Exactly one `@` in the raw string, a username, and a path that is a bare
#     database name. A password holding an unencoded `@` or `/` moves the
#     authority: `…:abc@x.invalid/REST@<real host>/neondb` parses with host
#     `x.invalid` and path `/REST@<real host>/neondb`, and this script then
#     logged the rest of the password and the whole endpoint — as did Prisma,
#     as the database name. A correctly encoded URL has one raw `@`. The
#     password itself is never decoded or looked at: `url.password` stays
#     percent-encoded, and a valid one may well contain `%40` or `%2F`.
#   - No `host` query parameter. Prisma honours a libpq-style `?host=` OVER the
#     URL's host (measured on 7.10.0: `Datasource … at "first-host.invalid"`,
#     then `P1001: Can't reach database server at second-host.invalid:5432`),
#     so with one the endpoint asserted below and the endpoint dialled would be
#     two different things. `hostaddr` was tried the same way and is ignored.
#   - The hostname's charset is what makes the redaction filter a literal match
#     rather than an arbitrary `sed` program assembled out of a secret:
#     `[A-Za-z0-9.-]` holds no `sed` metacharacter once the dots are escaped.
#
# Then the two things only the FULL hostname can say, compared in lower case
# (`postgresql:` is not a special scheme, so `new URL()` keeps the host as it
# was typed, and `-POOLER.` used to pass as direct):
#
#   - It is the preview endpoint: the host IS $ENDPOINT_VAR, or continues it
#     with `.` (the variable holds a whole label), or with `-` (the variable is
#     the endpoint's name and the id follows). The `-` form is only accepted
#     from a value shaped `ep-<word>-<word>`: a bare `ep` continued by `-`
#     would match production's endpoint as well as preview's.
#   - It is not the pooled one: `-pooler` sits past the truncation.
#
# `2>/dev/null` stays although the probe catches everything itself. Node's
# uncaught `ERR_INVALID_URL` prints the WHOLE input — password included — and
# for a value holding a quote, a backslash or a newline GitHub's exact-match
# masking would not recognise it. One guard for that was one too few.
if ! probe="$(node -e '
  try {
    const raw = process.env.POSTGRES_URL_NON_POOLING;
    const url = new URL(raw);
    const host = url.hostname;
    const wellFormed =
      raw.split("@").length === 2 &&
      url.username !== "" &&
      /^[A-Za-z0-9.-]+$/.test(host) &&
      /^\/[A-Za-z0-9_-]+$/.test(url.pathname) &&
      ![...url.searchParams.keys()].some((key) => key.toLowerCase() === "host");
    if (!wellFormed) process.exit(1);

    const cut = (name) => (name.length > 14 ? name.slice(0, 14) + "…" : name);
    const lower = host.toLowerCase();
    const want = process.env.NEON_PREVIEW_ENDPOINT.toLowerCase();
    const namesAnEndpoint = /^ep-[a-z0-9]+-[a-z0-9]+/.test(want);
    const isPreview =
      lower === want ||
      lower.startsWith(want + ".") ||
      (namesAnEndpoint && lower.startsWith(want + "-"));
    const kind = !isPreview ? "mismatch" : lower.includes("-pooler.") ? "pooled" : "direct";
    const label = host.split(".")[0];
    const longLabel = label.length > 14 ? label : "";
    const cuts = cut(lower) === cut(want) ? "same" : "differ";

    const lines = [kind, cut(host) + url.pathname, host, cut(host), cut(want), cuts, longLabel];
    process.stdout.write(lines.join("\n") + "\n");
  } catch {
    process.exit(1);
  }
' 2>/dev/null)"; then
  log_err "$SECRET_NAME is not a connection URL with a host"
  exit 1
fi

{
  read -r kind
  read -r endpoint
  read -r full_host
  read -r shown_host
  read -r shown_expected
  read -r cuts
  read -r long_label || true
} <<<"$probe"

# Before the pooled test, and before anything is logged as a destination: the
# wrong DATABASE is the worse of the two mistakes. Both sides are cut to the
# same 14 characters — the variable may legitimately hold the whole host.
#
# Which means the two lines can come out IDENTICAL, under a message that says
# they disagree. Measured in review (2026-10-06, stand-in `npx`): the variable
# holding the whole direct host and the secret the pooled string, or the name
# with its id against an endpoint since recreated, both printed
# `ep-plain-block…` twice. The probe compares the two cuts — in lower case,
# like the hosts — and when they are the same the message says where the
# difference has to be, since it cannot show it.
if [[ "$kind" == "mismatch" ]]; then
  log_err "$SECRET_NAME is not the preview endpoint — \`preview\` was NOT migrated."
  log_err "Nothing was contacted."
  log_err "  the secret's host starts:  $shown_host"
  log_err "  $ENDPOINT_VAR says:  $shown_expected"
  if [[ "$cuts" == "same" ]]; then
    log_err "Those two agree as far as this log shows them: the difference is past the 14th character —"
    log_err "the endpoint's id, or a \`-pooler\` that only one of them carries."
  fi
  log_err "If the secret holds another branch's string (production's is one branch selector away in"
  log_err "the Neon console), replace it. If the preview endpoint was recreated, or the variable is"
  log_err "not the endpoint's name (ep-<word>-<word>), correct the variable: docs/deploy.md §4.5."
  endpoint_value_hint
  exit 1
fi

if [[ "$kind" == "pooled" ]]; then
  log_err "$SECRET_NAME is a POOLED Neon endpoint ($endpoint) — migrations need the DIRECT one."
  log_err "DDL and Prisma's advisory migration lock do not survive a transaction pooler."
  log_err "Neon console → branch \`preview\` → Connection details → uncheck the pooled connection."
  exit 1
fi

log_step "prisma migrate deploy → $endpoint"

# Prisma's own output, with the host it prints replaced by the same 14
# characters logged above. `2>&1` because the host reaches both streams (the
# datasource line and a P1001), and `pipefail` — `set -euo pipefail` in
# `_lib.sh` — is what keeps a failed migration red THROUGH the pipe, which is
# the half of this that a careless tidy-up would break silently.
#
# The second expression covers the host's first label on its own — the
# endpoint's name and id, without the domain — when it is long enough to have
# been cut. Prisma relays a server's error text verbatim (`Error: Schema engine
# error: FATAL: …`, measured in review against a loopback stand-in), and that
# text is the server's to word. Whether Neon's proxy ever names an endpoint
# that way was not observed; everything else a server sends is passed through
# as it is.
redact=(-e "s/${full_host//./\\.}/$shown_host/g")
if [[ -n "$long_label" ]]; then
  redact+=(-e "s/$long_label/$shown_host/g")
fi

# `tee` keeps the ALREADY-redacted stream for the job summary: what is public
# there is, byte for byte, what is public in the log above it.
prisma_output="$(mktemp)"
trap 'rm -f "$prisma_output"' EXIT

npx --no-install prisma migrate deploy 2>&1 | sed "${redact[@]}" | tee "$prisma_output"

# --- the database must not have been CREATED by this run --------------------
#
# The endpoint was asserted above; the database NAME was not, and Prisma does
# not need it to exist: `migrate deploy` first makes sure the database is
# there, and creates it when the server says it is not. Measured on the pinned
# 7.10.0 against the local test server (2026-10-06), with this script as it
# was before this block and the secret's path changed to a name that did not
# exist. Prisma printed
#
#   PostgreSQL database velo_atelier_w5stray41_test created at localhost:5432
#
# applied all three migrations to the new database and exited 0, and the
# script wrote its green summary. That is the green-and-unmigrated shape this
# workflow exists to remove, one typo away: the database the previews read was
# never touched. (On Neon it takes a role with CREATEDB, which the review read
# Neon's documentation as giving every role created in the console. Not
# observed.)
#
# So a run in which Prisma says it created a database is a FAILED run. After
# the fact, because before it nothing here knows the name — asserting it would
# take a fourth input. And on that line alone, because `preview` never has a
# database to create: there is no run in which the line is expected.
#
# The match is Prisma's wording, and only as good as that wording:
# `<provider> database <name> created`, with ` at <host>:<port>` after it — the
# `sed` above has already cut that host. Read in
# node_modules/prisma/build/cli.js as well as printed by the run above. A
# stand-in `npx` would go on printing the old line through a Prisma upgrade
# that reworded it, so tests/integration/migrate-preview.test.ts runs the real
# Prisma into a database that does not exist.
#
# Two things this does not do. It does not catch a path that names ANOTHER
# database which already exists on the endpoint: Prisma creates nothing,
# migrates it, and the run is green — the `→ <host>/<name>` line above is the
# only tell. And it says nothing after a run that created a database and then
# FAILED: `pipefail` has already ended that one, red, with Prisma's `created`
# line in its log. No summary is written here either: only a green run has one.
if grep -Eq 'PostgreSQL database( [^ ]+)? created' "$prisma_output"; then
  log_err "Prisma CREATED the database '${endpoint#*/}' — the database the previews read was NOT migrated."
  log_err "The path at the end of $SECRET_NAME names a database that did not exist on the"
  log_err "preview endpoint. \`migrate deploy\` created it and applied every migration to it, which is"
  log_err "why Prisma reports a success above; the database the previews read was not touched."
  log_err "Correct the database name in the secret (docs/deploy.md §4.5, step 3), drop the stray"
  log_err "database '${endpoint#*/}' in the Neon console, then: $DISPATCH"
  exit 1
fi

# The summary says what happened and lets Prisma say the rest. The sentence it
# replaces read "applied to the Neon `preview` branch" on every green run —
# including one where Prisma had just printed "No pending migrations to apply",
# and including one against production's endpoint. Written straight to the file
# rather than through `summary`, which echoes when there is no file: locally
# these lines were printed a moment ago.
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '`prisma migrate deploy` exited 0 on `%s`, ' "$endpoint"
    printf 'the endpoint `%s` names. ' "$ENDPOINT_VAR"
    printf 'What Prisma printed, host cut to its first 14 characters:\n\n```text\n'
    cat "$prisma_output"
    printf '```\n'
  } >>"$GITHUB_STEP_SUMMARY"
fi
log_ok "prisma migrate deploy exited 0 on $endpoint"
