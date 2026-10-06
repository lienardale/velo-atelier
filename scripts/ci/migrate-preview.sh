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
# `prisma/migrations/**`, and by `gh workflow run migrate-preview.yml` by hand.
#
#   - `migrate deploy` only. Never `migrate dev`, never a seed, never
#     `ALLOW_REMOTE_SEED`: nothing outside the repository's own local scripts
#     writes rows into a Neon branch.
#   - `main` only. A `workflow_dispatch` takes a `--ref`, and any other ref
#     would apply ITS unmerged migrations to the branch every open PR reads.
#   - The DIRECT (unpooled) URL. Prisma's advisory migration lock and DDL do
#     not survive a transaction pooler (prisma.config.ts, lib/db/env.ts), so a
#     pooled endpoint is refused rather than attempted.
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
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

SECRET_NAME="NEON_PREVIEW_DIRECT_URL"
ENABLE_VAR="PREVIEW_MIGRATIONS_ENABLED"

# --- only `main` writes to the shared branch --------------------------------
#
# `gh workflow run migrate-preview.yml --ref <feature-branch>` checks that
# branch out and runs THIS script from it, against the one database every open
# PR's preview deployment reads. docs/deploy.md §1 and §4.5 always spell
# `--ref main`; this makes the documented form the only form. It fails rather
# than skipping: a dispatch is somebody asking for a migration, and answering
# one with silence is the failure this workflow exists to remove.
if [[ -n "${GITHUB_ACTIONS:-}" && "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  log_err "refusing to migrate \`preview\` from ${GITHUB_REF:-<no ref>} — only refs/heads/main may."
  log_err "An unmerged branch's prisma/migrations/** must not reach the shared preview database."
  log_err "Re-run it as: gh workflow run migrate-preview.yml --ref main"
  exit 1
fi

# --- the secret, and the switch that makes its absence an error -------------
#
# GitHub hands a step the EMPTY STRING for a secret that does not exist, so an
# empty value cannot be told apart from a deleted, renamed or org-scoped-away
# one. Left at that, the bootstrap skip would come back silently the day the
# secret went missing — the same green-and-quiet shape as the drift being
# fixed, one level up. So the maintainer sets a repository VARIABLE alongside
# the secret, and from then on an empty secret is a failure.
if [[ -z "${NEON_PREVIEW_DIRECT_URL:-}" ]]; then
  enabled="${PREVIEW_MIGRATIONS_ENABLED:-}"
  # Only `1` arms the switch. A plausible typo — `true`, `yes`, `on`, `TRUE` —
  # would otherwise fall through to the skip below and quietly restore the
  # green-and-silent drift this switch exists to remove, and it would do so the
  # day the secret goes missing, which is the one day nobody is looking. So an
  # unrecognised value fails now, while the maintainer is still at the keyboard.
  if [[ -n "$enabled" && "$enabled" != "1" ]]; then
    log_err "$ENABLE_VAR is set to '$enabled'; the only value that arms it is 1."
    log_err "Set it to 1, or clear it to go back to the bootstrap skip: docs/deploy.md §4.5."
    exit 1
  fi
  if [[ "$enabled" == "1" ]]; then
    log_err "$ENABLE_VAR is 1 but $SECRET_NAME is empty — \`preview\` was NOT migrated."
    log_err "The secret has been deleted, renamed, or scoped away from this repository."
    log_err "Re-add it (Settings → Secrets and variables → Actions), or clear $ENABLE_VAR if"
    log_err "the preview branch is deliberately no longer migrated: docs/deploy.md §4.5."
    exit 1
  fi
  skip_step "$SECRET_NAME is not set — the Neon \`preview\` branch was NOT migrated.
   Add the repository secret (Settings → Secrets and variables → Actions) with the
   DIRECT connection string of the Neon \`preview\` branch, after rotating that
   branch's password, and set the repository variable $ENABLE_VAR=1 in the same
   sitting — that turns this skip into a failure for ever after: docs/deploy.md
   §4.5. Until then, migrate it by hand (§1)."
fi

# Prisma reads the URL through prisma.config.ts -> readDatabaseUrls().direct,
# which is POSTGRES_URL_NON_POOLING (or Neon's own DATABASE_URL_UNPOOLED).
# There is deliberately no fallback from direct to pooled, so this one name is
# all `migrate deploy` needs.
export POSTGRES_URL_NON_POOLING="$NEON_PREVIEW_DIRECT_URL"

# Which database, never the credentials — and never the whole endpoint either.
# This log is PUBLIC (so is the repository) and `$GITHUB_STEP_SUMMARY` more so.
# A Neon endpoint reads `ep-<two words>-<id>`, and the two words are all that
# tells production from preview apart: `.debug/016` §3 prints exactly
# `ep-quiet-river-…` / `ep-plain-block-…`, for this reason. The rest of the
# host only helps a stranger address it.
#
# Truncating THIS line is not enough, and the first version of it published the
# host regardless: `migrate deploy` announces its own datasource on the very
# next line — `Datasource "db": PostgreSQL database "neondb", schema "public"
# at "<the whole host>"` — and names it again in a P1001. Measured, not
# reasoned about. So Prisma's output is filtered below, and the test that guards
# this log runs the real command rather than stopping at a refusal.
#
# The pooled test runs on the FULL hostname, inside node, because `-pooler`
# sits past the truncation.
#
# `new URL()` alone is too generous: `foo:bar` parses, yields an empty
# hostname, and would have this log say `prisma migrate deploy → bar` before
# Prisma refused it with P1013. It fails closed either way, but a log line
# naming a database that was never contacted is worse than no log line — so a
# URL with no host is rejected here, by name.
#
# The charset assertion is what makes that filter a literal match rather than an
# arbitrary `sed` program assembled out of a secret: a hostname is
# `[A-Za-z0-9.-]`, which holds no `sed` metacharacter once the dots are escaped.
if ! probe="$(node -e '
  const url = new URL(process.env.POSTGRES_URL_NON_POOLING);
  const host = url.hostname;
  if (!host) throw new Error("no host");
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new Error("not a hostname");
  const shown = host.length > 14 ? host.slice(0, 14) + "…" : host;
  const kind = host.includes("-pooler.") ? "pooled" : "direct";
  process.stdout.write([kind, shown + url.pathname, host, shown].join("\n") + "\n");
' 2>/dev/null)"; then
  log_err "$SECRET_NAME is not a connection URL with a host"
  exit 1
fi

{
  read -r kind
  read -r endpoint
  read -r full_host
  read -r shown_host
} <<<"$probe"

if [[ "$kind" == "pooled" ]]; then
  log_err "$SECRET_NAME is a POOLED Neon endpoint ($endpoint) — migrations need the DIRECT one."
  log_err "DDL and Prisma's advisory migration lock do not survive a transaction pooler."
  log_err "Neon console → branch \`preview\` → Connection details → uncheck the pooled connection."
  exit 1
fi

log_step "prisma migrate deploy → $endpoint"

# Prisma's own output, with the one host it prints replaced by the same two
# words logged above. `2>&1` because the host reaches both streams (the
# datasource line and a P1001), and `pipefail` — `set -euo pipefail` in
# `_lib.sh` — is what keeps a failed migration red THROUGH the pipe, which is
# the half of this that a careless tidy-up would break silently.
npx --no-install prisma migrate deploy 2>&1 | sed "s/${full_host//./\\.}/$shown_host/g"

summary "\`prisma migrate deploy\` applied to the Neon \`preview\` branch (\`$endpoint\`)."
log_ok "preview branch migrated"
