#!/usr/bin/env bash
# Content gate: every guide's frontmatter is valid, FR and EN agree, every
# partId / guideSlug / reasonKey it references exists.
#
#   1. `scripts/content-check.ts --strict` — the validator. `--strict` adds the
#      corpus-level rules (§5.1 ★): every rendered part covered by a check step,
#      40-word check questions, safety entries on e-bike and brake guides,
#      brands.yaml. On since the W2-T4 corpus landed.
#   2. `content-collections build` — compiles the MDX. Skipped until
#      `content-collections.ts` exists (W1-T4).
#   3. `gen-tree-drawings --check` — `public/tree-drawings.json` is the decision
#      tree's drawings rendered to markup (.debug/005). It is committed, not
#      gitignored, because the `lighthouse` and `e2e` jobs restore only `.next/`
#      from the build artifact and `next start` serves `public/` from the
#      checkout; a stale file would ship yesterday's drawings, so it is checked
#      here rather than trusted.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

if [[ ! -f scripts/content-check.ts ]]; then
  skip_step "scripts/content-check.ts does not exist yet (W1-T4)"
fi

log_step "content-check --strict"
npx --no-install tsx scripts/content-check.ts --strict

if [[ -f content-collections.ts ]]; then
  log_step "content-collections build"
  npm run content:build
else
  log_warn "content-collections.ts not present yet (W1-T4) — skipping 'content:build'"
fi

log_step "gen-tree-drawings --check"
npx --no-install tsx scripts/gen-tree-drawings.ts --check

log_ok "content passed"
