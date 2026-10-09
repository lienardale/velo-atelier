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
 *
 * ## The form belongs to ONE part (`.debug/017` §5.8)
 *
 * The last block is the only place a real browser is asked the two questions
 * jsdom cannot settle:
 *
 *   - a part selected ON THE BIKE while "Infos" is showing changes the part
 *     under the form without changing the tab. The form must be that part's
 *     own: the fork's travel shown — and then written — for the dropper post
 *     was live on production until 2026-10-09;
 *   - a value typed and not yet left, when the next press is another tab:
 *     the field is removed while it still has focus, and what a browser does
 *     with the text is an ordering of mousedown, React's commit and the focus
 *     change that only a browser has.
 */
import AxeBuilder from "@axe-core/playwright";
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

import {
  clickPart,
  partLabel,
  scrollViewerIntoView,
  selectedPartId,
  waitCameraAtRest,
  waitReady,
} from "./bike3d/_viewer";
import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";
import { readStoredLocalBike, seedLocalBike } from "./_local-bike";

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

/**
 * Click a part's row once React owns it. The demo and saved bikes' rows are
 * server-rendered, so they are on screen before they listen: a click in that
 * window is dropped, and the panel it should open never appears — a 45 s
 * timeout on CI's desktop leg, passing on retry (W4 integration). A guest bike's
 * rows exist only once `va:bike:local` is read, after hydration, but every row
 * click goes through here so the safe form is the only one to copy.
 */
async function clickRow(page: Page, partId: string): Promise<void> {
  const row = page.locator(`[data-part-row="${partId}"]`);
  await expect
    .poll(() =>
      row.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactProps"))),
    )
    .toBe(true);
  await row.click();
}

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
    await clickRow(page, "cassette");
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
    await clickRow(page, "cassette");
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

    await clickRow(page, "cassette");
    await page.locator('[data-attr="range"]').selectOption("11-36");
    await expect(page.getByTestId("attr-status-range")).toHaveText(
      locale === "fr" ? "Enregistré" : "Saved",
    );

    // A reload re-reads the row: if the action had not written, this fails.
    await page.reload();
    await clickRow(page, "cassette");
    await expect(page.locator('[data-attr="range"]')).toHaveValue("11-36");

    // Nothing was written to the browser — a saved bike never touches localStorage.
    expect(await page.evaluate(() => window.localStorage.getItem("va:bike:local"))).toBeNull();
  });

  test(`the demo bike offers a local copy instead of a form (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/velo/[id]", { id: "demo" }));
    await clickRow(page, "cassette");

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
    await clickRow(page, "cassette");
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
    await clickRow(page, "tire-front");

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

// ── the form belongs to one part ─────────────────────────────────────────────

const sheet = "[data-testid=parts-sheet]";

/** One attribute of one part of the guest bike, as `va:bike:local` holds it. */
async function guestAttribute(page: Page, partId: string, key: string): Promise<unknown> {
  const bike = await readStoredLocalBike(page);
  // eslint-disable-next-line security/detect-object-injection -- an attribute key written by this spec
  return bike?.parts.find((part) => part.partId === partId)?.attributes[key];
}

/**
 * Select a part ON THE BIKE, the way the project's browser can: a click (or a
 * tap) on its mesh where there is a canvas, the silhouette's own button with
 * the keyboard where WebGL is off. Neither changes the tab.
 */
async function selectOnBike(page: Page, id: string, webgl: boolean): Promise<void> {
  if (!webgl) {
    await page.locator(`[data-testid=bike3d-svg] [data-part-id="${id}"]`).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("bike3d-viewer")).toHaveAttribute("data-selected", id);
    return;
  }
  await waitReady(page);
  // On a phone the open sheet lies over the bike: lower it, as a visitor would
  // to see what they are about to tap. The tap itself opens it again (§6.4).
  const handle = page.locator(`${sheet} [data-slot=mobile-sheet-handle]`);
  if ((await handle.count()) > 0) {
    await handle.focus();
    await page.keyboard.press("Home");
    await expect(page.locator(sheet)).toHaveAttribute("data-snap", "0");
    await expect
      .poll(() =>
        page
          .locator(sheet)
          .evaluate(
            (node) =>
              node.getAnimations().filter((animation) => animation.playState === "running").length,
          ),
      )
      .toBe(0);
  }
  // The row click sent the camera towards the first part; a point read while it
  // is still moving is not where the click will land.
  await scrollViewerIntoView(page);
  await waitCameraAtRest(page);
  await clickPart(page, id);
  await expect.poll(() => selectedPartId(page)).toBe(id);
}

/** A user and a bike of their own: a test that WRITES a saved bike never shares one. */
async function ownBike(
  label: string,
  locale: Locale,
  preset: keyof typeof BIKE_PRESETS,
): Promise<{ user: { id: string; email: string; locale: Locale }; bikeId: string }> {
  const client = new Client({ connectionString: resolveTestEnv().POSTGRES_URL });
  await client.connect();
  try {
    const email = `partform+${label}@velo-atelier.test`;
    // eslint-disable-next-line security/detect-object-injection -- a key of the presets table
    const derived = deriveBike(BIKE_PRESETS[preset]);
    const own = buildOf(derived);
    const { rows: users } = await client.query<{ id: string }>(
      // `updatedAt` is Prisma's `@updatedAt`: raw SQL has to set it itself.
      `INSERT INTO "User" (name, email, locale, "updatedAt") VALUES ('Camille', $1, $2::"UserLocale", now())
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [email, locale],
    );
    const userId = users[0].id;
    await client.query(`DELETE FROM "Bike" WHERE "userId" = $1`, [userId]);
    const { rows: bikes } = await client.query<{ id: string }>(
      `INSERT INTO "Bike" ("userId", name, answers, spec, parts, "updatedAt")
       VALUES ($1, 'Gravel', $2, $3, $4, now()) RETURNING id`,
      // Stringified: `pg` turns a JS array into a Postgres ARRAY literal.
      [
        userId,
        JSON.stringify(derived.answers),
        JSON.stringify(own.spec),
        JSON.stringify(own.parts),
      ],
    );
    return { user: { id: userId, email, locale }, bikeId: bikes[0].id };
  } finally {
    await client.end();
  }
}

