#!/usr/bin/env bash
# Strict typecheck.
#
# Three parts, in dependency order:
#   1. `prisma generate` — `lib/generated/prisma` is gitignored, so on a clean
#      checkout nothing that imports the client type-checks until it is emitted.
#   2. `tsc --noEmit` — the gate.
#   3. `domain:check` — the pure-domain Vitest project. It runs here (and not
#      only in the `unit` job) because a broken domain invariant is a type-level
#      mistake in practice and this job is the fastest place to catch it.
#
# Parts 1 and 3 warn-and-skip while their inputs do not exist yet (prisma is
# W0-T4, the domain module is W1-T1). `tsc` always runs.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

if [[ -f prisma/schema.prisma ]]; then
  log_step "prisma generate"
  npx --no-install prisma generate
else
  log_warn "prisma/schema.prisma not present yet (W0-T4) — skipping 'prisma generate'"
fi

if [[ -f content-collections.ts ]]; then
  # `import … from "content-collections"` resolves to the gitignored
  # .content-collections/generated tree. A fresh CI checkout has none, so tsc
  # failed there while passing locally on a tree a previous build had generated.
  log_step "content-collections build"
  npx --no-install content-collections build
fi

# Exactly the same trap as the line above, one directory over: `prisma/seed.ts`
# imports `lib/content/generated/{slugs,reason-keys}`, which `content-check
# --emit` writes and `.gitignore` excludes. A fresh CI checkout has none, so tsc
# failed on CI while passing locally on files an earlier build had left behind
# (W2 integration, 2026-09-18 — it took down typecheck, integration and build).
if [[ -f scripts/content-check.ts && -d content/guides ]]; then
  log_step "content-check --emit"
  npx --no-install tsx scripts/content-check.ts --emit
fi

log_step "tsc --noEmit"
npx --no-install tsc --noEmit

if [[ -f vitest.config.ts && -d tests/unit/domain ]]; then
  log_step "domain:check"
  npx --no-install vitest run --project unit tests/unit/domain --passWithNoTests
else
  log_warn "vitest.config.ts or tests/unit/domain not present yet — skipping 'domain:check'"
fi

log_ok "typecheck passed"
