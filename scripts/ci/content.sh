#!/usr/bin/env bash
# Content gate: every guide's frontmatter is valid, FR and EN agree, every
# partId / guideSlug / reasonKey it references exists.
#
#   1. `scripts/content-check.ts` — the validator (a W0 stub that exits 0 while
#      `content/` is absent; W1-T4 implements it, W2-T4 turns on `--strict`).
#   2. `content-collections build` — compiles the MDX. Skipped until
#      `content-collections.ts` exists (W1-T4).
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

if [[ ! -f scripts/content-check.ts ]]; then
  skip_step "scripts/content-check.ts does not exist yet (W1-T4)"
fi

log_step "content-check"
npx --no-install tsx scripts/content-check.ts

if [[ -f content-collections.ts ]]; then
  log_step "content-collections build"
  npm run content:build
else
  log_warn "content-collections.ts not present yet (W1-T4) — skipping 'content:build'"
fi

log_ok "content passed"