/** One attribute of one part of a saved bike, as PostgreSQL holds it. */
async function savedAttribute(bikeId: string, partId: string, key: string): Promise<unknown> {
  const client = new Client({ connectionString: resolveTestEnv().POSTGRES_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{
      parts: { partId: string; attributes: Record<string, unknown> }[];
    }>(`SELECT parts FROM "Bike" WHERE id = $1`, [bikeId]);
    // eslint-disable-next-line security/detect-object-injection -- an attribute key written by this spec
    return rows[0]?.parts.find((part) => part.partId === partId)?.attributes[key];
  } finally {
    await client.end();
  }
}

/** The "Pièces" tab, by the name the visitor reads. */
const partsTabName = (locale: Locale): string =>
  locale === "fr" ? frBike.workspace.partsTab : enBike.workspace.partsTab;

/** Type `text` over what the field holds, and stay in the field. */
async function typeAndStay(page: Page, field: ReturnType<Page["locator"]>, text: string) {
  await field.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await expect(field).toHaveValue(text);
  await expect(field).toBeFocused();
}

forEachLocale((locale) => {
  /**
   * The stock full-suspension bike is the one that needs no typing at all: its
   * fork has 140 mm of travel and its dropper post 170, under the same key.
   * Tagged for no project: the selection is made on the mesh where there is a
   * canvas and on the silhouette where there is none.
   */
  test(`a part selected on the bike gets its own form: the fork's travel is neither shown nor written for the dropper post (${locale})`, async ({
    page,
    webgl,
  }) => {
    await seedLocalBike(page, BIKE_PRESETS["mtb-full-dropper-1x12"]);
    await page.goto(href(locale, "/velo/[id]", { id: "local" }));

    await clickRow(page, "fork");
    await expandSheetIfPresent(page);
    const travel = page.locator('[data-testid=part-edit-form] [data-attr="travel-mm"]');
    await expect(travel).toHaveValue("140");

    await selectOnBike(page, "seatpost", webgl);
    // The canvas never steals the tab: "Infos" is still showing, on the post.
    await expect(page.getByTestId("part-panel-title")).toHaveText(partLabel(locale, "seatpost"));
    // Soft, so that a failure here still goes on to show what gets WRITTEN.
    await expect.soft(travel, "the post's field shows the post's travel").toHaveValue("170");

    // Tab through every control of the form, changing nothing.
    const controls = page.locator("[data-testid=part-edit-form] [data-attr]");
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);
    await controls.first().focus();
    for (let index = 0; index < count; index += 1) await page.keyboard.press("Tab");

    // Nothing was changed, so nothing says it was saved…
    await expect
      .soft(page.getByTestId("attr-status-travel-mm"), "no field reports a save")
      .toHaveText("");
    // …and nothing was: each part still holds its own travel.
    expect(await guestAttribute(page, "seatpost", "travel-mm")).toBe(170);
    expect(await guestAttribute(page, "fork", "travel-mm")).toBe(140);
  });

  /**
   * The sequence the defect was reported with: a number typed for one tyre,
   * and the NEXT press is the other tyre, on the bike. Whether that press
   * leaves the field before it selects is the browser's business; what must
   * hold either way is where the number ends up, and what the other tyre's
   * form says of it.
   */
  test(`a width typed for the front tyre, then the rear tyre picked on the bike: the front is saved, and the rear's form says nothing of it (${locale})`, async ({
    page,
    webgl,
  }) => {
    await seedLocalBike(page, BIKE_PRESETS["gravel-1x11"]);
    await page.goto(href(locale, "/velo/[id]", { id: "local" }));

    await clickRow(page, "tire-front");
    await expandSheetIfPresent(page);
    const width = page.locator('[data-testid=part-edit-form] [data-attr="etrto-width"]');
    await typeAndStay(page, width, "45");

    await selectOnBike(page, "tire-rear", webgl);
    await expect(page.getByTestId("part-panel-title")).toHaveText(partLabel(locale, "tire-rear"));

    await expect.poll(() => guestAttribute(page, "tire-front", "etrto-width")).toBe(45);
    await expect(width).toHaveValue("42");
    await expect(page.getByTestId("attr-status-etrto-width")).toHaveText("");

    // Visiting the rear tyre's form writes nothing to it.
    const controls = page.locator("[data-testid=part-edit-form] [data-attr]");
    const count = await controls.count();
    await controls.first().focus();
    for (let index = 0; index < count; index += 1) await page.keyboard.press("Tab");
    await expect(page.getByTestId("attr-status-etrto-width")).toHaveText("");
    expect(await guestAttribute(page, "tire-rear", "etrto-width")).toBe(42);
    expect(await guestAttribute(page, "tire-front", "etrto-width")).toBe(45);
  });

  /**
   * The press is the pointer's — a click with a mouse, a tap on a touch screen
   * — and the field is NOT left first: that is the whole case.
   */
  test(`a width typed and not left is saved for its own tyre when the next press is the parts tab — guest bike (${locale})`, async ({
    page,
    hasTouch,
  }) => {
    await seedLocalBike(page, BIKE_PRESETS["gravel-1x11"]);
    await page.goto(href(locale, "/velo/[id]", { id: "local" }));

    await clickRow(page, "tire-front");
    // On a phone the form is below the fold of the half-open sheet.
    await expandSheetIfPresent(page);
    const width = page.locator('[data-testid=part-edit-form] [data-attr="etrto-width"]');
    await expect(width).toHaveValue("42");
    await typeAndStay(page, width, "45");
    expect(await guestAttribute(page, "tire-front", "etrto-width")).toBe(42);

    const partsTab = page.getByRole("tab", { name: partsTabName(locale), exact: true });
    if (hasTouch) await partsTab.tap();
    else await partsTab.click();
    await expect(page.getByTestId("parts-list")).toBeVisible();

    await expect.poll(() => guestAttribute(page, "tire-front", "etrto-width")).toBe(45);
    expect(await guestAttribute(page, "tire-rear", "etrto-width")).toBe(42);

    // Back on the tyre, the field says what is stored.
    await clickRow(page, "tire-front");
    await expect(width).toHaveValue("45");
  });

  test(`a width typed and not left is saved for its own tyre when the next press is the parts tab — saved bike (${locale})`, async ({
    page,
    hasTouch,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await ownBike(
      `tab-${testInfo.project.name}-${locale}`,
      locale,
      "gravel-1x11",
    );
    await signedInContext(user);
    await page.goto(href(locale, "/velo/[id]", { id: bikeId }));

    await clickRow(page, "tire-front");
    // On a phone the form is below the fold of the half-open sheet.
    await expandSheetIfPresent(page);
    const width = page.locator('[data-testid=part-edit-form] [data-attr="etrto-width"]');
    await expect(width).toHaveValue("42");
    await typeAndStay(page, width, "45");

    // A server action is a POST: counted, because the field is committed by
    // its removal AND the browser may fire a blur of its own while it goes.
    let actions = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") actions += 1;
    });

    const partsTab = page.getByRole("tab", { name: partsTabName(locale), exact: true });
    if (hasTouch) await partsTab.tap();
    else await partsTab.click();
    await expect(page.getByTestId("parts-list")).toBeVisible();

    // Through the real server action, read where it lands.
    await expect.poll(() => savedAttribute(bikeId, "tire-front", "etrto-width")).toBe(45);
    expect(await savedAttribute(bikeId, "tire-rear", "etrto-width")).toBe(42);

    await clickRow(page, "tire-front");
    await expect(width).toHaveValue("45");
    expect(actions, "the width was sent once").toBe(1);
  });
});

