# 005 — `Input.synthesizeScrollGesture` scrolls nothing on CI's Linux Chromium

**Date** 2026-09-17 · **Status** resolved · **Touches** `tests/e2e/bike3d/touch-scroll.spec.ts`

## Symptom

The first CI run that ever executed the W2 bike3d e2e specs (Actions run
35266902160, job `e2e (mobile-chromium)`, commit `7149e47`) failed one test and
only one:

```
[mobile-chromium] › tests/e2e/bike3d/touch-scroll.spec.ts:36:5 ›
one finger scrolls the page; the rotate toggle orbits instead @webgl

Error: expect(received).toBeGreaterThan(expected)
Expected: > 40
Received:   0
- Timeout 10000ms exceeded while waiting on the predicate
```

Deterministic: the first attempt and retry #1 both failed, everything else in
the job passed (179 passed, 3 skipped). The same spec passed on macOS, on every
project, every time. The spec had never run on Linux before — the W2 task
branches were developed in local worktrees and never pushed.

## Investigation

The trace from the CI artifact ruled out the easy answers. At the moment of the
gesture the page was fully rendered and 2 837 px tall in an 839 px viewport, the
canvas was at `{left: 17, top: 338, right: 395, bottom: 716}` with the gesture
point (206, 603) inside it, `window.__va.bike.screenPositionOf("saddle")`
answered (so WebGL under SwiftShader was alive), and the DOM snapshot showed
`touch-action: pan-y` inline on **both** the canvas and the R3F wrapper — the
ancestor fix-up in `CameraRig` had done its job. The document had scrolled
to 39 earlier in the test (`scrollIntoViewIfNeeded`) and back to 0, so the
document was the scroller and it did scroll when asked.

Reproduced outside the runner with a standalone probe (launch Chromium with the
CI GL flags, emulate Pixel 7, wrap `Event.prototype.preventDefault`, log every
touch/pointer/scroll event) run against the same production server, once on
macOS and once in `mcr.microsoft.com/playwright:v1.63.0-noble`
(`--platform linux/amd64`). Same page, same build, same CDP command:

|                                             | macOS                       | Linux container            |
| ------------------------------------------- | --------------------------- | -------------------------- |
| `touchstart`                                | ✔                           | ✔                          |
| `touchmove`                                 | ✔ (1st cancelable, 2nd not) | **none at all**            |
| `pointermove`                               | 2                           | 15, all still `cancelable` |
| `pointercancel` (browser takes the gesture) | ✔                           | —                          |
| `window.scrollY`                            | 183                         | **0**                      |

The finger really moved on Linux — the `pointermove` stream walks y 642 → 447 —
but not one `touchmove` was ever dispatched, so Chromium's gesture recogniser
never saw a touch drag, never generated a scroll, and every `pointermove` stayed
`cancelable` (the browser never committed to scrolling).

A red herring on the way: `camera-controls@3.1.2` calls `preventDefault()` on
every cancelable `pointermove` while a pointer is down, whatever `touches.one`
is set to. It does that on macOS too and the page still scrolls — in Chrome a
pointer event's `preventDefault()` does not cancel scrolling; only `touchmove`'s
does. Not the cause.

## Root cause

`Input.synthesizeScrollGesture` with `gestureSourceType: "touch"` is a
browser-side synthetic gesture, not a touch sequence. In the headless Linux
Chromium the e2e jobs run (Playwright 1.63.0, `--use-gl=angle
--use-angle=swiftshader`), its touch stream reaches the page as
`pointerdown` → `pointermove`… → `pointerup` with **no `touchmove`**, so no
scroll gesture is recognised and `window.scrollY` never moves. On macOS the same
command produces the full touch sequence and scrolls. The test was pinning the
right policy through an input API that does not work on the platform CI uses.

The application is not at fault: in the very same container, a hand-rolled touch
sequence over the same canvas scrolls the document to 325 px, and stops scrolling
as soon as the rotate toggle puts `touch-action: none` on it.

## Fix

