/**
 * No WebGL (§3.6 AC4, project `no-webgl`): the server-rendered SVG is the
 * product. It is there at first paint, every part is selectable with a click
 * or the keyboard, and a checkup (single part or picked parts) can be launched.
 */
import type { Locator } from "@playwright/test";

import { expect, forEachLocale, href, test } from "../_fixtures";
import { openViewer, partLabel } from "./_viewer";

/** Click the top of a ring-shaped part (a tyre, a rim), not the hub in its middle. */
async function clickRing(locator: Locator): Promise<void> {
  const box = (await locator.boundingBox())!;
  await locator.click({ position: { x: box.width / 2, y: 4 } });
}

forEachLocale((locale) => {
  test(`the SVG bike works without WebGL (${locale})`, async ({ page, request, webgl }) => {
    test.skip(webgl, "runs in the no-webgl project");

    // First paint: the silhouette is in the server HTML, before any script runs.
    const html = await (await request.get(href(locale, "/dev/bike3d"))).text();
    expect(html).toContain('data-testid="bike3d-svg"');
    expect(html).toContain('data-part-id="saddle"');

    await openViewer(page, locale);
    const viewer = page.getByTestId("bike3d-viewer");
    await expect(viewer).toHaveAttribute("data-state", "no-webgl");
    const svg = page.getByTestId("bike3d-svg");
    await expect(svg).toBeVisible();
    await expect(svg).toHaveAttribute("data-concealed", "false");
    await expect(page.getByTestId("bike3d-notice")).not.toBeEmpty();
    await expect(page.locator("canvas")).toHaveCount(0);

    // Click selects.
    await svg.locator('[data-part-id="saddle"]').click();
    await expect(viewer).toHaveAttribute("data-selected", "saddle");
    await expect(page).toHaveURL(/[?&]part=saddle(&|$)/);
    await expect(page.getByTestId("part-panel-title")).toHaveText(partLabel(locale, "saddle"));

    // Keyboard selects.
    await svg.locator('[data-part-id="chain"]').focus();
    await page.keyboard.press("Enter");
    await expect(viewer).toHaveAttribute("data-selected", "chain");

    // The checkup of that part can be launched.
    await expect(page.getByTestId("part-panel-checkup")).toHaveAttribute(
      "href",
      href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "chain" }),
    );

    // Partial checkup of picked parts.
    await page.getByTestId("mode-pick").click();
    // A tyre is a ring: its bounding-box centre is the hub, so click the ring itself.
    await clickRing(svg.locator('[data-part-id="tire-front"]'));
    await clickRing(svg.locator('[data-part-id="tire-rear"]'));
    await expect(page.getByTestId("picked-checkup")).toHaveAttribute(
      "href",
      href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "tire-front,tire-rear" }),
    );
  });
});
