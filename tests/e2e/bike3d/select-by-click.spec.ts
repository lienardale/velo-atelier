/**
 * Select a part by clicking / tapping it in the 3D canvas (§3.6 AC3).
 *
 * A tap sets `?part=` with history.replaceState, the host panel shows the
 * localized part name, and ten selections cause zero `?_rsc=` requests (no
 * router round-trip per click).
 */
import { expect, forEachLocale, test } from "../_fixtures";
import { clickPart, openViewer, partLabel, selectedPartId, waitReady, watchRsc } from "./_viewer";

const SEQUENCE = [
  "chain",
  "frame",
  "tire-front",
  "saddle",
  "handlebar",
  "crankset",
  "fork",
  "tire-rear",
  "stem",
  "saddle",
];

forEachLocale((locale) => {
  test(`tap selects a part, sets ?part= and shows it in the panel (${locale}) @webgl`, async ({
    page,
  }) => {
    await openViewer(page, locale);
    await waitReady(page);
    const rsc = watchRsc(page);

    await clickPart(page, "saddle");
    await expect.poll(() => selectedPartId(page)).toBe("saddle");
    await expect(page).toHaveURL(/[?&]part=saddle(&|$)/);
    await expect(page.getByTestId("part-panel-title")).toHaveText(partLabel(locale, "saddle"));

    for (const id of SEQUENCE) {
      await clickPart(page, id);
      await expect.poll(() => selectedPartId(page)).toBe(id);
    }
    await expect(page).toHaveURL(/[?&]part=saddle(&|$)/);
    await expect(page.getByTestId("part-panel-title")).toHaveText(partLabel(locale, "saddle"));
    expect(rsc, "selections must not fetch RSC payloads").toEqual([]);
  });
});
