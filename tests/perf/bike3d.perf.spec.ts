/**
 * WebGL runtime budgets (§3.4, §3.6 AC5) — projects `perf` (desktop) and
 * `perf-mobile` (Pixel 7).
 *
 * HARD counters (SwiftShader renders them exactly like a GPU would):
 *   - draw calls / triangles / programs per tier on every preset;
 *   - DPR ≤ 2 and drawing buffer ≤ 2 × the viewport; the LOD tier matches;
 *   - a selection adds ≤ 4 draw calls;
 *   - no frame is rendered while idle (frameloop "demand");
 *   - 20 spec toggles return `gl.info.memory.geometries` to baseline ± 2 on ONE
 *     WebGL context;
 *   - the quality tier is unchanged after click – 3 s – click.
 * SOFT timings (`@soft`, one test, every preset) are written to the run file
 * `.perf/<project>.json` (tests/perf/_record.ts) and never fail here: CI
 * renders through SwiftShader, so a millisecond there only means something
 * next to a baseline recorded on the same runner — `scripts/perf/compare.ts`
 * applies §7.3's ladder (warn > 150 %, fail > 300 %) after the run.
 *
 * LOCAL GPU mode (`RUN_LOCAL_PERF=1 npm run perf:local`, docs/bike3d-perf.md):
 * playwright.config drops the SwiftShader flags, the run file becomes
 * `.perf/local-<date>.json`, and the soft test turns into a gate — p95 frame
 * cost ≤ 16.7 ms on every preset, on a renderer that is not SwiftShader.
 */
import path from "node:path";

import type { Page } from "@playwright/test";

import { PRESET_IDS } from "../../lib/domain";
import type { PerfSnapshot } from "../../lib/testing/e2e-hooks";
import { expect, test } from "../e2e/_fixtures";
import { median, percentile, recordRun, type PresetSample } from "./_record";

type Tier = "low" | "med" | "high";

const BUDGETS: Record<Tier, { calls: number; triangles: number; programs: number }> = {
  low: { calls: 45, triangles: 60_000, programs: 12 },
  med: { calls: 60, triangles: 110_000, programs: 12 },
  high: { calls: 65, triangles: 150_000, programs: 12 },
};

/** `RUN_LOCAL_PERF=1`: a real GPU, and the 60 fps budget becomes a gate (§7.3). */
const LOCAL_GPU = process.env.RUN_LOCAL_PERF === "1";
/** One frame at 60 Hz. */
const FRAME_BUDGET_MS = 16.7;
/** A frame the visitor sees as a hitch (§7.3 `longFrames(>50 ms)`). */
const LONG_FRAME_MS = 50;
/** §3.4: the median of three orbits. */
const ORBITS = 3;
const FRAMES_PER_ORBIT = 30;
const ORBIT_MS = 1000;

/**
 * The presets the soft tier measures: all seven, unless `PERF_PRESETS` names a
 * subset for a quick local smoke run. Never on CI — a baseline recorded from a
 * subset would silently stop comparing the rest.
 */
function softPresets(): readonly string[] {
  const only = process.env.PERF_PRESETS?.split(",").filter(Boolean);
  if (!only || only.length === 0) return PRESET_IDS;
  if (process.env.CI)
    throw new Error("PERF_PRESETS is a local smoke-run knob; CI measures every preset");
  const unknown = only.filter((id) => !(PRESET_IDS as readonly string[]).includes(id));
  if (unknown.length > 0) throw new Error(`PERF_PRESETS: unknown preset(s) ${unknown.join(", ")}`);
  return only;
}

async function open(page: Page, preset: string = PRESET_IDS[0]) {
  await page.goto(`/fr/dev/bike3d-perf?preset=${preset}`);
  await page.getByTestId("bike3d-viewer").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.__va?.bike.ready === true, undefined, {
    timeout: 45_000,
  });
}

async function snapshotAfterFrames(page: Page, frames = 3): Promise<PerfSnapshot> {
  return page.evaluate(async (n) => {
    await window.__va!.perf.renderFrames(n);
    return window.__va!.perf.snapshot()!;
  }, frames);
}

async function setTier(page: Page, tier: Tier) {
  await page.evaluate((t) => window.__va!.bike.setQuality(t), tier);
  await expect(page.getByTestId("bike3d-viewer")).toHaveAttribute("data-quality", tier);
}

