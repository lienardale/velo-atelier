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
 * The sticky bar is scrolled against by script, which every engine supports:
 * `mouse.wheel` is refused outright by mobile WebKit, which is the whole reason
 * this file used to fail on `mobile-webkit` (never the layout — see
 * `.debug/015`).
 *
 * Runs on every e2e project — the phones (`mobile-chromium`, `mobile-landscape`,
 * `mobile-webkit`, and `mobile-narrow` at 320 px via `NARROW_SPECS`) and the two
 * desktop ones — in FR and EN.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, forEachLocale, href, test } from "./_fixtures";
import { verdictFor } from "./_checkup";

const CHAIN_STEP = "check-drivetrain#chain-wear";

/** The smallest touch target §6.8 AC5 accepts, in CSS pixels. */
const TAP_MIN = 44;

/** Where the verdict bar is, against the viewport and the step it scrolls with. */
interface BarLayout {
  scrollY: number;
  viewport: number;
  barBottom: number;
  /** The guide step's top edge — what moves when the document scrolls. */
  bodyTop: number;
  /** The wizard's bottom edge: the bar is sticky INSIDE it, so it cannot pass it. */
  wizardBottom: number;
}

function barLayout(page: Page): Promise<BarLayout> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('[data-testid="verdict-bar"]')!;
    const body = document.querySelector<HTMLElement>('[data-testid="step-body"]')!;
    return {
      scrollY: window.scrollY,
      viewport: window.innerHeight,
      barBottom: bar.getBoundingClientRect().bottom,
      bodyTop: body.getBoundingClientRect().top,
      wizardBottom: bar.parentElement!.getBoundingClientRect().bottom,
    };
  });
}

forEachLocale((locale) => {
  /** One question, so every test gets to the verdict bar in two clicks. */
  const chainCheckup = `${href(locale, "/velo/[id]/controle", { id: "demo" })}?parts=chain`;

  test(`a tap answers the question (${locale})`, async ({ page, hasTouch }) => {
    test.skip(!hasTouch, "this project has no touch input");

    await page.goto(chainCheckup);
    await page.getByTestId("checkup-start").tap();

    const card = page.getByTestId("step-card");
    await expect(card).toHaveAttribute("data-step-key", CHAIN_STEP);

    await page.getByTestId("verdict-ko").tap();
    await expect(page.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");

    await page.getByTestId("symptom-chain-elongation").tap();
    await expect(page.getByTestId("checkup-summary")).toBeVisible();
    await expect.poll(() => verdictFor(page, CHAIN_STEP)).toBe("ko");
  });

  test(`every control a thumb has to hit is at least 44 x 44 (${locale})`, async ({ page }) => {
    await page.goto(chainCheckup);

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

  test(`the note field does not make the browser zoom (${locale})`, async ({ page }) => {
    await page.goto(chainCheckup);
    await page.getByTestId("checkup-start").click();
    await page.getByTestId("verdict-ko").click();

    const fontSize = await page
      .getByTestId("symptom-note")
      .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
    // Below 16 px, iOS Safari zooms the viewport on focus and the visitor loses
    // the verdict bar (§6.8 AC5).
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });

  test(`the verdict bar stays pinned on screen while the guide scrolls under it (${locale})`, async ({
    page,
  }) => {
    await page.goto(chainCheckup);
    await page.getByTestId("checkup-start").click();

    const bar = page.getByTestId("verdict-bar");
    await expect(bar).toBeInViewport();

    const before = await barLayout(page);
    // A step taller than the screen, or there is nothing to hold the bar against.
    const room = before.wizardBottom - before.viewport;
    expect(room, "the step fits on the screen: nothing scrolls under the bar").toBeGreaterThan(100);
    // Pinned to the bottom edge, not merely somewhere in view: `toBeInViewport`
    // alone also passes for a bar that scrolled back to the end of a short page.
    expect(Math.abs(before.barBottom - before.viewport), "not pinned before").toBeLessThanOrEqual(
      1,
    );

    // Scrolled by script, not by an input device: `mouse.wheel` does not exist in
    // mobile WebKit — all three attempts failed with "Mouse wheel is not
    // supported in mobile WebKit" (CI run 35550216873) — and `position: sticky`
    // is layout, indifferent to what moved the document. The scroll stays inside
    // the step, so the wizard's own end (where the bar parks) is still below.
    const delta = Math.min(600, Math.floor(room) - 20);
    await page.evaluate((dy) => window.scrollBy(0, dy), delta);
    // The scroll has to HAPPEN, or "still on screen" is vacuously true on a
    // browser where the scroll did nothing (`.debug/005`).
    await expect
      .poll(async () => (await barLayout(page)).scrollY)
      .toBeGreaterThan(before.scrollY + delta / 2);

    const after = await barLayout(page);
    expect(before.bodyTop - after.bodyTop, "the guide did not move").toBeGreaterThan(delta / 2);
    expect(
      Math.abs(after.barBottom - after.viewport),
      "the bar moved with the guide instead of staying pinned",
    ).toBeLessThanOrEqual(1);
    await expect(bar).toBeInViewport({ ratio: 1 });

    // §6.5: `min-h-14` — 3.5 rem, so a thumb has something to land on.
    const height = await bar.evaluate((node) => node.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(56);
  });
});

async function expectTapTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBeGreaterThanOrEqual(TAP_MIN);
  expect(box?.height).toBeGreaterThanOrEqual(TAP_MIN);
}
