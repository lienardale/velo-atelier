/**
 * Touch policy on phones (§3.3): one finger over the canvas scrolls the PAGE
 * (`touch-action: pan-y`, `touches.one = NONE`); the "Rotate" toggle switches
 * to one-finger orbit (`touch-action: none`) and the page stays put.
 *
 * Touches are real input events through CDP (`Input.dispatchTouchEvent`), so
 * the browser applies `touch-action` exactly as it would for a finger.
 */
import type { CDPSession, Page } from "@playwright/test";

import { expect, test } from "../_fixtures";
import { openViewer, waitReady } from "./_viewer";

async function drag(
  page: Page,
  cdp: CDPSession,
  from: { x: number; y: number },
  dx: number,
  dy: number,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y }],
  });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + (dx * i) / steps, y: from.y + (dy * i) / steps }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
}

test("one finger scrolls the page; the rotate toggle orbits instead @webgl", async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(
    !isMobile || browserName !== "chromium",
    "touch policy on Chromium phones (CDP touch input)",
  );
  await openViewer(page, "fr");
  await waitReady(page);
  await expect(page.getByTestId("bike3d-canvas")).toHaveCSS("touch-action", "pan-y");

  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  // A landscape phone is 390 px tall and the canvas taller than what is on
  // screen: every gesture point must be inside the VISIBLE part of the canvas,
  // or the touch lands on the page next to it and proves nothing.
  const visiblePoint = async (fx: number, fy: number) => {
    const box = (await page.getByTestId("bike3d-canvas").boundingBox())!;
    const viewport = page.viewportSize()!;
    const left = Math.max(box.x, 4);
    const right = Math.min(box.x + box.width, viewport.width - 4);
    const top = Math.max(box.y, 4);
    const bottom = Math.min(box.y + box.height, viewport.height - 4);
    return { x: Math.round(left + (right - left) * fx), y: Math.round(top + (bottom - top) * fy) };
  };
  const center = await visiblePoint(0.5, 0.7);

  const saddleBefore = await page.evaluate(() => window.__va!.bike.screenPositionOf("saddle"));
  // A synthesized touch scroll gesture: it goes through the compositor, so
  // `touch-action` decides whether the page scrolls — which is the point here.
  await cdp.send("Input.synthesizeScrollGesture", {
    x: Math.round(center.x),
    y: Math.round(center.y),
    xDistance: 0,
    yDistance: -180,
    gestureSourceType: "touch",
    speed: 800,
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(40);

  // Then orbit with the toggle on. Clicking the button may scroll it into view
  // on a landscape phone, so the drag is compared against the scroll position
  // right before it, not against 0.
  await page.getByTestId("bike3d-rotate").click();
  await expect(page.getByTestId("bike3d-rotate")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("bike3d-canvas")).toHaveCSS("touch-action", "none");
  const from = await visiblePoint(0.3, 0.5);
  const to = await visiblePoint(0.8, 0.5);
  const before = await page.evaluate(() => window.__va!.bike.screenPositionOf("saddle"));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await drag(page, cdp, from, to.x - from.x, 0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  const after = await page.evaluate(() => window.__va!.bike.screenPositionOf("saddle"));
  expect(saddleBefore).not.toBeNull();
  expect(before).not.toBeNull();
  // The camera moved: the saddle is no longer where it was (or out of view).
  expect(after === null || Math.abs(after.x - before!.x) + Math.abs(after.y - before!.y) > 10).toBe(
    true,
  );
});