async function switchPreset(page: Page, preset: string) {
  await page.getByTestId(`preset-${preset}`).click();
  await expect(page.getByTestId(`preset-${preset}`)).toHaveAttribute("aria-pressed", "true");
}

test.describe("bike3d runtime budgets", () => {
  test("draw calls, triangles and programs per tier on every preset", async ({
    page,
    isMobile,
  }) => {
    test.setTimeout(240_000);
    await open(page);
    const tiers: Tier[] = isMobile ? ["low", "med"] : ["low", "med", "high"];
    const rows: string[] = [];

    for (const preset of PRESET_IDS) {
      await switchPreset(page, preset);
      for (const tier of tiers) {
        await setTier(page, tier);
        const snap = await snapshotAfterFrames(page);
        const label = `${preset} @ ${tier}`;
        rows.push(
          `${label}: ${snap.calls} calls, ${snap.triangles} tris, ${snap.programs} programs, dpr ${snap.dpr}`,
        );
        expect(snap.calls, label).toBeGreaterThan(10);
        expect(snap.calls, label).toBeLessThanOrEqual(BUDGETS[tier].calls);
        expect(snap.triangles, label).toBeLessThanOrEqual(BUDGETS[tier].triangles);
        expect(snap.programs, label).toBeLessThanOrEqual(BUDGETS[tier].programs);
        expect(snap.materials, label).toBeLessThanOrEqual(12);
        expect(snap.dpr, label).toBeLessThanOrEqual(2);
        expect(snap.drawingBufferWidth, label).toBeLessThanOrEqual(2 * snap.viewportWidth);
        expect(snap.lodTier, label).toBe(tier === "low" ? "low" : "high");
      }
    }
    test.info().annotations.push({ type: "counters", description: rows.join("\n") });
  });

  test("a selection adds at most 4 draw calls", async ({ page, isMobile }) => {
    test.setTimeout(120_000);
    // Selecting must not move the camera in this test: a different camera means
    // a different set of culled parts, which has nothing to do with selection
    // cost. Canvas clicks select WITHOUT focusing (list clicks focus), so the
    // pose set below holds for every measurement.
    for (const tier of ["high", "med", "low"] as Tier[]) {
      await open(page, "mtb-full-dropper-1x12");
      await setTier(page, tier);
      const points = await page.evaluate(() => window.__va!.bike.hittable("drive-side"));
      const base = await snapshotAfterFrames(page);
      expect(await page.evaluate(() => window.__va!.bike.selectedPartId)).toBeNull();

      for (const [id, point] of Object.entries(points).slice(0, 6)) {
        if (isMobile) await page.touchscreen.tap(point.x, point.y);
        else await page.mouse.click(point.x, point.y);
        await expect.poll(() => page.evaluate(() => window.__va!.bike.selectedPartId)).toBe(id);
        const selected = await snapshotAfterFrames(page);
        expect(selected.calls - base.calls, `${tier} ${id}`).toBeLessThanOrEqual(4);
      }
    }
  });

  test("renders nothing while idle", async ({ page }) => {
    await open(page);
    // Let any transition settle, then watch 2 s of idleness.
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => window.__va!.perf.snapshot()!.frameMs.length);
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => window.__va!.perf.snapshot()!.frameMs.length);
    expect(after).toBe(before);
  });

  test("20 spec toggles keep one context and free their geometry", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, "gravel-1x11");
    const baseline = (await snapshotAfterFrames(page)).geometries;
    for (let i = 0; i < 20; i++) {
      await switchPreset(page, i % 2 === 0 ? "mtb-full-dropper-1x12" : "gravel-1x11");
      await snapshotAfterFrames(page, 2);
    }
    const final = await snapshotAfterFrames(page);
    expect(Math.abs(final.geometries - baseline)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => window.__va!.perf.contextCreations)).toBe(1);
    expect(await page.evaluate(() => window.__va!.bike.mountCount)).toBe(1);
  });

  test("the quality tier is unchanged after click – 3 s – click", async ({ page, isMobile }) => {
    await open(page);
    const quality = await page.evaluate(() => window.__va!.bike.quality);
    const box = (await page.getByTestId("bike3d-canvas").boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (isMobile) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await page.waitForTimeout(3000);
    if (isMobile) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__va!.bike.quality)).toBe(quality);
  });

  test("frame cost, long frames, build and tap latency on every preset @soft", async ({
    page,
    isMobile,
  }, testInfo) => {
    test.setTimeout(480_000);
    const presets: Record<string, PresetSample> = {};
    let renderer = "unknown";

    for (const preset of softPresets()) {
      // A fresh navigation per preset: `buildMs` is store creation → first
      // drawn frame, and it is only measured once per page.
      await open(page, preset);
      renderer = (await page.evaluate(() => window.__va!.perf.renderer)) ?? renderer;
      // eslint-disable-next-line security/detect-object-injection -- `preset` is a PRESET_IDS literal
      presets[preset] = await measurePreset(page, isMobile);
    }

    const { file, run } = recordRun({
      // The repository root: `.perf/` sits next to playwright.config.ts.
      root: testInfo.config.configFile ? path.dirname(testInfo.config.configFile) : process.cwd(),
      project: testInfo.project.name,
      local: LOCAL_GPU,
      renderer,
      presets,
    });
    testInfo.annotations.push({
      type: "timing (advisory)",
      description: [
        `${file} — ${run.runner}, ${run.machine}, ${run.renderer}, three ${run.three}, repetition ${run.repetitions}`,
        ...Object.entries(presets).map(
          ([preset, m]) =>
            `${preset}: p50 ${m.p50FrameMs} ms, p95 ${m.p95FrameMs} ms, long ${m.longFrames}, build ${m.buildMs} ms, tap ${m.tapLatencyMs} ms, ${m.drawCalls} calls`,
        ),
      ].join("\n"),
    });

    for (const [preset, metrics] of Object.entries(presets)) {
      expect(metrics.p50FrameMs, `${preset} p50 frame cost`).toBeGreaterThan(0);
      expect(metrics.tapLatencyMs, `${preset} tap latency`).toBeGreaterThan(0);
    }
    if (!LOCAL_GPU) return;

    // The manual gate (§7.3, §7.6 AC9): only a real GPU can answer it, and only
    // a renderer string that NAMES the device says which one rendered. A masked
    // string ("WebKit WebGL", when WEBGL_debug_renderer_info is not exposed),
    // none at all, or another software rasteriser (Mesa's llvmpipe / softpipe,
    // Windows' WARP "Basic Render Driver", Apple's Software Renderer) would all
    // pass a SwiftShader-only check.
    expect(renderer, "RUN_LOCAL_PERF=1 needs the unmasked WebGL renderer").not.toMatch(
      /^(unknown|WebKit WebGL)$/,
    );
    expect(renderer, "RUN_LOCAL_PERF=1 must render on a GPU, not in software").not.toMatch(
      /swiftshader|llvmpipe|softpipe|software|basic render/i,
    );
    for (const [preset, metrics] of Object.entries(presets)) {
      expect(metrics.p95FrameMs, `${preset} p95 frame cost on ${renderer}`).toBeLessThanOrEqual(
        FRAME_BUDGET_MS,
      );
    }
  });
});

