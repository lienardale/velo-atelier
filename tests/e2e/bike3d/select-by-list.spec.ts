/**
 * Select a part from the list with the keyboard (§3.6 AC3): the list is the
 * accessible mirror of the canvas. Enter on a row selects the part (with a
 * camera focus), sets `?part=`, localizes the panel title, and never triggers
 * an RSC fetch.
 */
import { expect, forEachLocale, test } from "../_fixtures";
import { openViewer, partLabel, selectedPartId, waitReady, watchRsc } from "./_viewer";

const SEQUENCE = [
  "chain",
  "brake-pads-front",
  "frame",
  "sealant",
  "saddle",
  "rotor-rear",
  "stem",
  "cassette",
  "fork",
  "saddle",
];

forEachLocale((locale) => {
  test(`keyboard selection from the list (${locale}) @webgl`, async ({ page }) => {
    await openViewer(page, locale);
    await waitReady(page);
    const rsc = watchRsc(page, { onlyViewerPage: true });

    const row = page.locator('[data-part-row="saddle"]');
    await row.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => selectedPartId(page)).toBe("saddle");
    await expect(page).toHaveURL(/[?&]part=saddle(&|$)/);
    await expect(page.getByTestId("part-panel-title")).toHaveText(partLabel(locale, "saddle"));
    await expect(row).toHaveAttribute("aria-current", "true");

    for (const id of SEQUENCE) {
      await page.locator(`[data-part-row="${id}"]`).focus();
      await page.keyboard.press(id.length % 2 === 0 ? "Enter" : "Space");
      await expect.poll(() => selectedPartId(page)).toBe(id);
    }
    // A hosted part lights its host.
    await page.locator('[data-part-row="brake-pads-front"]').focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => window.__va!.bike.materialOf("brake-caliper-front")))
      .toBe("highlightSelected");
    await expect(page.getByTestId("part-panel-title")).toHaveText(
      partLabel(locale, "brake-pads-front"),
    );
    expect(rsc, "selections must not fetch RSC payloads").toEqual([]);
  });
});
