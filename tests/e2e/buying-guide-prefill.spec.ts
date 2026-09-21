/**
 * §5.5: "with `?part=<id>&bike=<ref>&item=<id>` it pre-fills from the
 * build-list item" — the buying guide opens on the answers the visitor already
 * gave on their list, instead of asking them again.
 *
 * `BuildItemCard` has written `?item=` since W3; nothing read it until W4
 * (docs/backlog.md, follow-up c). Each test here starts where a visitor does —
 * on the list — and follows the line's own "buying guide" link, so what is
 * checked is the round trip: what the list stored is what `/acheter` shows.
 *
 *   guest    the line is read in the browser from `va:buildlist:demo`, through
 *            the zod-guarded `readGuestBuildList`, loaded on demand
 *            (`components/shop/item-prefill.ts`);
 *   account  the line is read on the server by `loadBuildListItemAction`,
 *            scoped by owner AND bike — another person's line pre-fills
 *            nothing, and says nothing about whether it exists (§4.7).
 *
 * The panel is `aria-busy` until the line has been read; every "nothing was
 * pre-filled" assertion waits for that first, or it would pass before the read.
 */
/* eslint-disable security/detect-non-literal-regexp -- patterns built from brand constants this file spells out */
import { Client, type ClientBase } from "pg";

import { buildOf, deriveBike } from "../../lib/bike/rules";
import { buildListKey } from "../../lib/bike/storage-keys";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import { resolveTestEnv } from "../_fakes/db";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";

/** The first brand of each cassette tier in `content/brands.yaml` — what reaches the search. */
const CASSETTE_BRAND = { mid: "Shimano%20105", high: "Campagnolo%20Record" } as const;

/** The guest list the wizard would have written for the demo bike. */
const GUEST_LINES = [
  {
    id: "check-drivetrain#cassette-teeth|cassette|replace",
    stepKey: "check-drivetrain#cassette-teeth",
    sourceKeys: ["check-drivetrain#cassette-teeth"],
    partId: "cassette",
    action: "replace",
    reasonKey: "cassette-worn",
    guideSlug: "replace-cassette",
    done: false,
    sortOrder: 0,
  },
];

async function seedGuestList(page: import("@playwright/test").Page): Promise<void> {
  const raw = JSON.stringify({
    version: 1,
    items: GUEST_LINES,
    updatedAt: new Date().toISOString(),
  });
  // Never overwrites what the page has since written: the refinement the test
  // sets on the list is what the buying guide must read back.
  await page.addInitScript(
    ([key, value]) => {
      try {
        if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value);
      } catch {
        // Storage disabled: the assertion that needs the list will say so.
      }
    },
    [buildListKey("demo"), raw] as const,
  );
}

async function withDb<T>(run: (client: ClientBase) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: resolveTestEnv().POSTGRES_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function userNamed(client: ClientBase, email: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO "User" (name, email, locale, "updatedAt") VALUES ('Camille', $1, 'fr', now())
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [email],
  );
  await client.query(`DELETE FROM "Bike" WHERE "userId" = $1`, [rows[0].id]);
  return rows[0].id;
}

/** An account whose gravel bike has one list with a refined cassette line. */
async function accountWithRefinedLine(label: string): Promise<{
  user: { id: string; email: string };
  bikeId: string;
  itemId: string;
}> {
  return withDb(async (client) => {
    const email = `prefill+${label}@velo-atelier.test`;
    const userId = await userNamed(client, email);
    const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    const build = buildOf(derived);
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
    const { rows: lists } = await client.query<{ id: string }>(
      `INSERT INTO "BuildList" ("bikeId", name, "updatedAt") VALUES ($1, 'Révision', now()) RETURNING id`,
      [bikes[0].id],
    );
    const { rows: items } = await client.query<{ id: string }>(
      `INSERT INTO "BuildListItem"
         ("buildListId", "partId", action, "reasonKey", "guideSlug", refinement, "sortOrder", "updatedAt")
       VALUES ($1, 'cassette', 'REPLACE', 'cassette-worn', 'replace-cassette', $2, 0, now())
       RETURNING id`,
      [lists[0].id, JSON.stringify({ range: "11-32", "brand-tier": "high" })],
    );
    return { user: { id: userId, email }, bikeId: bikes[0].id, itemId: items[0].id };
  });
}

