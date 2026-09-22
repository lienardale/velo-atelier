/**
 * The fit page (§6.8 AC12).
 *
 * One number carries the whole feature: a rider types their inseam, the page
 * says what saddle height that implies, and the bike remembers it. So the test
 * types 84 and checks three things a unit test cannot:
 *
 *   - the **formatted** value, which is `74,2 cm` in French and `74.2 cm` in
 *     English — the same `Intl` call the visitor sees, not a rounded number;
 *   - what actually reaches storage: `fit.saddleHeightMm === 742`, in
 *     millimetres, because that is what the viewer's solver reads;
 *   - that a saved bike's value survives a reload, which only happens if
 *     `updateBikeFitAction` really wrote the row.
 *
 * `?spec=` is on every link into this page for a guest bike (§5.4): the server
 * cannot read `localStorage`, so the spec travels in the URL and decides which
 * cards are drawn.
 */
/* eslint-disable security/detect-object-injection -- locale-keyed message fixtures, indexed by a Locale literal */
import type { Locator, Page } from "@playwright/test";
import { Client } from "pg";

import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import enBike from "../../messages/en/bike.json";
import enCommon from "../../messages/en/common.json";
import frBike from "../../messages/fr/bike.json";
import frCommon from "../../messages/fr/common.json";
import { DEMO_BIKE_GUEST_IDS, DEMO_USER } from "../../prisma/seed-data";
import { resolveTestEnv } from "../_fakes/db";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";
import { localBikePayload, readStoredLocalBike, seedLocalBike } from "./_local-bike";

const GRAVEL = BIKE_PRESETS["gravel-1x11"];

const BIKE_T: Record<Locale, typeof frBike> = { fr: frBike, en: enBike };
const COMMON_T: Record<Locale, typeof frCommon> = { fr: frCommon, en: enCommon };

/** 84 cm of inseam, formatted by the same `Intl` call the visitor sees. */
const SADDLE_READOUT: Record<Locale, string> = { fr: "74,2 cm", en: "74.2 cm" };

async function demoBikeId(): Promise<string> {
  const client = new Client({ connectionString: resolveTestEnv().POSTGRES_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `SELECT b.id FROM "Bike" b JOIN "User" u ON u.id = b."userId"
       WHERE u.email = $1 AND b."guestLocalId" = $2`,
      [DEMO_USER.email, DEMO_BIKE_GUEST_IDS.gravel],
    );
    if (rows.length !== 1) throw new Error(`expected 1 seeded gravel bike, found ${rows.length}`);
    return rows[0].id;
  } finally {
    await client.end();
  }
}

/**
 * The page has read the GUEST bike out of storage — only then is typing safe.
 *
 * `MeasurementForm` re-seeds its fields from `va:bike:local` in the render that
 * follows hydration, when the local-bike snapshot resolves
 * (`useLocalBikeSnapshot`, whose server snapshot is "pending"), and a value
 * typed before that render is overwritten. That was the CI flake of the English
 * readout on `mobile-webkit`: "74.2 cm" never appeared because the "84" had been
 * wiped. Reproduced with the JS chunks held back: typed at 63 ms, empty after
 * hydration — and on WebKit even with React already attached to the input
 * (`.debug/015`). The header's "Mon vélo" link reads the same key through its
 * own `useSyncExternalStore` and resolves in that same render, so once it
 * points at the local bike the form has been re-seeded and what is typed stays.
 */
async function localBikeRead(page: Page, locale: Locale): Promise<void> {
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: COMMON_T[locale].nav.myBike, includeHidden: true })
      .first(),
  ).toHaveAttribute("href", href(locale, "/velo/[id]", { id: "local" }));
}

/** React owns the input: a server-rendered field is on screen before it listens. */
async function owned(input: Locator): Promise<void> {
  await expect
    .poll(() =>
      input.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactProps"))),
    )
    .toBe(true);
}

