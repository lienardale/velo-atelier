# 3D viewer (`lib/bike3d`, `components/bike3d`)

The parametric bike viewer of plan §3: every rendered part is built in code from
the bike's spec, every part is clickable, and the page works without WebGL.
Geometry numbers and the solver are in [bike3d-geometry.md](./bike3d-geometry.md).

## Layers

```
lib/bike3d/                 pure; no React
  types.ts                  Vec3, anchors, recipes, ScenePlan, tiers
  geometry-table.ts         GEOMETRY_TABLE (discipline × ETRTO, size M)
  solver.ts                 SolverInput → BikeAnchors            (no three)
  cassettes.ts              sprocket radius, cassette teeth, chain length
  scene.ts                  BikeBuild → ScenePlan: which parts, which recipes (no three)
  silhouette.ts             ScenePlan → SVG side view            (no three)
  quality.ts                tiers, governor, caps, persisted tier (no three)
  focus.ts                  camera poses, close-ups, focus spheres (no three)
  highlight.ts              material precedence                  (no three)
  query.ts                  ?part= / ?parts= / dev-page params   (no three)
  hash.ts vec.ts measurements.ts webgl.ts builds.ts
  builders/{lod,tube,gear,wheel,bars,frame}.ts   recipes → BufferGeometry (three)
  materials.ts              the 12 material singletons           (three)
components/bike3d/
  BikeViewer.tsx            client shell (eager): SVG, caps, lazy scene, fallbacks, URL sync
  BikeSilhouetteSvg.tsx     interactive SVG, server-renderable
  store.ts url-sync.ts caps.ts types.ts use-disposable.ts SceneErrorBoundary.tsx
  BikeScene.tsx             LAZY chunk: <Canvas>, lights, ReadyGate, FrameRecorder
  BikeModel.tsx Part.tsx parts/*.tsx      scene graph (test-renderer friendly)
  CameraRig.tsx PartLabel.tsx QualityGovernor.tsx
  perf/PerfProbe.tsx        window.__va hooks (build-gated)
```

**Three.js stays out of the eager bundle.** `BikeViewer` imports only the pure
`scene.ts` / `silhouette.ts`; every module that imports `three`, `@react-three/*`
or `camera-controls` is reached through `next/dynamic(() => import("./BikeScene"))`.
Keep it that way: a static import of `builders/*`, `materials.ts` or drei from the
shell puts three.js into the first load of every bike page (`perf.budgets.json`
forbids it on `/[locale]` and the guide route).

**No logic in `components/bike3d/parts/**`** (ESLint). Every decision — which parts
exist, a drop bar or a riser, disc or rim, where the battery sits — is taken in
`lib/bike3d/scene.ts` and arrives as mesh descriptors. The part components map
descriptors to meshes; `PART_RENDERERS` in `scene.ts` is the compile-time
exhaustiveness check against the domain's rendered parts.

## Public API (for `BikeWorkspace`, W2-T3)

```tsx
import { BikeViewer, BikeViewerProvider } from "@/components/bike3d/BikeViewer";
import { useViewerStore, useViewerStoreApi } from "@/components/bike3d/store";
import { parsePartId, parsePartIds } from "@/lib/bike3d/query";
```

```ts
interface BikeViewerProps {
  spec: BikeSpec;
  build: BikeBuild;
  locale: Locale;
  mode?: "browse" | "pick"; // pick = multi-select for a partial checkup
  initialPartId?: PartId | null; // from server-read searchParams (parsePartId)
  initialPickedIds?: PartId[]; // (parsePartIds)
  onSelect?(id: PartId | null, source: "canvas" | "list" | "svg" | "url" | "checkup"): void;
  onPickedChange?(ids: ReadonlySet<PartId>): void;
  status?: Partial<Record<PartId, "ok" | "ko" | "todo">>; // checkup tint; a hosted KO tints its host
  renderPanel?(id: PartId | null): ReactNode; // side-panel slot (grid column ≥ 1024 px)
  probe?: boolean; // dev pages only; mounts PerfProbe in a hooks build
  fit?: { saddleHeightMm?: number } | null; // Bike.fit → saddle height in the solver
  initialQuality?: "low" | "med" | "high" | null; // force a tier (dev/perf pages)
  className?: string;
}
```

