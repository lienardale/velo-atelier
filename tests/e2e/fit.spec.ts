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
import { Client } from "pg";

import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import { DEMO_BIKE_GUEST_IDS, DEMO_USER } from "../../prisma/seed-data";
import { resolveTestEnv } from "../_fakes/db";

import { expect, href, test } from "./_fixtures";
import { localBikePayload, readStoredLocalBike, seedLocalBike } from "./_local-bike";

const GRAVEL = BIKE_PRESETS["gravel-1x11"];

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

test("an inseam of 84 cm suggests 74,2 cm and stores 742 mm (fr)", async ({ page }) => {
  const { specCode } = await seedLocalBike(page, GRAVEL);
  await page.goto(href("fr", "/velo/[id]/reglages", { id: "local" }, { spec: specCode }));

  await page.locator('[data-fit-field="inseamCm"]').fill("84");
  await expect(page.getByTestId("readout-saddle-height")).toHaveText("74,2 cm");

  await page.getByTestId("measure-form-saddle-height").getByRole("button").click();
  await expect(page.getByTestId("measure-state-saddle-height")).toHaveText("Enregistré");

  const stored = await readStoredLocalBike(page);
  expect(stored?.fit).toMatchObject({ inseamCm: 84, saddleHeightMm: 742 });
});

test("the English page says 74.2 cm for the same inseam", async ({ page }) => {
  const { specCode } = await seedLocalBike(page, GRAVEL);
  await page.goto(href("en", "/velo/[id]/reglages", { id: "local" }, { spec: specCode }));

  await page.locator('[data-fit-field="inseamCm"]').fill("84");
  await expect(page.getByTestId("readout-saddle-height")).toHaveText("74.2 cm");
});

test("a saved bike keeps its fit across a reload", async ({ page, signedInContext }) => {
  await signedInContext();
  const id = await demoBikeId();
  await page.goto(href("fr", "/velo/[id]/reglages", { id }));

  await page.locator('[data-fit-field="inseamCm"]').fill("84");
  await page.getByTestId("measure-form-saddle-height").getByRole("button").click();
  await expect(page.getByTestId("measure-state-saddle-height")).toHaveText("Enregistré");

  await page.reload();
  await expect(page.locator('[data-fit-field="inseamCm"]')).toHaveValue("84");
  await expect(page.locator('[data-fit-field="saddleHeightMm"]')).toHaveValue("742");
});

test("the cards offered follow the bike's own components", async ({ page }) => {
  // A rigid gravel bike has no sag to set; a full-suspension e-MTB does.
  const gravel = localBikePayload(GRAVEL);
  await page.goto(href("fr", "/velo/[id]/reglages", { id: "local" }, { spec: gravel.specCode }));
  await expect(page.locator('[data-measure="saddle-height"]')).toBeVisible();
  await expect(page.locator('[data-measure="sag"]')).toHaveCount(0);

  const emtb = localBikePayload(BIKE_PRESETS["emtb-mid-1x12"]);
  await page.goto(href("fr", "/velo/[id]/reglages", { id: "local" }, { spec: emtb.specCode }));
  await expect(page.locator('[data-measure="sag"]')).toBeVisible();
});

test("a tyre pressure is suggested from the rider's weight and the fitted tyre", async ({
  page,
}) => {
  const { specCode } = await seedLocalBike(page, GRAVEL);
  await page.goto(href("fr", "/velo/[id]/reglages", { id: "local" }, { spec: specCode }));

  await page.locator('[data-fit-field="riderKg"]').fill("75");
  await page.locator('[data-fit-field="bikeKg"]').fill("9");
  await expect(page.getByTestId("readout-tire-pressure")).toContainText("bar");
});

test("the demo bike shows the cards but refuses to remember anything", async ({ page }) => {
  await page.goto(href("fr", "/velo/[id]/reglages", { id: "demo" }));

  await expect(page.locator('[data-measure="saddle-height"]')).toBeVisible();
  await expect(page.locator('[data-fit-field="inseamCm"]')).toBeDisabled();
  await expect(page.getByTestId("measure-form-saddle-height")).toContainText("copie locale");
});

test("a guest bike reached without ?spec= is sent back to the bike", async ({ page }) => {
  await page.goto(href("fr", "/velo/[id]/reglages", { id: "local" }));
  await expect(page.getByTestId("fit-back-to-bike")).toBeVisible();
  await expect(page.locator("[data-measure]")).toHaveCount(0);
});

test("a forged ?spec= is ignored rather than trusted", async ({ page }) => {
  await page.goto(
    href("fr", "/velo/[id]/reglages", { id: "local" }, { spec: "AAAAAAAAAAAAAAAAAAAAAAA" }),
  );
  await expect(page.getByTestId("fit-back-to-bike")).toBeVisible();
  await expect(page.locator("[data-measure]")).toHaveCount(0);
});

test("the inputs are decimal keypads at 16 px, so iOS does not zoom the page", async ({ page }) => {
  const { specCode } = await seedLocalBike(page, GRAVEL);
  await page.goto(href("fr", "/velo/[id]/reglages", { id: "local" }, { spec: specCode }));

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
