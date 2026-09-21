/**
 * The build list's refinement, as W4 completed it (§6.5), and why a line is
 * done, as an account sees it (§5.4, §6.7).
 *
 *   brand tier    entry / mid / high, asked on a line whose part
 *                 `content/brands.yaml` covers — and not on one it does not,
 *                 where a tier would change nothing — with the chosen tier's
 *                 first brand in the vendors' search, exactly as on `/acheter`
 *                 (follow-up e). The tiers are read on the server and handed to
 *                 the client form as props.
 *   the drawing   "Comment mesurer" shows the existing drawing of what to read
 *                 off the bike, where one exists, with its numbered legend
 *                 (follow-up f). Rendered on the server: the illustration
 *                 barrel never reaches this page's bundle.
 *   doneReason    a line a later checkup closed says so ("Marqué fait par un
 *                 contrôle") on an ACCOUNT's list too, and a hand tick is stored
 *                 as `manual` — which a guest's list always did (follow-up b).
 *
 * What a later checkup writes (`doneReason: 'recheck-ok'` on the older list's
 * line) is pinned against real Postgres in `tests/integration/checkups.test.ts`;
 * here the account's list is seeded with exactly that state and read through the
 * page, so the write and the read are each checked once, where they happen.
 */
/* eslint-disable security/detect-object-injection -- locale-keyed message fixtures */
import { Client, type ClientBase } from "pg";

import { buildOf, deriveBike } from "../../lib/bike/rules";
import { buildListKey } from "../../lib/bike/storage-keys";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import enIllustrations from "../../messages/en/illustrations.json";
import enShop from "../../messages/en/shop.json";
import frIllustrations from "../../messages/fr/illustrations.json";
import frShop from "../../messages/fr/shop.json";
import { resolveTestEnv } from "../_fakes/db";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";

const SHOP_T: Record<Locale, typeof frShop> = { fr: frShop, en: enShop };
const ILLUSTRATIONS_T: Record<Locale, typeof frIllustrations> = {
  fr: frIllustrations,
  en: enIllustrations,
};

/** The first "mid" chain brand of `content/brands.yaml`, as the search URL carries it. */
const CHAIN_MID_BRAND = "KMC%20X";

function line(
  stepKey: string,
  partId: string,
  action: string,
  reasonKey: string,
  guideSlug: string | undefined,
  sortOrder: number,
) {
  const id = `${stepKey}|${partId}|${action}`;
  return {
    id,
    stepKey,
    sourceKeys: [stepKey],
    partId,
    action,
    reasonKey,
    ...(guideSlug === undefined ? {} : { guideSlug }),
    done: false,
    sortOrder,
  };
}

/**
 * A guest list with a chain (brands.yaml covers it), a crankset (it does not)
 * and a pedal (its `pedal-type` question has a drawing), as the wizard writes it.
 */
const GUEST_LINES = [
  line("check-drivetrain#chain-wear", "chain", "replace", "chain-elongation", "replace-chain", 0),
  line("check-bottom-bracket#crank-arms", "crankset", "inspect-shop", "crank-loose", undefined, 1),
  line("check-pedals#body-damage", "pedal-left", "replace", "pedal-damaged", "replace-pedals", 2),
];

async function seedGuestList(page: import("@playwright/test").Page): Promise<void> {
  const raw = JSON.stringify({
    version: 1,
    items: GUEST_LINES,
    updatedAt: new Date().toISOString(),
  });
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

function card(page: import("@playwright/test").Page, partId: string) {
  return page.locator(`[data-testid="build-item"][data-part-id="${partId}"]`);
}

forEachLocale((locale) => {
  test(`the brand tier is asked where brands.yaml covers the part, and reaches the search (${locale})`, async ({
    page,
  }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));

    const chain = card(page, "chain");
    const tier = chain.locator('[data-question="brand-tier"]');
    await expect(tier).toBeVisible();
    // Any, then the three tiers, in the page's language.
    await expect(tier.locator("option")).toHaveText([
      SHOP_T[locale].brand.any,
      SHOP_T[locale].tiers.entry,
      SHOP_T[locale].tiers.mid,
      SHOP_T[locale].tiers.high,
    ]);

    const rose = chain.locator('a[data-retailer="rosebikes"]');
    await expect(rose).not.toHaveAttribute("href", new RegExp(CHAIN_MID_BRAND));
    await tier.selectOption("mid");
    await expect(rose).toHaveAttribute("href", new RegExp(`${CHAIN_MID_BRAND}$`));

    // The crankset has questions of its own, and no brands in the file: no tier.
    const crankset = card(page, "crankset");
    await expect(crankset.locator("[data-question]").first()).toBeVisible();
    await expect(crankset.locator('[data-question="brand-tier"]')).toHaveCount(0);
  });

  test(`"how to measure" shows the existing drawing, with its legend (${locale})`, async ({
    page,
  }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));

    const pedal = card(page, "pedal-left");
    await expect(pedal.locator('[data-question="pedal-type"]')).toBeVisible();
    const figure = pedal.locator('[data-measure-drawing="ill-pedals"]');
    // One drawing on this card — the pedal type's; the cleat and the tier have none.
    await expect(pedal.locator("[data-measure-drawing]")).toHaveCount(1);
    // Collapsed with its disclosure until asked for.
    await expect(figure).toBeHidden();

    // `has` is resolved inside the outer match, hence a fresh page locator.
    await pedal
      .locator('details[data-slot="disclosure"]', {
        has: page.locator('[data-measure-drawing="ill-pedals"]'),
      })
      .locator("summary")
      .click();
    await expect(figure).toBeVisible();

    // Decorative (the question's own help says what to read), so no second
    // `<title id>` when the same drawing lands in two cards…
    const drawing = figure.locator("svg").first();
    await expect(drawing).toHaveAttribute("aria-hidden", "true");
    await expect(drawing.locator("title")).toHaveCount(0);
    // …and every numbered callout keeps its legend line.
    const callouts = ILLUSTRATIONS_T[locale]["ill-pedals"].callouts;
    await expect(drawing.locator("[data-callout]")).toHaveCount(Object.keys(callouts).length);
    // Each legend line: the drawing's number (aria-hidden, like the digit on the
    // frame), then what that number points at.
    const legend = figure.locator("figcaption li");
    await expect(legend.locator('span[aria-hidden="true"]')).toHaveText(Object.keys(callouts));
    await expect(legend.locator("span:not([aria-hidden])")).toHaveText(Object.values(callouts));

    // A line whose questions have no drawing shows none.
    await expect(card(page, "chain").locator("[data-measure-drawing]")).toHaveCount(0);
  });
});