forEachLocale((locale) => {
  const t = BIKE_T[locale];

  test(`an inseam of 84 cm suggests ${SADDLE_READOUT[locale]} and stores 742 mm (${locale})`, async ({
    page,
  }) => {
    const { specCode } = await seedLocalBike(page, GRAVEL);
    await page.goto(href(locale, "/velo/[id]/reglages", { id: "local" }, { spec: specCode }));
    await localBikeRead(page, locale);

    await page.locator('[data-fit-field="inseamCm"]').fill("84");
    await expect(page.getByTestId("readout-saddle-height")).toHaveText(SADDLE_READOUT[locale]);

    await page.getByTestId("measure-form-saddle-height").getByRole("button").click();
    await expect(page.getByTestId("measure-state-saddle-height")).toHaveText(t.fit.saved);

    const stored = await readStoredLocalBike(page);
    expect(stored?.fit).toMatchObject({ inseamCm: 84, saddleHeightMm: 742 });
  });

  test(`a saved bike keeps its fit across a reload (${locale})`, async ({
    page,
    signedInContext,
  }) => {
    await signedInContext();
    const id = await demoBikeId();
    await page.goto(href(locale, "/velo/[id]/reglages", { id }));

    // A saved bike's fit arrives as a prop, so nothing re-seeds the form after
    // hydration; what matters is that React, not just the DOM, has the value.
    const inseam = page.locator('[data-fit-field="inseamCm"]');
    await owned(inseam);
    await inseam.fill("84");
    await expect(page.getByTestId("readout-saddle-height")).toHaveText(SADDLE_READOUT[locale]);
    await page.getByTestId("measure-form-saddle-height").getByRole("button").click();
    await expect(page.getByTestId("measure-state-saddle-height")).toHaveText(t.fit.saved);

    await page.reload();
    await expect(page.locator('[data-fit-field="inseamCm"]')).toHaveValue("84");
    await expect(page.locator('[data-fit-field="saddleHeightMm"]')).toHaveValue("742");
  });

  test(`the cards offered follow the bike's own components (${locale})`, async ({ page }) => {
    // A rigid gravel bike has no sag to set; a full-suspension e-MTB does.
    const gravel = localBikePayload(GRAVEL);
    await page.goto(
      href(locale, "/velo/[id]/reglages", { id: "local" }, { spec: gravel.specCode }),
    );
    await expect(page.locator('[data-measure="saddle-height"]')).toBeVisible();
    await expect(page.locator('[data-measure="sag"]')).toHaveCount(0);

    const emtb = localBikePayload(BIKE_PRESETS["emtb-mid-1x12"]);
    await page.goto(href(locale, "/velo/[id]/reglages", { id: "local" }, { spec: emtb.specCode }));
    await expect(page.locator('[data-measure="sag"]')).toBeVisible();
  });

  test(`a tyre pressure is suggested from the rider's weight and the fitted tyre (${locale})`, async ({
    page,
  }) => {
    const { specCode } = await seedLocalBike(page, GRAVEL);
    await page.goto(href(locale, "/velo/[id]/reglages", { id: "local" }, { spec: specCode }));
    await localBikeRead(page, locale);

    await page.locator('[data-fit-field="riderKg"]').fill("75");
    await page.locator('[data-fit-field="bikeKg"]').fill("9");
    // "bar" in both locales: the unit, not a translated word.
    await expect(page.getByTestId("readout-tire-pressure")).toContainText("bar");
  });

  test(`the demo bike shows the cards but refuses to remember anything (${locale})`, async ({
    page,
  }) => {
    await page.goto(href(locale, "/velo/[id]/reglages", { id: "demo" }));

    await expect(page.locator('[data-measure="saddle-height"]')).toBeVisible();
    await expect(page.locator('[data-fit-field="inseamCm"]')).toBeDisabled();
    await expect(page.getByTestId("measure-form-saddle-height")).toContainText(t.fit.demoNotice);
  });

  test(`a guest bike reached without ?spec= is sent back to the bike (${locale})`, async ({
    page,
  }) => {
    await page.goto(href(locale, "/velo/[id]/reglages", { id: "local" }));
    await expect(page.getByTestId("fit-back-to-bike")).toBeVisible();
    await expect(page.locator("[data-measure]")).toHaveCount(0);
  });

  test(`a forged ?spec= is ignored rather than trusted (${locale})`, async ({ page }) => {
    await page.goto(
      href(locale, "/velo/[id]/reglages", { id: "local" }, { spec: "AAAAAAAAAAAAAAAAAAAAAAA" }),
    );
    await expect(page.getByTestId("fit-back-to-bike")).toBeVisible();
    await expect(page.locator("[data-measure]")).toHaveCount(0);
  });

  test(`the inputs are decimal keypads at 16 px, so iOS does not zoom the page (${locale})`, async ({
    page,
  }) => {
    const { specCode } = await seedLocalBike(page, GRAVEL);
    await page.goto(href(locale, "/velo/[id]/reglages", { id: "local" }, { spec: specCode }));

    const inputs = page.locator("[data-fit-field]");
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index++) {
      const input = inputs.nth(index);
      await expect(input).toHaveAttribute("inputmode", "decimal");
      const fontSize = await input.evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).fontSize),
      );
      expect(fontSize).toBeGreaterThanOrEqual(16);
    }
  });
});
