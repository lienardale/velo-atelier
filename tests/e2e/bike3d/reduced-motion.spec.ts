/**
 * `prefers-reduced-motion: reduce` (§3.3): no camera transitions, no fade, no
 * quality governor. A camera focus from the list lands in the frame that
 * requested it instead of animating over ~1 s.
 */
import type { Page } from "@playwright/test";

import { expect, test } from "../_fixtures";
import { openViewer, waitReady } from "./_viewer";

async function framesDuringFocus(page: Page, id: string): Promise<number> {
  return page.evaluate(async (partId) => {
    const before = window.__va!.perf.snapshot()!.frameMs.length;
    window.__va!.bike.focus(partId);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return window.__va!.perf.snapshot()!.frameMs.length - before;
  }, id);
}

test("reduced motion: instant camera, no fade, governor off @webgl", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openViewer(page, "fr");
  await waitReady(page);

  const svg = page.getByTestId("bike3d-svg");
  // globals.css collapses durations to 0.01 ms under reduced motion (not exactly 0).
  const duration = await svg.evaluate((element) =>
    parseFloat(getComputedStyle(element).transitionDuration),
  );
  expect(duration).toBeLessThan(0.001);

  const reduced = await framesDuringFocus(page, "saddle");
  expect(await page.evaluate(() => window.__va!.bike.selectedPartId)).toBe("saddle");

  // Orbiting does not change the tier (the governor is off).
  const quality = await page.evaluate(() => window.__va!.bike.quality);
  await page.evaluate(() => window.__va!.perf.runOrbit(1200));
  expect(await page.evaluate(() => window.__va!.bike.quality)).toBe(quality);

  // The same focus WITH motion animates: it renders clearly more frames. The
  // comparison is inside one test because the frame budget of a 1.2 s window
  // depends on the device and the canvas size.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openViewer(page, "fr");
  await waitReady(page);
  const animated = await framesDuringFocus(page, "saddle");
  test.info().annotations.push({
    type: "focus frames",
    description: `reduced ${reduced}, animated ${animated}`,
  });
  expect(animated).toBeGreaterThan(reduced + 4);
  expect(reduced).toBeLessThan(15);
});
