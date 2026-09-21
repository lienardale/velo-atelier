/**
 * Every part is clickable (§3.6 AC8): for each of the 7 presets, every rendered
 * part becomes `selectedPartId` after a canvas click from some camera pose
 * (`__va.bike.hittable`), and every hosted part (pads, tube, chainring…) is
 * reachable from its row in the list. In FR and EN: the harness around the
 * canvas, and the list rows a hosted part is picked from, are localized.
 */
import { PRESET_IDS, BIKE_PRESETS, answerWithDefaults, buildBikeSpec } from "../../../lib/domain";
import { partDefinition } from "../../../lib/domain/data/parts";
import { buildForSpec } from "../../../lib/domain/engine/parts-for-spec";
import { expect, forEachLocale, test } from "../_fixtures";
import { clickPart, openViewer, selectedPartId, waitReady } from "./_viewer";

forEachLocale((locale) => {
  for (const preset of PRESET_IDS) {
    test(`${preset}: every part is selectable (${locale}) @webgl`, async ({ page }) => {
      test.setTimeout(180_000);
      const build = buildForSpec(buildBikeSpec(answerWithDefaults(BIKE_PRESETS[preset])));
      await openViewer(page, locale, { preset });
      await waitReady(page);

      const rendered = await page.evaluate(() => window.__va!.bike.partIds);
      const expected = build.parts
        .map((p) => p.partId)
        .filter((id) => partDefinition(id)?.meshId !== null);
      expect([...rendered].sort()).toEqual([...expected].sort());

      for (const id of rendered) {
        // pointFor() raycasts the live scene, so the previous part's outline is accounted for.
        await clickPart(page, id);
        await expect.poll(() => selectedPartId(page), { message: `${preset}: ${id}` }).toBe(id);
      }

      const hosted = build.parts
        .map((p) => p.partId)
        .filter((id) => partDefinition(id)?.meshId === null);
      for (const id of hosted) {
        await page.locator(`[data-part-row="${id}"]`).click();
        await expect.poll(() => selectedPartId(page), { message: `${preset}: ${id}` }).toBe(id);
      }
    });
  }
});
