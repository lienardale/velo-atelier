# 005 — the home page's Lighthouse regression: a re-created LCP element and 139 kB of shapes

**Date** 2026-09-17 · **Status** resolved · **Branch** `fix/w2-home-perf`

## Symptom

On the W2 integration commit `7149e47` (GitHub Actions run 35266902160, job
`lighthouse`), only the home page failed the gate:

| URL                             | perf     | FCP  | LCP         | TBT        |
| ------------------------------- | -------- | ---- | ----------- | ---------- |
| `http://localhost:3100/fr`      | **0.81** | 1703 | **3607 ms** | **336 ms** |
| `http://localhost:3100/en`      | **0.82** | 1728 | **3603 ms** | 317 ms     |
| `…/fr/guides/check-brakes-disc` | 0.96     | 1899 | 1899 ms     | 161 ms     |
| `…/fr/connexion`                | 0.97     | 1695 | 1695 ms     | 160 ms     |

Thresholds: performance ≥ 0.85, LCP ≤ 2500 ms, TBT ≤ 300 ms.

The LCP element was plain server-rendered text already present in the first
10 kB of the HTML — `main#main-content > … > p.max-w-2xl`, the landing
paragraph — and its LCP was **96 % "render delay" (3463 ms)**. Nothing was
downloaded late. The text simply could not be the LCP at the time it painted.

**The line that gives it away is in the table above: on every page that passes,
LCP == FCP exactly. Only the home page has a gap.**

## Investigation

Two separate faults, found by measuring rather than by reasoning about the
payload. The suspected cause (the illustration payload) turned out to explain
the TBT and none of the LCP.

### 1. The document

`.next/server/app/fr.html` was **322 628 B** for **21 245 B of markup**: 93 % of
the document was inline `<script>self.__next_f.push(…)</script>`, i.e. the RSC
payload. Decoding it and splitting it by row:

| part                                            | flight bytes |
| ----------------------------------------------- | ------------ |
| 16 help `<figure>`s (79 542 B of SVG + legends) | 94 318       |
| 38 option thumbnails                            | 44 495       |
| `NextIntlClientProvider` messages (row `f`)     | 81 540       |
| everything else                                 | 49 110       |

`renderTreeIllustrations()` renders every drawing of every question — the tree
navigates on the client, so all 54 have to be there before the visitor asks for
them — and the first screen shows exactly one of them, inside a `<details>`
that starts closed.

**Control:** a build with the illustration map emptied → `fr.html` 322 628 B →
**139 904 B**, and on the CI runner's profile the main-thread cost tracks the
document almost linearly (CI: 322.6 kB → 965 ms of script evaluation → TBT 336;
guide page 180.0 kB → 665 ms → TBT 161).

### 2. The LCP, which the control did **not** fix

The same control build still measured **LCP 3.5–3.8 s**. So the payload was not
what kept the paragraph from painting.

Listing every LCP candidate Chrome reports, under Lighthouse's own applied
throttling (4× CPU, 1.6 Mbit/s, 562 ms RTT — devtools throttling multiplies the
150 ms RTT by 3.75):

```
FCP 1536 ms
LCP candidate 1  t=1536  size=34398  <p class="max-w-2xl …">   node A
LCP candidate 2  t=3260  size=34592  <p class="max-w-2xl …">   node B   ← different node
```

With the fonts already cached, **one** candidate, size 34592, at first paint.

So: the home page's tree reads the query string, which on a static route means
it renders only on the client, under a `<Suspense>` whose fallback
(`DecisionTreeSkeleton`) carried the landing heading. React throws a fallback's
DOM away when the real subtree arrives, so the paragraph is **destroyed and
re-created** at the end of hydration — and Chrome, which reports each element
at most once, sees a _new_ element. The first paint used the metric-adjusted
fallback font (34 398 px²), the re-created node paints with the web font
(34 592 px², 0.6 % larger), so it is "larger than the largest so far" and wins.
LCP therefore equalled _"all first-load JS downloaded and hydrated"_ — 3.6 s.

The font swap alone would not do it: it repaints the same element, and Chrome
does not re-report one. It takes both.

## Root cause

