# 3D viewer performance (`tests/perf`, `perf.yml`, `RUN_LOCAL_PERF`)

How the viewer's performance is measured, what fails a build, and what a human
still has to check on a real device. Budgets are §3.4 and §7.3 of the plan; the
viewer itself is [bike3d.md](./bike3d.md).

CI has no GPU. Chromium renders WebGL through **SwiftShader**, a software
rasteriser, so the repository splits every measurement into what SwiftShader
reproduces exactly and what it cannot:

| Tier                     | Where                                                              | Fails the build?                     |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------ |
| **Hard counters**        | `tests/perf/bike3d.perf.spec.ts`, projects `perf` + `perf-mobile`  | yes — every PR (`ci.yml` job `perf`) |
| **Soft timings** `@soft` | the same spec → `.perf/<project>.json` → `scripts/perf/compare.ts` | only beyond 300 % of the baseline    |
| **Local GPU gate**       | `RUN_LOCAL_PERF=1 npm run perf:local` → `.perf/local-<date>.json`  | the `perf-verified` label (manual)   |
| **Real devices**         | the checklist below                                                | reviewer judgement                   |
| Lighthouse, bundle sizes | `lighthouserc.cjs`, `perf.budgets.json`                            | yes — see the last two sections      |

## Hard counters — deterministic, every PR

Draw calls, triangles and programs per quality tier on every preset (low ≤ 45 /
60 k / 12, med ≤ 60 / 110 k / 12, high ≤ 65 / 150 k / 12), ≤ 12 materials, DPR ≤ 2,
drawing buffer ≤ 2 × the viewport, the LOD tier the quality maps to, a selection
adding ≤ 4 calls, no frame rendered while idle, 20 spec toggles on ONE WebGL
context returning `gl.info.memory.geometries` to ± 2, and the quality tier
unchanged after click – 3 s – click. SwiftShader counts exactly what a GPU
counts, so these are ordinary assertions.

## Soft timings — how to read them

One test per project, tagged `@soft`, measures every preset at the tier the
viewer picks for the device (desktop `high`, Pixel 7 `med`) and writes the run
file (`tests/perf/_record.ts`):

| Metric                               | What it is                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `p50FrameMs`                         | median of three orbits' median **frame cost**: `gl.render` + a 1-pixel `readPixels`, which returns once the GPU has finished the frame |
| `p95FrameMs`                         | 95th percentile of every frame's cost over the three orbits (90 frames)                                                                |
| `longFrames`                         | rAF intervals > 50 ms over three 1 s orbits — the hitches a visitor would see                                                          |
| `buildMs`                            | store creation → first drawn frame (`__va.perf.buildMs`), on a fresh page per preset                                                   |
| `tapLatencyMs`                       | median of five taps alternating between two parts: `pointerdown` → selection in the DOM → next frame                                   |
| `drawCalls`, `triangles`, `programs` | the counters at that tier, for the record (the hard budgets are above)                                                                 |

**Frame cost, not frame interval.** On a real GPU `requestAnimationFrame`
intervals are pinned to the display's refresh: measured on an M2, an _empty_ page
gives p95 16.8–18.8 ms (headless and headed alike, with or without
`--disable-frame-rate-limit`). They say whether a frame was _late_, never whether
it _fit_. So the 60 fps question — does a frame fit in 16.7 ms? — is answered by
the cost of producing it, and the intervals are kept only for `longFrames`.

`scripts/perf/compare.ts` (run by `scripts/ci/perf.sh` after the specs) compares
the run with `tests/perf/baselines/<project>.json` and writes one table to the
job summary. §7.3's ladder, identical on PRs and at night:

- **≤ 150 %** of the baseline: ok;
- **> 150 %**: warning in the summary — look, but nothing is red;
- **> 300 %**: the job fails. SwiftShader is noisy, but for the frame cost,
  long frames and build time three times slower is not noise: over the first
  three five-repetition nightlies their worst sample was 154 % of its preset's
  median. **Tap latency is the exception**: one sample in 70 crossed 300 % in
  each of those nightlies (134, 186 and — as a median of five taps — 114 ms
  against medians of 36–58 ms), two of the three on the first preset measured.
  Until more nightlies say otherwise (serialising the `perf` and `perf-mobile`
  workers is the open lever), re-run a PR whose only FAIL is `tapLatencyMs`
  before reading it as a regression: a real one fails every run.