`fit`, `initialQuality` and `className` are additions to the §3.3 signature; all
optional.

**Sharing selection with your own UI.** The parts list, the checkup buttons and the
viewer must read and write ONE store ("selection is bidirectional", §6.4). Wrap
them in `BikeViewerProvider`; a `BikeViewer` inside a provider uses it instead of
creating its own store:

```tsx
<BikeViewerProvider build={build} initialPartId={part} mode={mode} status={status}>
  <BikeViewer spec={build.spec} build={build} locale={locale} mode={mode} renderPanel={…} />
  <PartsList />          {/* useViewerStore(s => s.selectedPartId) + api.getState().select(id, { source: "list", focus: true }) */}
</BikeViewerProvider>
```

Store actions a host may call: `select(id, { source, focus })`, `togglePick(id)`,
`setPicked(ids)`, `setMode(mode)`, `requestReset()`. A hosted part id (pads, tube,
chainring) is a valid selection: its host lights up and the camera focuses the host.

**URL.** The viewer writes `?part=` / `?parts=` with `history.replaceState`
(debounced 100 ms) and reads them back on `popstate`. It never calls
`useSearchParams`: the page reads `await searchParams`, validates with
`parsePartId` / `parsePartIds` and passes `initialPartId` / `initialPickedIds`.
Other parameters and the hash are preserved.

## Behaviour

| Concern                | Rule                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First paint            | `BikeSilhouetteSvg` in the server HTML, in a box sized before any script (`aspect-square max-h-[60svh] min-h-[260px]`, `lg:aspect-[16/10]`).                                                                                                                                                                                                                                                                            |
| 3D mount               | after hydration **and** WebGL 2 **and** `IntersectionObserver` visible **and** `requestIdleCallback` (200 ms fallback); `gl.compile` before `ready`; the SVG then stays mounted, `aria-hidden`, `inert`, opacity 0.                                                                                                                                                                                                     |
| Tap vs drag            | R3F `event.delta ≤ 8` px. Canvas clicks do not move the camera; list / `focus()` selections do (`fitToSphere`, instant under reduced motion).                                                                                                                                                                                                                                                                           |
| Touch (coarse pointer) | one finger scrolls the page (`touch-action: pan-y`, `touches.one = NONE`); two fingers rotate/dolly; the **Pivoter / Rotate** button switches to one-finger orbit (`touch-action: none`). Hover is off.                                                                                                                                                                                                                 |
| Reset                  | visible button; double click with a mouse only.                                                                                                                                                                                                                                                                                                                                                                         |
| Quality                | `deviceMemory ≤ 2` or Save-Data → low; coarse pointer → med; else high; persisted in `va:bike3d:quality`. Governor measures fps only between `controlstart` and `controlend` (≥ 500 ms windows), lowers after 2 slow windows, raises after 3 fast ones, ≤ 2 flips, never above the initial tier on touch, off under reduced motion. Levers: DPR (1 / ≤ 1.5 / ≤ 2), LOD (`low` / `high` geometry), outlines (high only). |
| Materials              | 12 singletons; precedence hover > selected > status > picked > base; overlay colours from `--color-accent`, `--color-warn`, `--color-success`, `--color-danger`, refreshed on a colour-scheme change.                                                                                                                                                                                                                   |
| No WebGL               | SVG + `bike3d.noWebgl`.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Context lost           | `preventDefault`, SVG + `bike3d.reload3d` button; after the 2nd loss the SVG stays (`bike3d.contextLostFinal`).                                                                                                                                                                                                                                                                                                         |
| Scene error            | `SceneErrorBoundary` → SVG + `bike3d.error`.                                                                                                                                                                                                                                                                                                                                                                            |

## Test hooks and dev pages

`window.__va` (contract in `lib/testing/e2e-hooks.ts`, typed in
`types/test-hooks.d.ts`) is **build-time gated**: `BikeViewer` references the
`PerfProbe` chunk only when `NEXT_PUBLIC_TEST_HOOKS === "1"` at build time. The
e2e/perf build sets it; Vercel never does.