/**
 * One preset's soft numbers, at the tier the viewer chose for this device.
 *
 *   p50FrameMs    median of the three orbits' median frame COST (`frameCost`:
 *                 render + GPU sync) — §3.4's "median of 3 orbits"
 *   p95FrameMs    95th percentile of every frame's cost across the three orbits
 *   longFrames    rAF intervals > 50 ms over three 1 s orbits (3 s, §7.3): the
 *                 hitches a visitor would see, whatever each frame cost
 *   buildMs       store creation → first drawn frame (`__va.perf.buildMs`)
 *   tapLatencyMs  median of five taps alternating between two parts, each
 *                 pointerdown → the selection in the DOM → the next frame
 *                 presented (two rAFs), measured inside the page
 *   drawCalls / triangles / programs   the counters at that tier, for the
 *                 record (their hard budgets are the tests above)
 */
async function measurePreset(page: Page, isMobile: boolean): Promise<PresetSample> {
  const buildMs = (await page.evaluate(() => window.__va!.perf.buildMs)) ?? Number.NaN;
  const counters = await snapshotAfterFrames(page);

  const orbitMedians: number[] = [];
  const costs: number[] = [];
  for (let orbit = 0; orbit < ORBITS; orbit++) {
    const frames = await page.evaluate((n) => window.__va!.perf.frameCost(n), FRAMES_PER_ORBIT);
    expect(frames.length, "frameCost rendered every frame it was asked for").toBe(FRAMES_PER_ORBIT);
    orbitMedians.push(median(frames));
    costs.push(...frames);
  }

  let longFrames = 0;
  for (let orbit = 0; orbit < ORBITS; orbit++) {
    const intervals = await page.evaluate((ms) => window.__va!.perf.runOrbit(ms), ORBIT_MS);
    longFrames += intervals.filter((interval) => interval > LONG_FRAME_MS).length;
  }

  return {
    p50FrameMs: median(orbitMedians),
    p95FrameMs: percentile(costs, 95),
    longFrames,
    buildMs,
    tapLatencyMs: await tapLatency(page, isMobile),
    drawCalls: counters.calls,
    triangles: counters.triangles,
    programs: counters.programs,
  };
}