`longFrames` is a count, laddered on `(run + 1) / (baseline + 1)`: with a zero
baseline a plain ratio is infinite at the first long frame, and one SwiftShader
hitch would fail the job. Smoothed, a zero baseline warns at 1 and fails at 3;
at any other baseline the fail line is exactly two long frames later than a
plain ratio's (baseline 10: fail from 33, not 31), the warn line at most one.
A baseline recorded on another runner label or another three release is still
compared, with a warning in the summary: that comparison is two machines, not
two commits.

The nightly (`perf.yml`, 03:00 UTC) runs the specs five times
(`PERF_REPEAT=5`); every repetition merges into the same run file by run id, and
the file records the median. Its `perf-nightly` artifact (90 days) holds the run
files (`.perf/<project>.json`, every number above) and, on an `update_baseline`
run, the baselines recorded from them; the test's `timing (advisory)`
annotation reaches neither the artifact nor the job log.

## Refreshing the baseline

**Only CI records a baseline.** `UPDATE_PERF_BASELINE=1` outside GitHub
Actions exits 1, whatever `.perf/` holds — a laptop's GPU numbers would make
every CI run look like a 10× regression.

1. Actions → **Perf** → _Run workflow_ on the branch, with `update_baseline`
   ticked (`gh workflow run perf.yml --ref <branch> -f update_baseline=true`).
   One dispatch at a time: the workflow cancels a run in progress on the same
   ref.
2. The `perf (nightly)` job runs the specs five times and `compare.ts` writes
   `tests/perf/baselines/<project>.json` from that run (medians only, no raw
   samples, so the JSON is exactly what Prettier writes).
3. The `perf baseline PR` job validates the files
   (`scripts/ci/perf-baseline.sh`: presets present, no raw samples, a CI
   runner, a three version) and opens a PR titled
   `test(perf): record the soft-tier baselines`. It holds a write token (as
   `update-snapshots` does), so it builds and tests nothing: no dependency
   script or git hook runs in it, and its checkout does not persist the
   token.
4. Read it before merging: the `repetitions`, the `runner`, the `three`
   version, and whether any preset looks slower than the last baseline for no
   reason. A baseline recorded on a bad night hides every regression after it.

Refresh after a three upgrade (the summary warns), a runner image change, or a
deliberate change to what the scene draws — never to make a red run green.

## The local GPU run (`perf-verified`)

```bash
ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash scripts/ci/build.sh
RUN_LOCAL_PERF=1 npm run perf:local          # the perf project, on this machine's GPU
```

With `RUN_LOCAL_PERF=1` the perf projects drop the SwiftShader flags for
`--ignore-gpu-blocklist --enable-gpu` (headless Chromium reaches the GPU with
them — verified on an Apple M2, "ANGLE Metal Renderer: Apple M2"; set
`PERF_HEADED=1` on a machine whose headless mode has none). The soft test then:

- fails unless the WebGL renderer string names a GPU: SwiftShader or another
  software rasteriser fails, and so does a masked or missing string — a wrong
  setup never passes quietly;
- requires **p95 frame cost ≤ 16.7 ms on all seven presets**;
- writes `.perf/local-<YYYY-MM-DD>.json`, the one run file that is committed
  (`.gitignore` excepts `local-*.json`; `compare.ts` never compares it and never
  makes it a baseline).

Stop every other build and Playwright run first: this measures the machine as
much as the code (`.debug/010` §9). `PERF_PRESETS=gravel-1x11` limits the soft
test to a subset for a quick smoke run — a subset does not tick the box.

**The rule.** A PR that touches `lib/bike3d/**` or `components/bike3d/**` needs
the `perf-verified` label, and the PR template's checkbox links the committed
`.perf/local-<date>.json` (or pastes its seven p95 values). CI cannot check this
for you: it has no GPU.

## Real-device checklist

For changes to the viewer's interaction, loading or quality logic — and before
a release. One pass per device class; note the device, OS and browser version
in the PR.

| Device class                               | Why it is on the list                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| iPhone, current Safari                     | WebKit's WebGL and touch model; the `med` tier; `100svh` and the bottom sheet |
| Mid-range Android, Chrome                  | the `med` tier on a slower GPU; thermal throttling after a few minutes        |
| Low-end Android (≤ 2 GB, or Data Saver on) | the `low` tier (`deviceMemory ≤ 2` / Save-Data) and the smallest canvas       |
| Laptop, integrated GPU, Chrome or Safari   | the `high` tier with outlines at DPR 2                                        |

