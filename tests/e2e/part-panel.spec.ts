/**
 * The part panel of the workspace (§6.8 AC11).
 *
 * The claim under test is that **one** panel serves three different bikes: the
 * guest bike in `localStorage`, a saved bike behind a server action, and the
 * read-only demo. Same component, same interaction, three destinations — so
 * each of them is driven here exactly as a visitor would, and the result is read
 * back from where it actually landed (storage for `local`, a reload for the
 * saved bike, which only proves anything if the action really wrote).
 *
 * The guide links are the other half: "Changer / Nettoyer / Régler" must point
 * at the guides `guidesFor()` resolves for THIS bike — a tubeless gravel bike is
 * offered the tubeless tyre guide, not the inner-tube one — and every one of
 * them must answer 200 in both locales.
 */
import type { Page } from "@playwright/test";
import { Client } from "pg";

import { guidesFor } from "../../lib/bike/queries";
import { buildOf, deriveBike } from "../../lib/bike/rules";
import { toSummary } from "../../lib/content/guides";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import { DEMO_BIKE_GUEST_IDS, DEMO_USER } from "../../prisma/seed-data";
import { resolveTestEnv } from "../_fakes/db";
import { diskGuides } from "../_helpers/guides";
import enBike from "../../messages/en/bike.json";
import frBike from "../../messages/fr/bike.json";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";
import { seedLocalBike } from "./_local-bike";

const BIKE_T = { fr: frBike, en: enBike };

/** Below 1024 px the panel is inside the bottom sheet; open it fully first. */
async function expandSheetIfPresent(page: Page): Promise<void> {
  const handle = page.locator("[data-testid=parts-sheet] [data-slot=mobile-sheet-handle]");
  if ((await handle.count()) === 0) return;
  await handle.focus();
  await page.keyboard.press("End");
  await expect(page.locator("[data-testid=parts-sheet]")).toHaveAttribute("data-snap", "2");
}

const build = buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"]));

/** The gravel bike of the seeded French demo account. */
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