Both halves of the spec now use the same one-finger `drag()` helper built from
`Input.dispatchTouchEvent` (which the orbit half already used). Real touch
events still go through the browser's own gesture recognition, so `touch-action`
— not the test — decides whether the drag scrolls the document or reaches the
canvas.

Three details the fix depends on:

- **The drag ends stationary.** A touch scroll that ends while the finger is
  still moving starts a fling, and the page keeps gliding for another second
  under every assertion that follows (observed: `screenPositionOf` returning
  null because the fling had carried the canvas off screen). Holding still for
  200 ms before lifting leaves no velocity and therefore no fling.
- **The viewer is scrolled back into view between the halves.**
  `screenPositionOf` returns null for a point outside the viewport, and where
  the first gesture leaves the page is not part of the policy — a 390 px-tall
  landscape phone ends up somewhere quite different from an 839 px portrait one.
- **The orbit drag is vertical-dominant** (`dx 60, dy -140`, whole pixels, not a
  fraction of a canvas that is 378 px wide in portrait and 812 px in landscape).
  Under `pan-y` Chromium claims a vertically-dominant drag and scrolls; it
  ignores a horizontally-dominant one. With the old horizontal drag, "the page
  did not move" was true whether or not `touch-action: none` had been applied.

## How to detect a regression

`tests/e2e/bike3d/touch-scroll.spec.ts`, mobile Chromium projects. Verified by
mutation — each mutation applied to `components/bike3d/CameraRig.tsx`, rebuilt,
spec re-run:

| Mutation                                                              | Result                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `wanted = "none"` (canvas never gets `pan-y`)                         | red on the `toHaveCSS("touch-action", "pan-y")` precondition                                         |
| `apply()` only reaches the canvas, not its inline-styled ancestors    | red on `scrollY > 40` — `Received: 0`, the exact CI symptom, with the canvas still reporting `pan-y` |
| `touches.one = ACTION.NONE` always (the toggle stops switching)       | red on the saddle-displacement assertion; the scroll half still passed                               |
| `wanted = "pan-y"` always (the toggle stops switching `touch-action`) | red on `scrollY === scrollBefore` — the page scrolled 304 → 431 during the orbit gesture             |

Never reintroduce `Input.synthesizeScrollGesture` in this suite; the file header
says why.

## Running the e2e suite in the CI container (macOS host)

`npm run e2e:docker` bind-mounts the repo, so the container inherits the host's
macOS `node_modules` — `next`, `prisma`, `tsx` and `esbuild` all resolve to
darwin-arm64 binaries and nothing runs. What worked:

```bash
docker volume create va-e2e-nm && docker volume create va-e2e-generated
# once: a container-local install (~9 min under linux/amd64 emulation)
docker run --rm --platform linux/amd64 -v "$PWD":/work -w /work \
  -v va-e2e-nm:/work/node_modules -v va-e2e-generated:/work/lib/generated \
  -e npm_config_cache=/tmp/npmcache -e HUSKY=0 \
  mcr.microsoft.com/playwright:v1.63.0-noble npm ci --no-audit --no-fund

# then, per run (the host-built `.next` is reused as is)
docker run --rm --platform linux/amd64 --ipc=host \
  --network velo-atelier_default \
  -v "$PWD":/work -w /work \
  -v va-e2e-nm:/work/node_modules -v va-e2e-generated:/work/lib/generated \
  -e CI=1 -e PLAYWRIGHT_PORT=3105 \
  -e POSTGRES_URL=postgresql://velo:velo@db:5432/velo_atelier_touch_test \
  -e POSTGRES_URL_NON_POOLING=postgresql://velo:velo@db:5432/velo_atelier_touch_test \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  npx playwright test --project=mobile-chromium tests/e2e/bike3d/touch-scroll.spec.ts
```

Two things make it work. The node_modules and `lib/generated` volumes shadow the
bind mount, so the container gets Linux binaries and the host keeps its own.
And `--network velo-atelier_default` puts the container on the compose network
where the Postgres container answers to the alias `db` — which
`assertTestDatabaseUrl` accepts (`TEST_DB_HOSTS`), unlike
`host.docker.internal`.
