/**
 * The checkup on a phone (§6.5, §6.8 AC5 and AC6).
 *
 * This is the page the product exists for: someone crouched next to a bike,
 * one hand on the frame, the other holding a phone. So the things that are
 * merely nice on a desktop are load-bearing here — the verdict bar within a
 * thumb's reach and clear of the home indicator, targets a thumb actually hits,
 * and a note field that does not make Safari zoom the page the moment it is
 * focused.
 *
 * The AC6 command runs this file on `desktop-chromium` too, and the sizes and
 * the sticky bar are worth asserting there as well; the one test that is about
 * TOUCH skips itself where there is no touch, rather than quietly degrading
 * into a mouse click that proves nothing.
 *
 * That test uses `tap()` (`Input.dispatchTouchEvent`) and is validated in the
 * CI container as well as here: `.debug/005` is the run where an input API that
 * works on macOS did nothing at all on Linux.
 *
 * Runs on `mobile-chromium` and, via `NARROW_SPECS`, on `mobile-narrow` (320 px).
 */
import type { Locator } from "@playwright/test";

import { expect, href, test } from "./_fixtures";
import { verdictFor } from "./_checkup";

const CHAIN_STEP = "check-drivetrain#chain-wear";

/** The smallest touch target §6.8 AC5 accepts, in CSS pixels. */
const TAP_MIN = 44;

/** One question, so every test gets to the verdict bar in two clicks. */
const CHAIN_CHECKUP = `${href("fr", "/velo/[id]/controle", { id: "demo" })}?parts=chain`;

test("a tap answers the question", async ({ page, hasTouch }) => {
  test.skip(!hasTouch, "this project has no touch input");

  await page.goto(CHAIN_CHECKUP);
  await page.getByTestId("checkup-start").tap();

  const card = page.getByTestId("step-card");
  await expect(card).toHaveAttribute("data-step-key", CHAIN_STEP);

  await page.getByTestId("verdict-ko").tap();
  await expect(page.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");

  await page.getByTestId("symptom-chain-elongation").tap();
  await expect(page.getByTestId("checkup-summary")).toBeVisible();
  await expect.poll(() => verdictFor(page, CHAIN_STEP)).toBe("ko");
});

test("every control a thumb has to hit is at least 44 x 44", async ({ page }) => {
  await page.goto(CHAIN_CHECKUP);

  // The tool checklist comes first: its rows are checkboxes.
  await expectTapTarget(page.locator("[data-tool-id] label").first());

  await page.getByTestId("checkup-start").click();
  for (const id of ["verdict-ok", "verdict-ko", "verdict-skip"]) {
    await expectTapTarget(page.getByTestId(id));
  }

  await page.getByTestId("verdict-ko").click();
  for (const reason of ["chain-elongation", "chain-dirty"]) {
    await expectTapTarget(page.getByTestId(`symptom-${reason}`));
  }
});

test("the note field does not make the browser zoom", async ({ page }) => {
  await page.goto(CHAIN_CHECKUP);
  await page.getByTestId("checkup-start").click();
  await page.getByTestId("verdict-ko").click();

  const fontSize = await page
    .getByTestId("symptom-note")
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
  // Below 16 px, iOS Safari zooms the viewport on focus and the visitor loses
  // the verdict bar (§6.8 AC5).
  expect(fontSize).toBeGreaterThanOrEqual(16);
});

test("the verdict bar stays on screen while the guide is scrolled", async ({ page }) => {
  await page.goto(CHAIN_CHECKUP);
  await page.getByTestId("checkup-start").click();

  const bar = page.getByTestId("verdict-bar");
  await expect(bar).toBeInViewport();

  // The scroll has to HAPPEN, or "the bar is still in view" is vacuously true
  // on a browser where the input API is inert — which is exactly how a green
  // local run turns into a green CI run that proves nothing (`.debug/005`).
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(bar).toBeInViewport();

  // §6.5: `min-h-14` — 3.5 rem, so a thumb has something to land on.
  const height = await bar.evaluate((node) => node.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(56);
});

async function expectTapTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBeGreaterThanOrEqual(TAP_MIN);
  expect(box?.height).toBeGreaterThanOrEqual(TAP_MIN);
}