forEachLocale((locale) => {
  test(`the guest bike's cassette can be edited and the edit survives a reload (${locale})`, async ({
    page,
  }) => {
    await seedLocalBike(page, BIKE_PRESETS["gravel-1x11"]);
    await page.goto(href(locale, "/velo/[id]", { id: "local" }));

    // Inspecting a row opens the Infos tab on the part it names.
    await page.locator('[data-part-row="cassette"]').click();
    await expect(page.getByTestId("part-panel-title")).toHaveText(
      locale === "fr" ? "Cassette" : "Cassette",
    );
    await expect(page.getByTestId("part-attributes")).toBeVisible();
    await expect(page.locator('[data-attr-row="speeds"]')).toBeVisible();

    await page.locator('[data-attr="range"]').selectOption("11-36");
    await expect(page.getByTestId("attr-status-range")).toHaveText(
      locale === "fr" ? "Enregistré" : "Saved",
    );

    await page.reload();
    await page.locator('[data-part-row="cassette"]').click();
    await expect(page.locator('[data-attr="range"]')).toHaveValue("11-36");

    // …and it is in storage, not just in the DOM.
    const stored = await page.evaluate(() => {
      const raw = window.localStorage.getItem("va:bike:local");
      const parts = JSON.parse(raw!).parts as { partId: string; attributes: { range?: string } }[];
      return parts.find((part) => part.partId === "cassette")?.attributes.range;
    });
    expect(stored).toBe("11-36");
  });

  test(`a saved bike's edit goes through the server action (${locale})`, async ({
    page,
    signedInContext,
  }) => {
    await signedInContext();
    const id = await demoBikeId();
    await page.goto(href(locale, "/velo/[id]", { id }));

    await page.locator('[data-part-row="cassette"]').click();
    await page.locator('[data-attr="range"]').selectOption("11-36");
    await expect(page.getByTestId("attr-status-range")).toHaveText(
      locale === "fr" ? "Enregistré" : "Saved",
    );

    // A reload re-reads the row: if the action had not written, this fails.
    await page.reload();
    await page.locator('[data-part-row="cassette"]').click();
    await expect(page.locator('[data-attr="range"]')).toHaveValue("11-36");

    // Nothing was written to the browser — a saved bike never touches localStorage.
    expect(await page.evaluate(() => window.localStorage.getItem("va:bike:local"))).toBeNull();
  });

  test(`the demo bike offers a local copy instead of a form (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/velo/[id]", { id: "demo" }));
    await page.locator('[data-part-row="cassette"]').click();

    await expect(page.getByTestId("part-panel-fork")).toBeVisible();
    await expect(page.getByTestId("part-edit-form")).toHaveCount(0);
    await expect(page.getByTestId("part-panel-fork")).toContainText(
      locale === "fr" ? "copie locale" : "local copy",
    );

    // Taking the copy lands on the guest bike, which IS editable. On a phone the
    // panel lives in the bottom sheet, which has to be open for the CTA to be
    // reachable — exactly as a visitor would have to open it.
    await expandSheetIfPresent(page);
    await page.getByTestId("part-panel-fork").getByRole("button").click();
    await page.waitForURL((url) => url.pathname === href(locale, "/velo/[id]", { id: "local" }));
    await page.locator('[data-part-row="cassette"]').click();
    await expect(page.getByTestId("part-edit-form")).toBeVisible();
  });
});

forEachLocale((locale) => {
  test(`the action links point at the guides guidesFor() resolves, and they all answer 200 (${locale})`, async ({
    page,
    request,
  }) => {
    const summaries = diskGuides()
      .filter((guide) => guide.locale === locale)
      .map(toSummary);

    await seedLocalBike(page, BIKE_PRESETS["gravel-1x11"]);
    await page.goto(href(locale, "/velo/[id]", { id: "local" }));
    await page.locator('[data-part-row="tire-front"]').click();

    // The gravel preset is tubeless: the tubeless guide, never the inner-tube one.
    const expected = guidesFor(summaries, build, "tire-front", "replace")[0];
    expect(expected.slug).toBe("replace-tire-tubeless");

    const link = page.locator('[data-guide-action="replace"]');
    await expect(link).toHaveAttribute(
      "href",
      href(locale, "/guides/[slug]", { slug: expected.slug }),
    );

    // Every action the panel offers resolves, in both locales.
    const slugs = await page
      .locator("[data-guide-action]")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href") ?? ""),
      );
    expect(slugs.length).toBeGreaterThan(0);

    for (const path of slugs) {
      for (const target of ["fr", "en"] as Locale[]) {
        const slug = path.split("/").pop()!;
        const response = await request.get(href(target, "/guides/[slug]", { slug }));
        expect(response.status(), `${target} ${slug}`).toBe(200);
      }
    }
  });

  test(`a part that is not on the bike is a 404, and one that is opens the workspace (${locale})`, async ({
    page,
    request,
  }) => {
    const present = await request.get(
      href(locale, "/velo/[id]/piece/[partId]", { id: "demo", partId: "saddle" }),
    );
    expect(present.status()).toBe(200);

    // The gravel demo bike has no motor.
    const absent = await request.get(
      href(locale, "/velo/[id]/piece/[partId]", { id: "demo", partId: "e-motor" }),
    );
    expect(absent.status()).toBe(404);

    await page.goto(href(locale, "/velo/[id]/piece/[partId]", { id: "demo", partId: "saddle" }));
    // Scoped to the panel: between the server render (a phone layout, with the
    // sheet) and the hydrated one (docked, with the aside) both can be in the DOM
    // for a frame, and an unscoped selector is a strict-mode violation rather
    // than a failed assertion.
    await expect(
      page.locator('[data-testid=parts-panel] [data-part-row="saddle"]').first(),
    ).toHaveAttribute("aria-current", "true");
  });

  /**
   * The claim of §8.3: one workspace, three bikes — and a fourth id that is
   * somebody else's, which must look exactly like an id that does not exist.
   */
  test(`demo, local and a saved bike all render inside one BikeWorkspace (${locale})`, async ({
    page,
    signedInContext,
    request,
  }) => {
    await seedLocalBike(page, BIKE_PRESETS["gravel-1x11"]);
    await signedInContext();
    const id = await demoBikeId();

    for (const [param, kind] of [
      ["demo", "demo"],
      ["local", "local"],
      [id, "db"],
    ] as const) {
      await page.goto(href(locale, "/velo/[id]", { id: param }));
      const workspace = page.getByTestId("bike-workspace");
      await expect(workspace, `/velo/${param}`).toHaveCount(1);
      await expect(workspace).toHaveAttribute("data-ref", kind);
      await expect(page.getByTestId("parts-list")).toBeVisible();
    }

    // A well-formed UUID that belongs to nobody in this session: 404, never 403,
    // and indistinguishable from an id that was never issued (§4.7).
    const foreign = await request.get(
      href(locale, "/velo/[id]", { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" }),
    );
    expect(foreign.status()).toBe(404);
    const nonsense = await request.get(href(locale, "/velo/[id]", { id: "not-a-uuid" }));
    expect(nonsense.status()).toBe(404);
  });
});

/**
 * §6.7: `/velo/local` with nothing in storage goes home **and says why**. The
 * redirect alone is indistinguishable from a broken link — the visitor asked
 * for their bike and silently got the front page.
 */
forEachLocale((locale) => {
  test(`/velo/local without a stored bike goes home with a notice (${locale})`, async ({
    page,
  }) => {
    await page.goto(href(locale, "/velo/[id]", { id: "local" }));

    await expect(page).toHaveURL(new RegExp(`/${locale}(\\?.*)?$`));
    await expect(page.getByText(BIKE_T[locale].canvas.emptyToast)).toBeVisible();
  });
});