// ── doneReason, on an account ────────────────────────────────────────────────

async function withDb<T>(run: (client: ClientBase) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: resolveTestEnv().POSTGRES_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * An account whose list holds a line a later checkup closed (`recheck-ok`, as
 * `closeRecheckedItems` writes it), a line ticked by hand (`manual`), and an
 * open one.
 */
async function accountWithClosedLines(label: string): Promise<{
  user: { id: string; email: string };
  bikeId: string;
  listId: string;
}> {
  return withDb(async (client) => {
    const email = `donereason+${label}@velo-atelier.test`;
    const { rows: users } = await client.query<{ id: string }>(
      `INSERT INTO "User" (name, email, locale, "updatedAt") VALUES ('Camille', $1, 'fr', now())
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [email],
    );
    const userId = users[0].id;
    await client.query(`DELETE FROM "Bike" WHERE "userId" = $1`, [userId]);
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
    await client.query(
      `INSERT INTO "BuildListItem"
         ("buildListId", "partId", action, "reasonKey", "guideSlug", done, "doneReason", "sortOrder", "updatedAt")
       VALUES ($1, 'chain', 'REPLACE', 'chain-elongation', 'replace-chain', true, 'recheck-ok', 0, now()),
              ($1, 'cassette', 'REPLACE', 'cassette-worn', 'replace-cassette', true, 'manual', 1, now()),
              ($1, 'brake-pads-rear', 'REPLACE', 'pad-worn', 'replace-brake-pads-disc', false, NULL, 2, now())`,
      [lists[0].id],
    );
    return { user: { id: userId, email }, bikeId: bikes[0].id, listId: lists[0].id };
  });
}

async function doneReasonOf(listId: string, partId: string): Promise<string | null> {
  return withDb(async (client) => {
    const { rows } = await client.query<{ doneReason: string | null }>(
      `SELECT "doneReason" FROM "BuildListItem" WHERE "buildListId" = $1 AND "partId" = $2`,
      [listId, partId],
    );
    return rows[0]?.doneReason ?? null;
  });
}

forEachLocale((locale) => {
  test(`an account's line closed by a later checkup says so; a hand tick is "manual" (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId, listId } = await accountWithClosedLines(
      `${locale}-${testInfo.project.name}`,
    );
    await signedInContext(user);
    let posts = 0;
    page.on("response", (response) => {
      if (response.request().method() === "POST") posts += 1;
    });
    await page.goto(href(locale, "/velo/[id]/liste", { id: bikeId }));

    const auto = SHOP_T[locale].list.done.auto;
    await expect(card(page, "chain").getByTestId("build-item-done")).toBeChecked();
    await expect(card(page, "chain")).toContainText(auto);
    // Done too, but by the visitor: no note.
    await expect(card(page, "cassette").getByTestId("build-item-done")).toBeChecked();
    await expect(card(page, "cassette")).not.toContainText(auto);

    // Ticked by hand here: stored as `manual`, and still no note after a reload.
    const pads = card(page, "brake-pads-rear");
    await expect(pads).not.toContainText(auto);
    await pads.getByTestId("build-item-done").check();
    await expect.poll(() => posts).toBeGreaterThanOrEqual(1);
    await expect.poll(() => doneReasonOf(listId, "brake-pads-rear")).toBe("manual");

    await page.reload();
    await expect(card(page, "brake-pads-rear").getByTestId("build-item-done")).toBeChecked();
    await expect(card(page, "brake-pads-rear")).not.toContainText(auto);
    await expect(card(page, "chain")).toContainText(auto);
  });
});