/**
 * Taps per preset; `tapLatencyMs` is their median. A single tap is one sample,
 * and in both five-repetition CI nightlies of W4 (perf.yml 35600024232 and
 * 35606491888) one desktop tap in 35 landed above 300 % of its own preset's
 * median — 134 ms vs 41.8, 186.1 ms vs 58 — the ladder's FAIL line, which a
 * PR's single repetition (seven desktop taps) would then cross in about one
 * run in five. §3.4 takes the median of three orbits for the same reason.
 */
const TAPS = 5;

/**
 * Tap (touch) or click (mouse) {@link TAPS} times from the drive-side pose,
 * alternating between the two clickable parts farthest apart on screen, and
 * return the median time, measured inside the page, from the `pointerdown` to
 * the frame after the selection reached the DOM (`data-selected` on the
 * viewer). Alternating makes every tap select a new part, and the distance
 * keeps the selected part's outline (high tier, about 2 px wide) away from
 * the next point — a tap caught by it would re-select the same part and
 * change nothing.
 */
async function tapLatency(page: Page, isMobile: boolean): Promise<number> {
  const points = Object.entries(
    await page.evaluate(() => window.__va!.bike.hittable("drive-side")),
  );
  if (points.length === 0) throw new Error("no part hittable from drive-side");
  let pair: [(typeof points)[number], (typeof points)[number]] = [points[0]!, points[0]!];
  let farthest = -1;
  for (const a of points) {
    for (const b of points) {
      const distance = (a[1].x - b[1].x) ** 2 + (a[1].y - b[1].y) ** 2;
      if (distance > farthest) [farthest, pair] = [distance, [a, b]];
    }
  }
  // One clickable part only: a second tap on it would select nothing new.
  const taps = pair[0][0] === pair[1][0] ? 1 : TAPS;
  const latencies: number[] = [];
  for (let tap = 0; tap < taps; tap++) {
    const [id, point] = pair[tap % 2]!;
    latencies.push(await tapOnce(page, isMobile, id, point));
  }
  return median(latencies);
}

async function tapOnce(
  page: Page,
  isMobile: boolean,
  id: string,
  point: { x: number; y: number },
): Promise<number> {
  await page.evaluate((target) => {
    const viewer = document.querySelector('[data-testid="bike3d-viewer"]')!;
    const probe = { down: 0, done: 0 };
    (window as unknown as { __vaTapProbe: typeof probe }).__vaTapProbe = probe;
    window.addEventListener(
      "pointerdown",
      () => {
        probe.down = performance.now();
      },
      { capture: true, once: true },
    );
    const observer = new MutationObserver(() => {
      if (viewer.getAttribute("data-selected") !== target) return;
      observer.disconnect();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          probe.done = performance.now();
        }),
      );
    });
    observer.observe(viewer, { attributes: true, attributeFilter: ["data-selected"] });
  }, id);

  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);

  const latency = await page.waitForFunction(
    () => {
      const probe = (window as unknown as { __vaTapProbe: { down: number; done: number } })
        .__vaTapProbe;
      return probe.down > 0 && probe.done > 0 ? probe.done - probe.down : null;
    },
    undefined,
    { timeout: 15_000 },
  );
  return (await latency.jsonValue()) as number;
}