// ── what the review of 2026-10-09 found (`.debug/017` §5.8, "Review of the fix") ────────

/** Give one attribute of a saved bike a value of the owner's own, straight in PostgreSQL. */
async function setSavedAttribute(
  bikeId: string,
  partId: string,
  key: string,
  value: number,
): Promise<void> {
  const client = new Client({ connectionString: resolveTestEnv().POSTGRES_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{
      parts: { partId: string; attributes: Record<string, unknown> }[];
    }>(`SELECT parts FROM "Bike" WHERE id = $1`, [bikeId]);
    const parts = rows[0].parts.map((part) =>
      part.partId === partId ? { ...part, attributes: { ...part.attributes, [key]: value } } : part,
    );
    await client.query(`UPDATE "Bike" SET parts = $2 WHERE id = $1`, [
      bikeId,
      JSON.stringify(parts),
    ]);
  } finally {
    await client.end();
  }
}

/**
 * Type text a number field cannot read as a number, and stay in the field.
 * Chromium keeps the characters on screen and reports an EMPTY `value` with
 * `validity.badInput` — which is all a script, or React, can see of them.
 */
async function typeUnreadable(
  page: Page,
  field: ReturnType<Page["locator"]>,
  text: string,
  { emptiedFirst = false } = {},
) {
  await field.click();
  await page.keyboard.press("ControlOrMeta+a");
  if (emptiedFirst) {
    // Emptied, THEN the text: the value goes from "" to "" — nothing a
    // listener of value changes is told about.
    await page.keyboard.press("Delete");
    await expect(field).toHaveValue("");
  }
  await page.keyboard.type(text);
  await expect(field).toBeFocused();
  expect(
    await field.evaluate((node) => ({
      value: (node as HTMLInputElement).value,
      badInput: (node as HTMLInputElement).validity.badInput,
    })),
    `what the browser reports for ${JSON.stringify(text)}`,
  ).toEqual({ value: "", badInput: true });
}

/** The "not saved" notice for the front tyre's width, as the visitor reads it. */
const UNSAVED_WIDTH: Record<Locale, string> = {
  fr: "Pneu avant · Largeur du pneu : votre saisie n’a pas été enregistrée.",
  en: "Front tyre · Tyre width: what you typed was not saved.",
};
const NOT_POSSIBLE: Record<Locale, string> = {
  fr: frBike.errors["invalid-value"],
  en: enBike.errors["invalid-value"],
};

/* eslint-disable security/detect-object-injection -- locale-keyed message fixtures */
/** Every "not saved" notice on the page, by its sentence. */
const unsavedNotices = (page: Page, locale: Locale) =>
  page.locator("[data-sonner-toast]").filter({ hasText: UNSAVED_WIDTH[locale] });

forEachLocale((locale) => {
  /**
   * "45." on the way to 45.5, a stray minus, "4e": until the review these were
   * a DELETION of the stored width when the next press was a tab — the field's
   * removal committed the empty value the browser reports for them, the write
   * succeeded, and nothing was said. Before 2026-10-09 the removal committed
   * nothing at all, so the stored width survived.
   */
  test(`number text the browser cannot read, typed and not left, deletes nothing when the next press is the parts tab: the width is kept and the visitor is told — guest bike (${locale})`, async ({
    page,
    hasTouch,
  }) => {
    await seedLocalBike(page, BIKE_PRESETS["gravel-1x11"]);
    await page.goto(href(locale, "/velo/[id]", { id: "local" }));
    const width = page.locator('[data-testid=part-edit-form] [data-attr="etrto-width"]');
    const partsTab = page.getByRole("tab", { name: partsTabName(locale), exact: true });

    const sequences = [
      { text: "45.", emptiedFirst: false },
      { text: "4e", emptiedFirst: false },
      { text: "-", emptiedFirst: false },
      // The field emptied first: React hears of no change when the minus is typed.
      { text: "-", emptiedFirst: true },
      { text: ".", emptiedFirst: true },
    ];
    for (const [index, { text, emptiedFirst }] of sequences.entries()) {
      await clickRow(page, "tire-front");
      await expandSheetIfPresent(page);
      await expect(width).toHaveValue("42");
      await typeUnreadable(page, width, text, { emptiedFirst });

      if (hasTouch) await partsTab.tap();
      else await partsTab.click();
      await expect(page.getByTestId("parts-list")).toBeVisible();

      // A guest bike's write is synchronous: had the removal sent one, it is in storage by now.
      expect(
        await guestAttribute(page, "tire-front", "etrto-width"),
        `${text}${emptiedFirst ? ", the field emptied first" : ""}`,
      ).toBe(42);
      await expect(unsavedNotices(page, locale), `a notice for ${text}`).toHaveCount(index + 1);
      await expect(unsavedNotices(page, locale).first()).toContainText(NOT_POSSIBLE[locale]);
    }
  });

  test(`number text the browser cannot read, typed and not left, deletes nothing when the next press is the parts tab: nothing is sent, the owner's width is still in PostgreSQL — saved bike (${locale})`, async ({
    page,
    hasTouch,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await ownBike(
      `unreadable-${testInfo.project.name}-${locale}`,
      locale,
      "gravel-1x11",
    );
    // The owner's own width: 38, where clearing the attribute gives the default back (42).
    await setSavedAttribute(bikeId, "tire-front", "etrto-width", 38);
    await signedInContext(user);
    await page.goto(href(locale, "/velo/[id]", { id: bikeId }));

    await clickRow(page, "tire-front");
    await expandSheetIfPresent(page);
    const width = page.locator('[data-testid=part-edit-form] [data-attr="etrto-width"]');
    await expect(width).toHaveValue("38");
    await typeUnreadable(page, width, "45.");

    let actions = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") actions += 1;
    });
    const partsTab = page.getByRole("tab", { name: partsTabName(locale), exact: true });
    if (hasTouch) await partsTab.tap();
    else await partsTab.click();
    await expect(page.getByTestId("parts-list")).toBeVisible();

    // Soft, so that a missing notice still goes on to show what was SENT and stored.
    await expect.soft(unsavedNotices(page, locale)).toHaveCount(1);
    await expect.soft(unsavedNotices(page, locale)).toContainText(NOT_POSSIBLE[locale]);
    expect(actions, "text that cannot be read is not sent").toBe(0);
    expect(await savedAttribute(bikeId, "tire-front", "etrto-width")).toBe(38);

    await clickRow(page, "tire-front");
    await expect(width).toHaveValue("38");
  });

  /**
   * The other half of the same exit, and a decision: a field the visitor
   * EMPTIED (nothing in it, nothing unreadable) is cleared by its removal
   * exactly as leaving it clears it. New with the removal's commit — before
   * it, an emptied field that was not left kept its value.
   */
  test(`a width emptied and not left is cleared when the next press is the parts tab, as leaving the field clears it — guest bike (${locale})`, async ({
    page,
    hasTouch,
  }) => {
    await seedLocalBike(page, BIKE_PRESETS["gravel-1x11"]);
    await page.goto(href(locale, "/velo/[id]", { id: "local" }));
    await clickRow(page, "tire-front");
    await expandSheetIfPresent(page);
    const width = page.locator('[data-testid=part-edit-form] [data-attr="etrto-width"]');
    await expect(width).toHaveValue("42");
    await width.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await expect(width).toBeFocused();
    expect(
      await width.evaluate((node) => ({
        value: (node as HTMLInputElement).value,
        badInput: (node as HTMLInputElement).validity.badInput,
      })),
    ).toEqual({ value: "", badInput: false });

    const partsTab = page.getByRole("tab", { name: partsTabName(locale), exact: true });
    if (hasTouch) await partsTab.tap();
    else await partsTab.click();
    await expect(page.getByTestId("parts-list")).toBeVisible();

    await expect.poll(() => guestAttribute(page, "tire-front", "etrto-width")).toBeUndefined();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });

  /**
   * Two writes of one bike in flight together. Next's client sends server
   * actions one at a time — until a navigation arrives, which discards the
   * pending one's turn and lets the next go at once (read in
   * `next/dist/client/components/app-router-instance.js`). The removal's write
   * is dispatched exactly then. `updateBikePartAction` used to read the row,
   * edit the build and write it back with nothing held in between, so the two
   * overwrote each other: five runs of six lost one of the edits, both POSTs
   * answering 200.
   *
   * The first POST is held in transit until the second is on its way — a slow
   * connection, a cold function — and then both go on together.
   */
  test(`a select changed, a width typed and not left, then history back while the first write is still in transit: both are in PostgreSQL — saved bike (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await ownBike(
      `route-${testInfo.project.name}-${locale}-${testInfo.repeatEachIndex}`,
      locale,
      "gravel-1x11",
    );
    await signedInContext(user);
    // Reached by its link, so that "back" is a navigation inside the app.
    await page.goto(href(locale, "/mes-velos"));
    await page.locator(`[data-testid=my-bikes-list] a[href$="/${bikeId}"]`).first().click();
    await page.waitForURL((url) => url.pathname.endsWith(`/${bikeId}`));

    await clickRow(page, "tire-front");
    await expandSheetIfPresent(page);
    const width = page.locator('[data-testid=part-edit-form] [data-attr="etrto-width"]');
    await expect(width).toHaveValue("42");
    expect(await savedAttribute(bikeId, "tire-front", "tread")).toBe("semi-slick");

    const sent: string[] = [];
    let release: (() => void) | null = null;
    await page.route(
      () => true,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        sent.push(new URL(route.request().url()).pathname);
        if (sent.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
            // Should the client ever queue the second behind the first, let it through.
            setTimeout(resolve, 5000);
          });
        } else {
          release?.();
        }
        await route.continue();
      },
    );

    await page.locator('[data-testid=part-edit-form] [data-attr="tread"]').selectOption("slick");
    await typeAndStay(page, width, "45");
    await page.goBack();
    await page.waitForURL((url) => url.pathname === href(locale, "/mes-velos"));

    await expect
      .poll(
        async () => ({
          tread: await savedAttribute(bikeId, "tire-front", "tread"),
          width: await savedAttribute(bikeId, "tire-front", "etrto-width"),
          sent: sent.length,
        }),
        { timeout: 15_000 },
      )
      .toEqual({ tread: "slick", width: 45, sent: 2 });
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });

  /**
   * The write fails because the network is gone — the first reason a write
   * does not answer. The notice must not need a download of its own to be
   * shown: until the review it did (a chunk the page had never requested), so
   * the visitor was told nothing and the import's rejection went unhandled.
   */
  test(`offline: a width typed and not left, then the parts tab — the visitor is told it was not saved, by a notice that needs no download — saved bike (${locale})`, async ({
    page,
    context,
    hasTouch,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await ownBike(
      `offline-tab-${testInfo.project.name}-${locale}`,
      locale,
      "gravel-1x11",
    );
    await signedInContext(user);
    await page.goto(href(locale, "/velo/[id]", { id: bikeId }));
    await clickRow(page, "tire-front");
    await expandSheetIfPresent(page);
    const width = page.locator('[data-testid=part-edit-form] [data-attr="etrto-width"]');
    await expect(width).toHaveValue("42");
    await typeAndStay(page, width, "45");

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await context.setOffline(true);
    const partsTab = page.getByRole("tab", { name: partsTabName(locale), exact: true });
    if (hasTouch) await partsTab.tap();
    else await partsTab.click();
    await expect(page.getByTestId("parts-list")).toBeVisible();

    await expect(unsavedNotices(page, locale)).toHaveCount(1);
    await context.setOffline(false);
    expect(pageErrors, "no rejection left unhandled").toEqual([]);
    expect(await savedAttribute(bikeId, "tire-front", "etrto-width")).toBe(42);
  });

  test(`offline: a width typed and not left, then a history move onto another part — the visitor is told it was not saved — saved bike (${locale})`, async ({
    page,
    context,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await ownBike(
      `offline-part-${testInfo.project.name}-${locale}`,
      locale,
      "gravel-1x11",
    );
    await signedInContext(user);
    await page.goto(href(locale, "/velo/[id]", { id: bikeId }));
    await clickRow(page, "tire-front");
    await expandSheetIfPresent(page);
    const width = page.locator('[data-testid=part-edit-form] [data-attr="etrto-width"]');
    await expect(width).toHaveValue("42");
    await typeAndStay(page, width, "45");

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await context.setOffline(true);
    // `?part=` as a history move delivers it: the field keeps the caret until it is removed.
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("part", "tire-rear");
      window.history.pushState(window.history.state, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByTestId("part-panel-title")).toHaveText(partLabel(locale, "tire-rear"));

    await expect(unsavedNotices(page, locale)).toHaveCount(1);
    await context.setOffline(false);
    expect(pageErrors, "no rejection left unhandled").toEqual([]);
    expect(await savedAttribute(bikeId, "tire-front", "etrto-width")).toBe(42);
  });

  /**
   * The notice is the only thing that tells the visitor a typed value was not
   * saved once its field is gone, and `a11y.spec.ts` cannot reach it: the demo
   * bike it opens has no form. Sonner's "rich" error colours were #e60000 on
   * #fff0f0 — 4.34:1 at 13 px, a serious `color-contrast` violation in both
   * schemes and both languages.
   */
  for (const scheme of ["light", "dark"] as const) {
    test(`the "not saved" notice passes axe at serious/critical, ${scheme} (${locale})`, async ({
      page,
      hasTouch,
    }) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: scheme });
      await seedLocalBike(page, BIKE_PRESETS["gravel-1x11"]);
      await page.goto(href(locale, "/velo/[id]", { id: "local" }));
      await clickRow(page, "tire-front");
      await expandSheetIfPresent(page);
      const width = page.locator('[data-testid=part-edit-form] [data-attr="etrto-width"]');
      await typeAndStay(page, width, "999"); // out of the 18–130 the domain accepts

      const partsTab = page.getByRole("tab", { name: partsTabName(locale), exact: true });
      if (hasTouch) await partsTab.tap();
      else await partsTab.click();
      const toast = unsavedNotices(page, locale);
      await expect(toast).toHaveCount(1);
      await expect(toast).toContainText(NOT_POSSIBLE[locale]);
      // Once it has finished arriving: axe reads what is painted.
      await expect
        .poll(() => toast.evaluate((node) => getComputedStyle(node).opacity), { timeout: 10_000 })
        .toBe("1");
      await expect
        .poll(() =>
          toast.evaluate(
            (node) =>
              node.getAnimations().filter((animation) => animation.playState === "running").length,
          ),
        )
        .toBe(0);
      const box = await toast.boundingBox();
      const viewport = page.viewportSize()!;
      expect(box, "the notice is on the page").not.toBeNull();
      expect(box!.y, "inside the viewport").toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, "inside the viewport").toBeLessThanOrEqual(viewport.height);

      // The notice's own region, not the page around it: the 3D viewer's label
      // of the selected part fades in over the canvas as the camera moves, and
      // an analysis that catches it half-way reports ITS text (1.07:1, one run
      // of eight here). The page itself is `a11y.spec.ts`'s.
      const { violations } = await new AxeBuilder({ page })
        .include("[data-sonner-toaster]")
        .analyze();
      const blocking = violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .flatMap((violation) =>
          violation.nodes.map(
            (node) =>
              `[${violation.impact}] ${violation.id} ${node.target.join(" ")} ${JSON.stringify(
                node.any.map((check) => check.data),
              ).slice(0, 300)}`,
          ),
        );
      expect(blocking).toEqual([]);
    });
  }
});
/* eslint-enable security/detect-object-injection */
