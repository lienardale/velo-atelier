/**
 * The workspace on a phone (§6.8 AC5).
 *
 * Below 1024 px the viewer sits on top and the parts panel becomes a bottom
 * sheet — the only scrolling container on the page. Four properties decide
 * whether that is usable, and all four are things a desktop run cannot see:
 *
 *   1. the viewer never takes more than 60 svh, so there is always sheet left;
 *   2. the sheet's position is observable (`data-snap`) and reachable by drag
 *      AND by keyboard — a drag-only sheet is unusable with a switch or a
 *      keyboard;
 *   3. a selection made on the canvas opens the sheet to its half position and
 *      marks the row, without stealing the tab (§6.4);
 *   4. nothing overflows sideways and nothing is smaller than 44 px, at 412 px
 *      and at 320 px alike.
 */
import { BIKE_PRESETS } from "../../lib/domain/data/presets";

import { expect, forEachLocale, href, test } from "./_fixtures";
import { seedLocalBike } from "./_local-bike";

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, "the bottom sheet only exists below 1024 px");
  // A landscape phone has no vertical room for a sheet, so §6.4 gives it the
  // two-column grid instead (`MEDIA.shortViewport`, max-height: 500px).
  test.skip(
    (page.viewportSize()?.height ?? 0) <= 500,
    "landscape phones use the docked grid, not the sheet (§6.4)",
  );
});

const sheet = "[data-testid=parts-sheet]";
const handle = `${sheet} [data-slot=mobile-sheet-handle]`;

forEachLocale((locale) => {
  const demo = href(locale, "/velo/[id]", { id: "demo" });

  test(`the viewer leaves at least 40 svh to the sheet (${locale})`, async ({ page }) => {
    await page.goto(demo);
    // The silhouette fills the reserved box, so its height IS the viewer's height
    // whether or not the 3D canvas has mounted yet.
    const box = await page.getByTestId("bike3d-svg").boundingBox();
    const viewport = page.viewportSize()!;

    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(viewport.height * 0.6 + 1);
  });

  test(`the sheet reports where it is and moves when the handle is dragged (${locale})`, async ({
    page,
  }) => {
    await page.goto(demo);
    await expect(page.locator(sheet)).toHaveAttribute("data-snap", "1");

    const box = (await page.locator(handle).boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // Up 300 px: the sheet grows.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y - 300, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator(sheet)).toHaveAttribute("data-snap", "2");

    // Down 300 px from wherever the handle is now: it shrinks again. The sheet
    // animates for `--sheet-duration`, so its box has to settle before it is read
    // — a drag from a mid-animation position lands somewhere else entirely. Wait
    // for the transition itself to finish, not for a fixed time: a fixed 400 ms
    // failed about one run in twelve on a loaded machine (W4 integration).
    await expect
      .poll(() =>
        page
          .locator(sheet)
          .evaluate(
            (node) =>
              node.getAnimations().filter((animation) => animation.playState === "running").length,
          ),
      )
      .toBe(0);
    const after = (await page.locator(handle).boundingBox())!;
    await page.mouse.move(after.x + after.width / 2, after.y + after.height / 2);
    await page.mouse.down();
    await page.mouse.move(after.x + after.width / 2, after.y + after.height / 2 + 300, {
      steps: 12,
    });
    await page.mouse.up();
    await expect(page.locator(sheet)).not.toHaveAttribute("data-snap", "2");
  });

  test(`the sheet is fully operable from the keyboard (${locale})`, async ({ page }) => {
    await page.goto(demo);
    const button = page.locator(handle);

    await button.focus();
    await expect(button).toHaveAttribute("aria-controls", "parts-sheet");

    await page.keyboard.press("ArrowUp");
    await expect(page.locator(sheet)).toHaveAttribute("data-snap", "2");
    await expect(button).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Home");
    await expect(page.locator(sheet)).toHaveAttribute("data-snap", "0");
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test(`tapping a part on the canvas opens the sheet and marks its row (${locale}) @webgl`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "needs the SwiftShader canvas and window.__va");
    await page.goto(demo);
    await page.waitForFunction(() => window.__va?.bike.ready === true, undefined, {
      timeout: 30_000,
    });

    // Collapse it first, so "opens the sheet" is something the tap has to do.
    await page.locator(handle).focus();
    await page.keyboard.press("Home");
    await expect(page.locator(sheet)).toHaveAttribute("data-snap", "0");

    const point = await page.evaluate(() => {
      const bike = window.__va!.bike;
      const here = bike.screenPositionOf("brake-caliper-front");
      if (here) return here;
      for (const pose of ["drive-side", "non-drive-side", "front", "rear"]) {
        // The point `hittable` found from that pose — not `screenPositionOf(pose)`,
        // which takes a PART id and answered null for every pose name, so this
        // fallback used to skip the test whenever the first pose hid the caliper.
        const found = bike.hittable(pose);
        if (Object.hasOwn(found, "brake-caliper-front")) return found["brake-caliper-front"]!;
      }
      return null;
    });
    test.skip(point === null, "the front caliper is not reachable from any pose in this viewport");
    await page.touchscreen.tap(point!.x, point!.y);

    // `> div > button` is the caliper's OWN row: hosted parts (the pads) are
    // nested inside its `<li>`, so an unscoped descendant selector matches both.
    await expect(page.locator("[data-part-id=brake-caliper-front] > div > button")).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(page.locator(sheet)).toHaveAttribute("data-snap", "1");
    // The canvas never steals the tab: the row must still be on screen to scroll to.
    await expect(page.getByTestId("parts-list")).toBeVisible();
  });
});

forEachLocale((locale) => {
  test(`nothing overflows sideways and every control is thumb-sized (${locale})`, async ({
    page,
  }) => {
    await seedLocalBike(page, BIKE_PRESETS["gravel-1x11"]);
    await page.goto(href(locale, "/velo/[id]", { id: "local" }));
    await expect(page.getByTestId("parts-list")).toBeVisible();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    expect(clientWidth).toBe(page.viewportSize()!.width);

    // Every row button and the sheet handle are 44 CSS px tall at least; a
    // native checkbox is smaller by design, so what has to be 44 px is the ROW
    // it sits in — which is what a thumb actually aims at (§6.8 AC5).
    const tall = page.locator(
      "[data-part-row], [data-slot=mobile-sheet-handle], [data-testid=parts-panel] [role=tab]",
    );
    const tallCount = await tall.count();
    expect(tallCount).toBeGreaterThan(5);
    for (let index = 0; index < tallCount; index++) {
      const target = tall.nth(index);
      const box = await target.boundingBox();
      if (box === null) continue; // inside a collapsed group
      const label = (await target.getAttribute("data-part-row")) ?? `control ${index}`;
      // Rounded: `min-h: 2.75rem` measures 43.9998 px at this device pixel ratio,
      // and a test that fails on a rounding error teaches nothing.
      expect(
        Math.round(box.height),
        `${label} is ${box.width}×${box.height}`,
      ).toBeGreaterThanOrEqual(44);
    }

    const checkboxRows = page.locator("[data-part-id] > div");
    const rowCount = await checkboxRows.count();
    for (let index = 0; index < rowCount; index++) {
      const box = await checkboxRows.nth(index).boundingBox();
      if (box === null) continue;
      expect(Math.round(box.height), `checkbox row ${index}`).toBeGreaterThanOrEqual(44);
    }
  });
});
