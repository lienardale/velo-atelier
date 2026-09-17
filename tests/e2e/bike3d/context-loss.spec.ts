/**
 * WebGL context loss (§3.3): the viewer swaps back to the interactive SVG with
 * a "reload 3D" button; the reload brings the canvas back; after a second loss
 * it stays on the SVG for good.
 */
import { expect, forEachLocale, test } from "../_fixtures";
import { openViewer, waitReady } from "./_viewer";

forEachLocale((locale) => {
  test(`context loss falls back to the SVG, twice at most (${locale})`, async ({ page, webgl }) => {
    test.skip(!webgl, "needs a WebGL context to lose");
    await openViewer(page, locale);
    await waitReady(page);
    const viewer = page.getByTestId("bike3d-viewer");
    const svg = page.getByTestId("bike3d-svg");
    await expect(svg).toHaveAttribute("data-concealed", "true");

    expect(await page.evaluate(() => window.__va!.bike.loseContext())).toBe(true);
    await expect(viewer).toHaveAttribute("data-state", "context-lost");
    await expect(svg).toHaveAttribute("data-concealed", "false");
    await expect(page.locator("canvas")).toHaveCount(0);
    // Still usable while the 3D is gone.
    await svg.locator('[data-part-id="saddle"]').click();
    await expect(viewer).toHaveAttribute("data-selected", "saddle");

    await page.getByTestId("bike3d-reload").click();
    await waitReady(page);
    expect(await page.evaluate(() => window.__va!.perf.contextCreations)).toBe(2);
    expect(await page.evaluate(() => window.__va!.bike.selectedPartId)).toBe("saddle");

    expect(await page.evaluate(() => window.__va!.bike.loseContext())).toBe(true);
    await expect(viewer).toHaveAttribute("data-state", "context-lost");
    await expect(page.getByTestId("bike3d-reload")).toHaveCount(0);
    await expect(page.getByTestId("bike3d-notice")).not.toBeEmpty();
    await page.evaluate(() => window.__va!.bike.restoreContext());
    await page.waitForTimeout(500);
    await expect(page.locator("canvas")).toHaveCount(0);
  });
});
