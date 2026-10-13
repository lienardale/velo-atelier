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

import { buildOf, deriveBike } from "../../lib/bike/rules";
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

async function withDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: resolveTestEnv().POSTGRES_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * A user with one gravel bike and nothing measured — the test's own, because
 * the Playwright projects share one database and the seeded bike is every
 * project's (label = locale + project).
 */
async function ownGravelBike(
  label: string,
  locale: Locale,
): Promise<{ user: { id: string; email: string; locale: Locale }; bikeId: string }> {
  return withDb(async (client) => {
    const email = `fit+${label}@velo-atelier.test`;
    const derived = deriveBike(GRAVEL);
    const build = buildOf(derived);
    const { rows: users } = await client.query<{ id: string }>(
      `INSERT INTO "User" (name, email, locale, "updatedAt") VALUES ($1, $2, $3, now())
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      ["Camille", email, locale],
    );
    const userId = users[0].id;
    await client.query(`DELETE FROM "Bike" WHERE "userId" = $1`, [userId]);
    const { rows: bikes } = await client.query<{ id: string }>(
      `INSERT INTO "Bike" ("userId", name, answers, spec, parts, "updatedAt")
       VALUES ($1, 'Gravel', $2, $3, $4, now()) RETURNING id`,
      [
        userId,
        JSON.stringify(derived.answers),
        JSON.stringify(build.spec),
        JSON.stringify(build.parts),
      ],
    );
    return { user: { id: userId, email, locale }, bikeId: bikes[0].id };
  });
}

/** Another device saves a measurement: the row changes, and this page is not told. */
async function saveElsewhere(bikeId: string, fit: Record<string, number>): Promise<void> {
  await withDb((client) =>
    client.query(`UPDATE "Bike" SET fit = $2::jsonb WHERE id = $1`, [bikeId, JSON.stringify(fit)]),
  );
}

/**
 * The page has read the GUEST bike out of storage — only then is typing safe.
 *
 * A server-rendered field is on screen before React holds it, and what is
 * typed into it then is in the DOM only. The render that follows hydration —
 * the one in which the local-bike snapshot resolves (`useLocalBikeSnapshot`,
 * whose server snapshot is "pending") — writes the form's state back over it.
 * Reproduced with the JS chunks held back: typed at 63 ms, empty after
 * hydration (`.debug/015` §2), and again on 2026-10-13 on the repaired form
 * (`.debug/018` §5): that half is React's, and still open.
 *
 * The other half was the form's, and was the CI flake of the English readout
 * on `mobile-webkit`: "74.2 cm" never appeared because an "84" typed with
 * React ALREADY attached was wiped when the snapshot resolved. Since
 * `.debug/018` the form keeps a field it has seen typed in. The wait stays for
 * the first half: the header's "Mon vélo" link reads the same key through its
 * own `useSyncExternalStore` and resolves in that same render, so once it
 * points at the local bike React holds the form and what is typed stays.
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

  /**
   * One form per card, all over ONE bike: saving a card must not take what is
   * typed in another (`.debug/018`).
   *
   * Typed with the keyboard on purpose. A guest's save writes `va:bike:local`
   * in this tab, which fires no `storage` event, so another card only noticed
   * at its own next render — the visitor's next keystroke there — and that
   * render re-seeded the card: ONE keystroke was eaten, with everything typed
   * before it. `fill` is a single event carrying the whole value and cannot
   * show which key went missing. Measured on the unfixed form, in Chromium:
   * "3" before the save then "8" → "", and "72" after it → "2".
   */
  test(`what is typed in one card survives the save of another, key by key (${locale})`, async ({
    page,
  }) => {
    const { specCode } = await seedLocalBike(page, GRAVEL);
    await page.goto(href(locale, "/velo/[id]/reglages", { id: "local" }, { spec: specCode }));
    await localBikeRead(page, locale);

    const reach = page.locator('[data-fit-field="reachMm"]');
    const rider = page.locator('[data-fit-field="riderKg"]');

    // Part of a number in the reach card, then the visitor saves the saddle card.
    await reach.pressSequentially("38");
    await page.locator('[data-fit-field="inseamCm"]').pressSequentially("84");
    await page.getByTestId("measure-form-saddle-height").getByRole("button").click();
    await expect(page.getByTestId("measure-state-saddle-height")).toHaveText(t.fit.saved);
    // The saved card shows what was stored, in the field nobody typed in too.
    await expect(page.locator('[data-fit-field="saddleHeightMm"]')).toHaveValue("742");

    // Typed before that save: still there, and the next key adds to it.
    await expect(reach).toHaveValue("38");
    await reach.pressSequentially("0");
    await expect(reach).toHaveValue("380");

    // Typed after it, in a card nobody had touched: the whole number.
    await rider.pressSequentially("72");
    await expect(rider).toHaveValue("72");

    // So what that card then stores is what was typed — and it took nothing
    // from the saddle card, nor the reach nobody has saved.
    await page.locator('[data-fit-field="bikeKg"]').pressSequentially("9");
    await page.getByTestId("measure-form-tire-pressure").getByRole("button").click();
    await expect(page.getByTestId("measure-state-tire-pressure")).toHaveText(t.fit.saved);
    const stored = await readStoredLocalBike(page);
    expect(stored?.fit).toEqual({ inseamCm: 84, saddleHeightMm: 742, riderKg: 72, bikeKg: 9 });
  });

  /**
   * A saved bike's cards lost theirs sooner: `updateBikeFitAction` revalidates,
   * its answer carries the page again, and the fresh `fit` re-seeded EVERY card
   * at the save itself ("38" in the reach card → "" under the other card's
   * "Enregistré", measured in Chromium on the unfixed form).
   *
   * "Enregistré" is the action's answer, not that render, so the test needs a
   * sign that the page has arrived before it can say the reach survived it: a
   * rider weight saved from another device in the meantime. Showing it is that
   * sign — and the other half of the rule, a field nobody typed in following
   * the record.
   */
  test(`a saved bike: the save of one card takes nothing typed in another, and an untouched field follows (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await ownGravelBike(`${locale}-${testInfo.project.name}`, locale);
    await signedInContext(user);
    await page.goto(href(locale, "/velo/[id]/reglages", { id: bikeId }));

    const reach = page.locator('[data-fit-field="reachMm"]');
    const rider = page.locator('[data-fit-field="riderKg"]');
    await owned(reach);
    await expect(rider).toHaveValue("");

    await reach.pressSequentially("38");
    await saveElsewhere(bikeId, { riderKg: 68 });

    await page.locator('[data-fit-field="inseamCm"]').pressSequentially("84");
    await page.getByTestId("measure-form-saddle-height").getByRole("button").click();
    await expect(page.getByTestId("measure-state-saddle-height")).toHaveText(t.fit.saved);
    await expect(rider).toHaveValue("68");

    await expect(reach).toHaveValue("38");
    await reach.pressSequentially("0");
    await expect(reach).toHaveValue("380");
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