1. **LCP** — the LCP element lived inside the tree's `<Suspense>` boundary, so
   the fallback→content swap re-created it after hydration.
2. **TBT / script evaluation** — the RSC payload carried the geometry of all 54
   drawings (139 kB of flight, ~180 kB of document) for a screen that shows one.

## Fix

**LCP.** `DecisionTreeHero` is rendered by the server _above_ the boundary and
handed to the new `DecisionTreeFrame` (`components/decision-tree/`) as an
already-rendered node. The frame drops it when the tree reports that a question
has become the `<h1>` (`onIntroChange`), which is exactly the behaviour the
skeleton had — a deep link showed the heading during the skeleton and lost it
when the tree arrived. The node is now painted once and never touched.

**Payload.** A drawing is split between its frame and its shapes:

- `scripts/gen-tree-drawings.ts` renders every drawing to markup at build time
  (`npm run drawings`, run by `build` and `dev`) into **`public/tree-drawings.json`**
  — 54 drawings, 88 584 B. `components/illustrations/tree-geometry.tsx` does the
  rendering; it is server code, so the 72-component barrel still reaches no
  client bundle.
- `components/decision-tree/TreeDrawing.tsx` (client) draws the `<svg>` frame,
  the `<title>` from `illustrations.<id>.alt` and the callout legend, and fills
  the frame from the map, fetched once after hydration
  (`components/decision-tree/tree-drawings.ts`). Before it lands the frame is
  empty but correctly sized — a `viewBox` sizes the box whatever is in it — so
  there is no layout shift.
- `renderTreeIllustrations()` still decides, on the server, which drawing goes
  where; it now emits a ~150-byte `<TreeDrawing>` element instead of 1–5 kB of
  geometry. A drawing still on its placeholder keeps the old server-rendered
  path.

`react-dom/server` is why this is a script and not a route handler: Turbopack
refuses a static import of it anywhere under `app/**`, and a dynamic import
inside a `force-static` route handler throws _"A component suspended while
responding to synchronous input"_ — the RSC runtime resolves React under the
`react-server` condition, where the synchronous DOM renderer cannot run.

`public/tree-drawings.json` is **committed**, unlike the other generated trees:
the `lighthouse` and `e2e` jobs restore only `.next/` from the build artifact
while `next start` serves `public/` from the checkout. `scripts/ci/content.sh`
runs `gen-tree-drawings --check` so it cannot go stale.

## Result

| build                              | document `fr.html` | flight  |
| ---------------------------------- | ------------------ | ------- |
| before                             | 322 628 B          | 269 463 |
| illustration map emptied (control) | 139 904 B          | 108 607 |
| **after**                          | **181 198 B**      | 145 822 |

Locally (median of 3, applied throttling, mobile): `/fr` 0.81 → **0.98**,
LCP 3949 → **1927 ms**, and LCP == FCP on every run; `/en` 0.86 → **0.97**.

## How to detect a regression

- `components/decision-tree/DecisionTreeFrame.test.tsx` — the landing heading is
  the only `<h1>` on the first screen (fr + en) and steps aside for the
  question's.
- `components/decision-tree/DecisionTreeSkeleton.test.tsx` — _"carries no
  heading: the h1 lives above the boundary this is the fallback of"_. Putting
  the heading back in the fallback is the regression, and this fails on it.
- `components/illustrations/tree-geometry.test.tsx` — every drawing the tree can
  show has shapes and no `<title>`; `treeFrameAttrs()` is byte-for-byte the
  `<svg>` `TreeIllustrationFrame` draws.
- `components/decision-tree/tree-drawings.test.tsx` — one fetch however many
  drawings mount; a failed fetch costs decoration, not the page.
- `tests/e2e/decision-help.spec.ts` — every question's help drawing has a
  `<title>` **and shapes** (an empty frame with the right name would otherwise
  pass).
- `lighthouserc.cjs` — and remember the calibration: **TBT is not reproducible
  on a fast machine.** The same build measured TBT 336 ms on the CI runner and
  40 ms here. `mainthread-work-breakdown → scriptEvaluation` and the size of
  `.next/server/app/fr.html` are the numbers that do carry across.