On each:

1. **First paint** — `/fr/velo/demo` shows the SVG silhouette at once, the
   canvas fades in after it, and nothing moves when it does (no layout shift).
2. **Quality** — `data-quality` on `[data-testid=bike3d-viewer]` (Web
   Inspector / remote devtools) matches the class above; after a minute of
   orbiting it has not flipped more than twice.
3. **Touch** — one finger scrolls the page, two fingers orbit, the _Pivoter /
   Rotate_ button switches one finger to orbiting and back; a tap on a part
   opens the sheet on that part, a drag never selects.
4. **Smoothness** — orbit for 30 s: no visible hitch after the first second. On
   Chrome, record it in the Performance panel (remote debugging) and note the
   longest frame; on Safari, the Timelines tab's frame rate.
5. **Selection cost** — tap five parts in a row: each highlight appears with
   the tap, not a beat later.
6. **Context loss** — switch to another heavy app and back: the viewer either
   keeps its canvas or falls back to the SVG with the _Recharger la 3D_ button,
   never a blank box.
7. **Reduced motion** — with the OS setting on, a list selection jumps the
   camera instead of flying it, and the governor is off.
8. **Dark mode** — switching the OS scheme recolours the highlight materials.

## Lighthouse

`scripts/ci/lighthouse.sh` runs `lhci autorun` (mobile, applied throttling; 3
runs on PRs, 5 at night) and then `scripts/perf/lighthouse-report.ts`, pass or
fail: every run and the median per URL, in the log and the job summary, plus
`.lighthouseci/summary.json`. That table is the single measured source for
every Lighthouse pin.

The content bar (§7.3: performance 0.85, LCP 2500, TBT 300, CLS 0.1, a11y 0.95,
SEO 0.95, best practices 0.9) is frozen. The bike pages carry a looser, measured
bar that only ever **tightens**, by the rule the report applies:

- performance: `max(current, min(0.70, floor₀.₀₁(median − 0.05)))`;
- LCP and TBT: `min(current, max(target, ceil₅₀(median × 1.15)))`;

with `median` the worse of the two bike URLs' and `target` §7.3's bike bar
(`BIKE_TARGET` in `lighthouserc.cjs`: 0.70 / 3000 ms / 600 ms). A median
already worse than the threshold moves nothing and is a finding. A pin never
goes past the target: there the bike page meets the plan, and the guard in
`lighthouserc.cjs` refuses a bike threshold tighter than it. Pins are taken
from the nightly's five-run medians, never from a laptop.

Two things that decide the bike pages' numbers (`.debug/014`):

- **The LCP element is the largest text painted before any input**, and a
  late text wins if it is larger. The `<h1>` is painted at first paint (the
  inline silhouette SVG is never an LCP candidate in Chrome), so anything the
  viewer adds later must not outgrow it: that is why the 3D loading notice is
  announced but not painted. It used to put `/en/bike/demo`'s LCP at the 3D
  mount — 4520 ms against 2302 ms for the same page in French, where the
  `<h1>` is twice as wide.
- **A laptop's Lighthouse timings are not CI's.** With the CI GL flags Chrome
  rasterises the page through SwiftShader too, so the first paint waits for
  software raster: on a machine busy with builds it lands seconds later than
  on the idle runner. Run `lhci` locally only on an idle machine, and trust
  the nightly table over it.

## Bundle sizes

- **First-load JS per route** — `npx tsx scripts/perf/bundle-budget.ts`
  (run by every build): gzipped eager JS against `perf.budgets.json`, printed in
  KiB. The ceilings are a ratchet re-pinned at each wave integration to
  measured + 10 % (`--json` prints the raw bytes and the `nextPin`), and
  `--budget '<route>=<bytes>'` overrides one ceiling for a single run — §7.6
  AC8's "a budget of 1000 must exit 1".
- **The lazy 3D chunk** — `tests/e2e/bike3d/bundle-budget.spec.ts`
  (desktop-chromium, FR and EN): every script fetched between the navigation
  and `__va.bike.ready` that the server HTML did not reference, compressed,
  against `lazy3dChunkGzipBytes`. Pinned at `min(409600, ceil(measured × 1.15))`
  from the merged tree's measurement (the test's `lazy-3d-bytes` annotation); a
  measurement above 400 kB is a finding, not a pin.
