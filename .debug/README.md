# Debug notes

Non-obvious findings — a framework bug, a surprising build behaviour, a fix
whose reason is not visible from the diff — are written down here so the next
person (or the next session) does not rediscover them.

## Conventions

- One file per investigation: `NNN-short-description-YYYY-MM-DD.md`, `NNN`
  zero-padded and monotonically increasing.
- Structure: **Symptom** → **Investigation** → **Root cause** → **Fix** →
  **How to detect a regression** (ideally a test path).
- Add the entry and its row in the table below **in the same commit as the fix**.
- This directory is committed; it is excluded from the Vercel build through
  `.vercelignore`.

## Index

Every note in this directory, in number order; the number links to the note.

| #                                                    | Date       | Subject                                                                                          | Status   |
| ---------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ | -------- |
| [001](./001-scaffold-2026-09-12.md)                  | 2026-09-12 | W0 scaffold: registry reality vs the plan's pins; W0 integration                                 | resolved |
| [002](./002-prisma-2026-09-09.md)                    | 2026-09-09 | Prisma 7 + Turbopack: observed CLI flags and the init migration                                  | resolved |
| [003](./003-wave-1-2026-09-13.md)                    | 2026-09-13 | W1: five auth bugs, the sessionVersion contradiction, sub-agent stalls                           | resolved |
| [004](./004-wave-2-2026-09-17.md)                    | 2026-09-17 | W2: the test-hooks gate that shipped, `--strict` wired, callout legends                          | resolved |
| [005](./005-touch-scroll-ci-2026-09-17.md)           | 2026-09-17 | `Input.synthesizeScrollGesture` fires no `touchmove` on CI's Linux Chromium                      | resolved |
| [006](./006-velo-routes-2026-09-18.md)               | 2026-09-18 | `/velo/[id]`: static params vs the session, `loading.tsx` vs 404s, `"use server"` exports        | resolved |
| [007](./007-home-lcp-payload-2026-09-17.md)          | 2026-09-17 | Home LCP: a re-created element, and 54 drawings in the RSC payload                               | resolved |
| [008](./008-client-message-namespaces-2026-09-18.md) | 2026-09-18 | The whole message catalogue on every page — and why trimming it is not the home TBT              | resolved |
| [009](./009-w2-closeout-2026-09-18.md)               | 2026-09-18 | W2 closeout: two 5 s unit timeouts, and the bundle guard `ci:local` never asserted               | resolved |
| [010](./010-wave-3-2026-09-20.md)                    | 2026-09-20 | W3: a contract that moved under a sibling, `recheck-ok` that never fired, GFM in the legal pages | resolved |
| [011](./011-home-tbt-tree-hydration-2026-09-21.md)   | 2026-09-21 | Home TBT: the decision tree was built on the client, not hydrated                                | resolved |
