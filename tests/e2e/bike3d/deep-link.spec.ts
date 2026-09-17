/**
 * Deep links (§3.5): `?part=chain` opens with the chain selected and named in
 * the panel; `?part=bogus` opens with nothing selected and no error; picks
 * survive a reload through `?parts=`.
 */
import { expect, forEachLocale, test } from "../_fixtures";
import { openViewer, partLabel, selectedPartId, waitReady } from "./_viewer";

forEachLocale((locale) => {
  test(`?part=chain opens with the chain selected (${locale}) @webgl`, async ({ page }) => {
    await openViewer(page, locale, { part: "chain" });
    // Before and after the 3D is up.
    await expect(page.getByTestId("part-panel-title")).toHaveText(partLabel(locale, "chain"));
    await waitReady(page);
    expect(await selectedPartId(page)).toBe("chain");
    await expect
      .poll(() => page.evaluate(() => window.__va!.bike.materialOf("chain")))
      .toBe("highlightSelected");
  });

  test(`?part=bogus is ignored without an error (${locale}) @webgl`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openViewer(page, locale, { part: "bogus", parts: "__proto__,saddle", mode: "pick" });
    await waitReady(page);
    expect(await selectedPartId(page)).toBeNull();
    await expect(page.getByTestId("part-panel-empty")).toBeVisible();
    expect(await page.evaluate(() => window.__va!.bike.pickedPartIds)).toEqual(["saddle"]);
    expect(errors).toEqual([]);
  });

  test(`picks and selection survive a reload (${locale}) @webgl`, async ({ page }) => {
    await openViewer(page, locale, { mode: "pick" });
    await waitReady(page);
    await page.locator('[data-part-row="chain"]').click();
    await page.getByTestId("dev-pick-chain").check();
    await page.getByTestId("dev-pick-saddle").check();
    await expect(page).toHaveURL(
      /part=chain.*parts=chain%2Csaddle|parts=chain%2Csaddle.*part=chain/,
    );
    await page.reload();
    await waitReady(page);
    expect(await selectedPartId(page)).toBe("chain");
    expect(await page.evaluate(() => window.__va!.bike.pickedPartIds)).toEqual(["chain", "saddle"]);
  });
});
