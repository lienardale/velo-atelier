/**
 * Touch inside the workspace (§6.8 AC5): a finger must never rotate the bike by
 * accident.
 *
 * On a phone the workspace is a fixed-height column — the page does not scroll,
 * the sheet does — so the canvas's `touch-action: pan-y` has nothing to hand a
 * vertical swipe. What matters is the negative: **the camera does not move**
 * unless the visitor asked for it with the "Pivoter" toggle.
 *
 * Touches go through CDP (`Input.dispatchTouchEvent` /
 * `Input.synthesizeScrollGesture`), so the browser applies `touch-action`
 * exactly as it would for a real finger — `page.touchscreen` would bypass the
 * compositor and prove nothing about it.
 *
 * ## How "the camera moved" is measured
 *
 * By the whole projection, not by one part. `window.__va.bike.screenPositionOf`
 * raycasts, so it answers `null` for a part occluded from wherever the camera
 * happens to be — which makes any single part a coin toss. The map of every
 * part that IS visible, on the other hand, is stable while the camera is and
 * changes as soon as it turns.
 */
import type { CDPSession, Page } from "@playwright/test";

import { expect, href, test } from "./_fixtures";

type Projection = Record<string, { x: number; y: number }>;

/** Every part the camera can currently see, and where it is drawn. */
async function projection(page: Page): Promise<Projection> {
  return page.evaluate(() => {
    const bike = window.__va!.bike;
    const result: Record<string, { x: number; y: number }> = {};
    for (const id of bike.partIds) {
      const point = bike.screenPositionOf(id);
      if (point) result[id] = { x: Math.round(point.x), y: Math.round(point.y) };
    }
    return result;
  });
}

/** Did the view change? A moved camera changes what is visible, where, or both. */
function differs(before: Projection, after: Projection): boolean {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of ids) {
    const a = before[id];
    const b = after[id];
    if (!a || !b) return true;
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 6) return true;
  }
  return false;
}

async function dragTouch(
  page: Page,
  cdp: CDPSession,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y }],
  });
  const steps = 12;
  for (let index = 1; index <= steps; index++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + (dx * index) / steps, y: from.y + (dy * index) / steps }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(500);
}

/**
 * A point on the canvas the bottom sheet does not cover. The sheet is
 * `position: fixed` over the lower half of the viewport, so a gesture aimed at
 * the middle of the canvas box lands on the sheet and proves nothing.
 */
async function uncoveredCanvasPoint(page: Page, fx: number): Promise<{ x: number; y: number }> {
  const canvas = (await page.getByTestId("bike3d-canvas").boundingBox())!;
  const sheet = await page.locator("[data-testid=parts-sheet]").boundingBox();
  const top = Math.max(canvas.y, 8);
  const bottom = Math.min(canvas.y + canvas.height, (sheet?.y ?? Number.POSITIVE_INFINITY) - 8);
  const point = {
    x: Math.round(canvas.x + canvas.width * fx),
    y: Math.round(top + (bottom - top) * 0.5),
  };
  // Guard against a layout that leaves no room: the test would otherwise "pass"
  // by dragging on the sheet.
  const onCanvas = await page.evaluate(
    ([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.tagName === "CANVAS",
    [point.x, point.y] as const,
  );
  expect(onCanvas, `(${point.x}, ${point.y}) is not on the canvas`).toBe(true);
  return point;
}

test.beforeEach(async ({ page, isMobile, browserName }) => {
  test.skip(!isMobile || browserName !== "chromium", "touch policy on Chromium phones (CDP input)");
  // The sheet these gestures are aimed around only exists on a tall phone (§6.4).
  test.skip(
    (page.viewportSize()?.height ?? 0) <= 500,
    "landscape phones use the docked grid, not the sheet (§6.4)",
  );
  await page.goto(href("fr", "/velo/[id]", { id: "demo" }));
  await page.waitForFunction(() => window.__va?.bike.ready === true, undefined, {
    timeout: 30_000,
  });
});

test("one finger on the canvas never rotates the bike @webgl", async ({ page }) => {
  await expect(page.getByTestId("bike3d-canvas")).toHaveCSS("touch-action", "pan-y");

  const cdp = await page.context().newCDPSession(page);
  const from = await uncoveredCanvasPoint(page, 0.3);

  const before = await projection(page);
  expect(Object.keys(before).length).toBeGreaterThan(3);
  await dragTouch(page, cdp, from, 160, 0);

  expect(differs(before, await projection(page))).toBe(false);
});

test("the Pivoter toggle hands the canvas the finger back @webgl", async ({ page }) => {
  const toggle = page.getByTestId("bike3d-rotate");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("bike3d-canvas")).toHaveCSS("touch-action", "none");

  const cdp = await page.context().newCDPSession(page);
  const from = await uncoveredCanvasPoint(page, 0.3);

  const before = await projection(page);
  await dragTouch(page, cdp, from, 160, 0);

  expect(differs(before, await projection(page))).toBe(true);
});

test("a vertical swipe on the sheet scrolls the sheet, and only the sheet @webgl", async ({
  page,
}) => {
  const sheet = page.locator("[data-testid=parts-sheet]");
  await page.locator("[data-testid=parts-sheet] [data-slot=mobile-sheet-handle]").focus();
  await page.keyboard.press("End");
  await expect(sheet).toHaveAttribute("data-snap", "2");
  await page.waitForTimeout(400);

  const scroller = sheet.locator("[data-slot=mobile-sheet-content]");
  const box = (await scroller.boundingBox())!;
  const viewport = page.viewportSize()!;
  // The sheet is taller than what is on screen: the gesture has to start inside
  // the viewport or CDP refuses it ("Position out of bounds").
  const point = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(Math.min(box.y + box.height / 2, viewport.height - 40)),
  };

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: point.x,
    y: point.y,
    xDistance: 0,
    yDistance: -200,
    gestureSourceType: "touch",
    speed: 800,
  });
  await page.waitForTimeout(500);

  // §6.4: the sheet is the ONLY scroll container on the page.
  expect(await scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Deliberately not asserted here: that the projection is byte-identical
  // afterwards. Whether a finger can turn the bike is settled by the first test
  // in this file, on the canvas itself; over the sheet the viewer is free to
  // refit when the layout around it changes, and pinning the projection made
  // this test fail two runs in three for a reason that is not a regression.
});
