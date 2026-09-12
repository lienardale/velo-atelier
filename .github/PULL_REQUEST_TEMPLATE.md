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
      I regenerated the baselines on CI or in the amd64 container
      (`npm run e2e:update-snapshots`), and I looked at every image.
      _The `visual-baseline-guard` check fails without this label._
- [ ] **`perf-verified`** — this PR touches `lib/bike3d/**` or
      `components/bike3d/**`. I ran `RUN_LOCAL_PERF=1 npm run perf:local` on a
      real GPU (CI renders through SwiftShader and cannot answer this):
      p95 frame time ≤ 16.7 ms for all 7 presets.
      Report: `.perf/local-<date>.json` → <!-- paste the numbers or a link -->

## Budgets

<!-- Fill in only if this PR could move them. The `build` job prints the table. -->

- First-load JS (home): … kB gzip — budget in `perf.budgets.json`
- Draw calls / triangles, if the 3D scene changed: …

## Anything a reviewer should push back on

<!-- Shortcuts taken, alternatives rejected, follow-ups you plan to open. -->
