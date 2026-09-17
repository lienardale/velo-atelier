/**
 * Pick mode (§3.3): taps toggle parts in and out of a partial checkup, the
 * picks tint the meshes, `?parts=` follows, and the host can launch a checkup
 * of exactly the picked parts.
 */
import { expect, forEachLocale, href, test } from "../_fixtures";
import { clickPart, openViewer, waitReady } from "./_viewer";

forEachLocale((locale) => {
  test(`pick mode toggles parts for a partial checkup (${locale}) @webgl`, async ({ page }) => {
    await openViewer(page, locale);
    await waitReady(page);
    await page.getByTestId("mode-pick").click();
    await expect(page.getByTestId("bike3d-viewer")).toHaveAttribute("data-mode", "pick");

    await clickPart(page, "chain");
    await clickPart(page, "saddle");
    await expect
      .poll(() => page.evaluate(() => window.__va!.bike.pickedPartIds))
      .toEqual(["chain", "saddle"]);
    await expect(page).toHaveURL(/[?&]parts=chain%2Csaddle(&|$)/);

    const launch = page.getByTestId("picked-checkup");
    const target = href(locale, "/velo/[id]/controle", { id: "demo" }, { parts: "chain,saddle" });
    await expect(launch).toHaveAttribute("href", target);

    await clickPart(page, "chain");
    await expect
      .poll(() => page.evaluate(() => window.__va!.bike.pickedPartIds))
      .toEqual(["saddle"]);
    // Chain is selected (last tap) but no longer picked; saddle keeps the pick tint.
    await expect
      .poll(() => page.evaluate(() => window.__va!.bike.materialOf("saddle")))
      .toBe("highlightPicked");

    await page.getByTestId("mode-browse").click();
    await expect.poll(() => page.evaluate(() => window.__va!.bike.pickedPartIds)).toEqual([]);
    await expect(page).not.toHaveURL(/parts=/);
  });
});