`/[locale]/dev/bike3d` (harness with preset / mode switches, a parts list and a
panel) and `/[locale]/dev/bike3d-perf` (preset switches only) are
`force-dynamic`, await `connection()` and 404 unless the running server has
`ENABLE_TEST_PAGES=1` (`tests/security/dev-pages-gated.test.ts`). Query:
`?preset=&part=&parts=&mode=pick&quality=low|med|high`, all whitelisted.

`bike.hittable(pose)` moves the camera to a named pose of `lib/bike3d/focus.ts`
— ten whole-bike poses and seven close-ups — and returns, for every part, a
whole-pixel point where a click lands on that part robustly (±2 px), found by
raycasting the live scene. A chain is 1–2 px wide in a whole-bike view: the
close-ups exist so thin parts are provably clickable.

## Tests

| Tier     | Where                                                          | What                                                                                                                                                                                                                                                                      |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit     | `lib/bike3d/**/*.test.ts`                                      | solver invariants over ~2 000 enumerated specs, file snapshot of `road-disc-2x12` anchors, chain monotonicity, catalogue soft checks, scene plan per preset and every variant, silhouette, quality/governor, focus, builders + §3.4 budgets on geometry, query, materials |
| bike3d   | `tests/bike3d/*.test.tsx`                                      | `@react-three/test-renderer` (`BikeModel`: parts exactly once, taps, drag, pick, status, outlines, geometry disposal), RTL (`BikeViewer` branches with a stub scene), store, URL sync                                                                                     |
| security | `tests/security/{bike3d-query-params,dev-pages-gated}.test.ts` | hostile query params, dev-page gate                                                                                                                                                                                                                                       |
| e2e      | `tests/e2e/bike3d/*.spec.ts`                                   | click, list, every part, pick mode, deep link, touch scroll, no WebGL, context loss, reduced motion, first paint, lazy chunk budget                                                                                                                                       |
| perf     | `tests/perf/bike3d.perf.spec.ts`                               | hard counters per tier and preset, selection cost, idle frames, 20 spec toggles on one context, governor stability; timings `@soft`                                                                                                                                       |

```bash
npx vitest run --project unit --project bike3d
ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash scripts/ci/build.sh
npx playwright test --project=mobile-chromium tests/e2e/bike3d/select-by-click.spec.ts
npx playwright test --project=perf --project=perf-mobile
```

**Checking the build gate by hand** (§3.6 AC7), measured on Next 16.3.4 +
Turbopack, 2026-09-17:

```bash
NEXT_PUBLIC_TEST_HOOKS=0 npm run build
grep -rl "__va" .next/static | grep '\.js$'   # must print nothing
```

`NEXT_PUBLIC_TEST_HOOKS=0`, not "unset": **Turbopack only inlines
`process.env.NEXT_PUBLIC_*` variables that are DEFINED at build time.** With the
variable unset, `process.env.NEXT_PUBLIC_TEST_HOOKS === "1"` survives
minification as a runtime read of the `process.env` polyfill, so the probe chunk
is still emitted (never referenced eagerly, never loaded, and `window.__va`
stays `undefined` — it is a dead file in `.next/static/chunks`). Defined as `0`
the comparison folds to `false`, the `dynamic()` call is dropped, and no chunk
contains a byte of hook code. **Production builds (`scripts/vercel-build.sh`,
the CI production build) must therefore set `NEXT_PUBLIC_TEST_HOOKS=0`.**
(`.next/app-build-manifest.json` does not exist under Turbopack; the probe chunk
appears only in `.next/server/app/[locale]/dev/*/page/react-loadable-manifest.json`,
never in a bike-route manifest.)

## Known limitations

- The plan's axes (+Z = rider's left, drive side −Z) in a right-handed scene put
  the front wheel on the LEFT of the default drive-side view — the render is a
  mirror image of a real bike. Kept as specified; flipping it means negating Z in
  the solver and the silhouette together (follow-up).
