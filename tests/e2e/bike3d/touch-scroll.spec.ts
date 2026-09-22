/**
 * Touch policy on phones (§3.3): one finger over the canvas scrolls the PAGE
 * (`touch-action: pan-y`, `touches.one = NONE`); the "Rotate" toggle switches
 * to one-finger orbit (`touch-action: none`) and the page stays put.
 *
 * BOTH gestures are the same one-finger drag, pushed through CDP as real touch
 * events (`Input.dispatchTouchEvent`): the browser runs its own gesture
 * recognition on them, so `touch-action` — not the test — decides whether the
 * drag scrolls the document or reaches the canvas. Only the mode differs
 * between the two halves, which is exactly the policy under test.
 *
 * Do NOT reach for `Input.synthesizeScrollGesture` here. It scrolls on macOS
 * but is inert in the Linux Chromium CI runs on (`e2e (mobile-chromium)`,
 * mcr.microsoft.com/playwright:v1.63.0-noble): the synthetic touch stream
 * arrives as `pointerdown` → `pointermove`… → `pointerup` with no `touchmove`
 * at all, so no scroll gesture is ever recognised and `window.scrollY` stays 0
 * for the whole poll. See `.debug/005-touch-scroll-ci-2026-09-17.md`.
 */
import type { CDPSession, Page } from "@playwright/test";

import { expect, forEachLocale, test } from "../_fixtures";
import { openViewer, scrollViewerIntoView, waitReady } from "./_viewer";

/** One finger down, `steps` moves, up — a real touch stream, subject to `touch-action`. */
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
  // Hold still, then lift. A finger that has stopped carries no velocity, so
  // the browser starts no fling: the gesture moves the page by exactly `dy` and
  // nothing keeps gliding underneath the assertions that follow.
  await page.waitForTimeout(200);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: from.x + dx, y: from.y + dy }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
}

forEachLocale((locale) =>
  test(`one finger scrolls the page; the rotate toggle orbits instead (${locale}) @webgl`, async ({
    page,
    isMobile,
    browserName,
  }) => {
    test.skip(
      !isMobile || browserName !== "chromium",
      "touch policy on Chromium phones (CDP touch input)",
    );
    await openViewer(page, locale);
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
      return {
        x: Math.round(left + (right - left) * fx),
        y: Math.round(top + (bottom - top) * fy),
      };
    };
    const center = await visiblePoint(0.5, 0.7);

    const saddleBefore = await page.evaluate(() => window.__va!.bike.screenPositionOf("saddle"));
    // One finger up the canvas. `pan-y` lets the browser claim it: the document
    // scrolls and the canvas never sees the move.
    await drag(page, cdp, center, 0, -180);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(40);

    // The viewer back at the top of the viewport before the second half: the
    // orbit assertions read the saddle's position ON SCREEN, and
    // `screenPositionOf` returns null for a point outside the viewport. Where the
    // first gesture happened to leave the page is not part of the policy — a
    // 390 px-tall landscape phone scrolled differently from a 839 px portrait one.
    await scrollViewerIntoView(page);

    // Then orbit with the toggle on. Clicking the button may scroll it into view
    // on a landscape phone, so the drag is compared against the scroll position
    // right before it, not against 0.
    await page.getByTestId("bike3d-rotate").click();
    await expect(page.getByTestId("bike3d-rotate")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("bike3d-canvas")).toHaveCSS("touch-action", "none");
    const from = await visiblePoint(0.5, 0.75);
    const before = await page.evaluate(() => window.__va!.bike.screenPositionOf("saddle"));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    // Up and across, in whole pixels rather than a fraction of the canvas (which
    // is 378 px wide in portrait and 812 px wide in landscape): the VERTICAL
    // component has to dominate, or `pan-y` would not have claimed this gesture
    // either and "the page did not move" would prove nothing. It is the gesture
    // the first half just scrolled the document with — here it must orbit instead.
    await drag(page, cdp, from, 60, -140);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    const after = await page.evaluate(() => window.__va!.bike.screenPositionOf("saddle"));
    expect(saddleBefore).not.toBeNull();
    expect(before).not.toBeNull();
    // The camera moved: the saddle is no longer where it was (or out of view).
    expect(
      after === null || Math.abs(after.x - before!.x) + Math.abs(after.y - before!.y) > 10,
    ).toBe(true);
  }),
);
