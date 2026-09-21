<!--
Keep this template. The checkboxes are the ones CI cannot check for you.
-->

## What and why

<!-- One paragraph. What changes for the person using the site? -->

Closes #

## How to verify

<!-- The commands or the click-path a reviewer should follow. -->

```bash
npm run ci:local
```

## Checklist

- [ ] `npm run ci:local` is green locally (or I say below which step is red and why).
- [ ] Tests cover the new behaviour — not only the happy path.
- [ ] Every new user-facing string exists in **both** `messages/fr/` and
      `messages/en/`, with the same ICU placeholders.
- [ ] New content (`content/**`) is written in **French first** and has its
      English translation.
- [ ] No secret, no personal email, no production URL in the diff.
- [ ] `CLAUDE.md` / `README.md` updated in this same commit if an architecture,
      a script or an ownership boundary changed.

## Labels this PR may need

- [ ] **`visual-baseline`** — this PR touches `tests/e2e/__screenshots__/**`.
      The baselines come from CI's `update-snapshots` job (`perf.yml`,
      `update_snapshots=true`), never from a local run, and I looked at every image.
      _The `visual-baseline-guard` check fails without this label._
- [ ] **`perf-verified`** — **required** when this PR touches `lib/bike3d/**` or
      `components/bike3d/**`: the label goes on only after this box is true.
      On an idle machine, after `ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash scripts/ci/build.sh`,
      I ran `RUN_LOCAL_PERF=1 npm run perf:local` on a real GPU (CI renders
      through SwiftShader and cannot answer this): the renderer is not
      SwiftShader and the p95 frame cost is ≤ 16.7 ms on **all 7 presets**, and
      I committed the run file it wrote.
      Report: `.perf/local-<YYYY-MM-DD>.json` → <!-- the committed path, or paste the seven p95 values -->
      How to run it and read it: `docs/bike3d-perf.md` (the local GPU run, and
      the real-device checklist for interaction or loading changes).

## Budgets

<!-- Fill in only if this PR could move them. The `build` job prints the table. -->

- First-load JS (home): … KiB gzip (the table prints KiB) — budget in `perf.budgets.json`
- Draw calls / triangles, if the 3D scene changed: …

## Anything a reviewer should push back on

<!-- Shortcuts taken, alternatives rejected, follow-ups you plan to open. -->
