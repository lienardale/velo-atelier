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

| #   | Date       | Subject                                                                                   | Status   |
| --- | ---------- | ----------------------------------------------------------------------------------------- | -------- |
| 001 | 2026-09-12 | W0 scaffold: registry reality vs the plan's pins; W0 integration                          | resolved |
| 002 | 2026-09-09 | Prisma 7 + Turbopack: observed CLI flags and the init migration                           | resolved |
| 003 | 2026-09-13 | W1: five auth bugs, the sessionVersion contradiction, sub-agent stalls                    | resolved |
| 004 | 2026-09-17 | W2: the test-hooks gate that shipped, `--strict` wired, callout legends                   | resolved |
| 005 | 2026-09-17 | `Input.synthesizeScrollGesture` fires no `touchmove` on CI's Linux Chromium               | resolved |
| 006 | 2026-09-18 | `/velo/[id]`: static params vs the session, `loading.tsx` vs 404s, `"use server"` exports | resolved |
| 007 | 2026-09-17 | Home LCP: a re-created element, and 54 drawings in the RSC payload                        | resolved |
