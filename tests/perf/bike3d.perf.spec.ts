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
 * Timings are `@soft`: recorded as annotations, never a failure here
 * (SwiftShader frame times are noise; baselines and the 150 %/300 % ladder are
 * W4-T2's `scripts/perf/compare.ts`).
 */
import type { Page } from "@playwright/test";

import { PRESET_IDS } from "../../lib/domain";
import type { PerfSnapshot } from "../../lib/testing/e2e-hooks";
import { expect, test } from "../e2e/_fixtures";

type Tier = "low" | "med" | "high";

const BUDGETS: Record<Tier, { calls: number; triangles: number; programs: number }> = {
  low: { calls: 45, triangles: 60_000, programs: 12 },
  med: { calls: 60, triangles: 110_000, programs: 12 },
  high: { calls: 65, triangles: 150_000, programs: 12 },
};

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

  test("orbit timings @soft", async ({ page }) => {
    await open(page);
    const medians: number[] = [];
    for (let run = 0; run < 3; run++) {
      const intervals = await page.evaluate(() => window.__va!.perf.runOrbit(1000));
      const sorted = [...intervals].sort((a, b) => a - b);
      medians.push(sorted[Math.floor(sorted.length / 2)] ?? 0);
    }
    const buildMs = await page.evaluate(() => window.__va!.perf.buildMs);
    test.info().annotations.push({
      type: "timing (advisory)",
      description: `orbit median frame ms per run: ${medians.map((m) => m.toFixed(1)).join(", ")}; buildMs ${buildMs?.toFixed(0)}`,
    });
    expect(medians).toHaveLength(3);
  });
});