/** The part panel, once it has finished reading `?item=`. */
async function settledPanel(page: import("@playwright/test").Page) {
  const panel = page.getByTestId("part-questions");
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveAttribute("aria-busy", "true");
  return panel;
}

forEachLocale((locale: Locale) => {
  test(`a guest's refined line opens the buying guide pre-filled (${locale})`, async ({ page }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));

    const cassette = page.locator('[data-testid="build-item"][data-part-id="cassette"]');
    await cassette.locator('[data-question="range"]').selectOption("11-34");
    await cassette.locator('[data-question="brand-tier"]').selectOption("mid");

    const link = cassette.getByTestId("build-item-buying-guide");
    await expect(link).toHaveAttribute(
      "href",
      `${href(locale, "/acheter")}?part=cassette&bike=demo&item=${encodeURIComponent(GUEST_LINES[0].id)}`,
    );
    await link.click();
    await page.waitForURL((url) => url.pathname === href(locale, "/acheter"));

    const panel = await settledPanel(page);
    await expect(panel).toHaveAttribute("data-part-id", "cassette");
    await expect(panel.locator('[data-question="range"]')).toHaveValue("11-34");
    await expect(panel.locator('[data-question="brand-tier"]')).toHaveValue("mid");
    await expect(page.getByTestId("part-questions-prefilled")).toBeVisible();
    // The pre-filled answers are in the search the shops receive, brand included.
    const rose = page.getByTestId("part-vendor-buttons").locator('a[data-retailer="rosebikes"]');
    await expect(rose).toHaveAttribute("href", /11-34/);
    await expect(rose).toHaveAttribute("href", new RegExp(CASSETTE_BRAND.mid));
  });

  test(`an account's line is read on the server and pre-fills the guide (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId, itemId } = await accountWithRefinedLine(
      `${locale}-${testInfo.project.name}`,
    );
    await signedInContext(user);
    await page.goto(href(locale, "/velo/[id]/liste", { id: bikeId }));

    const cassette = page.locator('[data-testid="build-item"][data-part-id="cassette"]');
    await expect(cassette.locator('[data-question="range"]')).toHaveValue("11-32");
    await cassette.getByTestId("build-item-buying-guide").click();
    await page.waitForURL((url) => url.pathname === href(locale, "/acheter"));
    expect(new URL(page.url()).searchParams.get("item")).toBe(itemId);

    const panel = await settledPanel(page);
    await expect(panel.locator('[data-question="range"]')).toHaveValue("11-32");
    await expect(panel.locator('[data-question="brand-tier"]')).toHaveValue("high");
    await expect(page.getByTestId("part-questions-prefilled")).toBeVisible();
    await expect(
      page.getByTestId("part-vendor-buttons").locator('a[data-retailer="rosebikes"]'),
    ).toHaveAttribute("href", new RegExp(CASSETTE_BRAND.high));
  });

  test(`another account's line pre-fills nothing (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const owner = await accountWithRefinedLine(`owner-${locale}-${testInfo.project.name}`);
    const intruder = await withDb(async (client) => {
      const email = `prefill+intruder-${locale}-${testInfo.project.name}@velo-atelier.test`;
      return { id: await userNamed(client, email), email };
    });
    await signedInContext(intruder);

    await page.goto(
      href(locale, "/acheter", {}, { part: "cassette", bike: owner.bikeId, item: owner.itemId }),
    );

    // The owner's answers are 11-32 and "high": none of it reaches this page.
    const panel = await settledPanel(page);
    await expect(panel.locator('[data-question="range"]')).toHaveValue("");
    await expect(panel.locator('[data-question="brand-tier"]')).toHaveValue("");
    await expect(page.getByTestId("part-questions-prefilled")).toHaveCount(0);
  });
});
