/**
 * The build list (§6.5, §6.8 AC5 and AC7).
 *
 * The list is where a checkup stops being a verdict and becomes a shopping
 * trip, so what is checked here is what a visitor does with it: read the three
 * vendor links, narrow a part down, notice that their choice does not fit the
 * bike, tick a line off, and print the rest to take to the shop.
 *
 * Two entry points, because a list lives in two places and the page must not
 * care which (§5.5):
 *
 *   `va:buildlist:demo`   a guest's list, seeded here the way the wizard writes
 *                         it, read by the browser after hydration;
 *   the seeded row        "Révision printemps" on the FR demo account's gravel
 *                         bike, two REPLACE lines (Appendix B).
 *
 * This spec is one of the four that also run at 320 px (`mobile-narrow`,
 * playwright.config.ts): the list is the page a visitor reads standing in a
 * bike shop, on the narrowest phone they own. Every test runs in FR and EN,
 * against each locale's own shops and strings.
 */
/* eslint-disable security/detect-object-injection -- locale-keyed fixtures indexed by a Locale literal */
import { Client } from "pg";

import { DEMO_BIKE_GUEST_IDS, DEMO_USER } from "../../prisma/seed-data";
import { buildOf, deriveBike } from "../../lib/bike/rules";
import { buildListKey } from "../../lib/bike/storage-keys";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";
import { resolveTestEnv } from "../_fakes/db";

import enShop from "../../messages/en/shop.json";
import frShop from "../../messages/fr/shop.json";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";

const SHOP_T: Record<Locale, typeof frShop> = { fr: frShop, en: enShop };

/** "{done} sur {total} fait" / "{done} of {total} done", filled in. */
function doneState(locale: Locale, done: number, total: number): string {
  return SHOP_T[locale].list.done.state
    .replace("{done}", String(done))
    .replace("{total}", String(total));
}

/** The exact URLs the chain of the demo (gravel) bike produces, per locale. */
const CHAIN_LINKS: Record<Locale, Record<string, string>> = {
  fr: {
    rosebikes: "https://www.rosebikes.fr/search?q=cha%C3%AEne%2011%20vitesses",
    alltricks: "https://www.alltricks.fr/C-40598-toutes-les-chaines",
    decathlon: "https://www.decathlon.fr/search?Ntt=cha%C3%AEne%2011%20vitesses",
  },
  en: {
    rosebikes: "https://www.rosebikes.com/search?q=chain%2011%20speed",
    alltricks: "https://www.alltricks.com/C-40598-chains",
    decathlon: "https://www.decathlon.co.uk/search?Ntt=chain%2011%20speed",
  },
};

const OUTBOUND_REL = "noopener noreferrer nofollow";

interface SeedItem {
  id: string;
  partId: string;
  action: string;
  reasonKey: string;
  guideSlug?: string;
  done?: boolean;
  sortOrder: number;
}

function line(partId: string, reasonKey: string, guideSlug: string, sortOrder: number): SeedItem {
  return {
    id: `seed#${partId}|${partId}|replace`,
    partId,
    action: "replace",
    reasonKey,
    guideSlug,
    done: false,
    sortOrder,
  };
}

/** The list the wizard would have written for the demo bike: a chain and a cassette. */
const GUEST_ITEMS: SeedItem[] = [
  line("chain", "chain-elongation", "replace-chain", 0),
  line("cassette", "cassette-worn", "replace-cassette", 1),
];

/**
 * Put a list under `va:buildlist:demo` before the page loads.
 *
 * `addInitScript`, not a `page.evaluate` after a `goto`: the component reads
 * storage on its first render, so a list written afterwards would arrive one
 * hydration too late. It never overwrites what the page has since written —
 * a reload is exactly how these tests prove a tick was persisted.
 */
async function seedGuestList(
  page: import("@playwright/test").Page,
  items: SeedItem[] = GUEST_ITEMS,
): Promise<void> {
  const raw = JSON.stringify({
    version: 1,
    items: items.map((item) => ({ ...item, sourceKeys: [item.id], stepKey: item.id })),
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

async function storedGuestList(page: import("@playwright/test").Page): Promise<SeedItem[]> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), buildListKey("demo"));
  return raw === null ? [] : (JSON.parse(raw) as { items: SeedItem[] }).items;
}

/** The seeded gravel bike's row id — the same lookup `fit.spec.ts` uses. */
async function gravelBikeId(): Promise<string> {
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
 * A user, a gravel bike and an open list of their own.
 *
 * The seeded "Révision printemps" is READ by the test above and must stay as it
 * was found: five Playwright projects run this file against ONE database, and a
 * test that ticks a seeded line off is a test that fails whenever another
 * project is between its check and its uncheck. A test that WRITES gets its own
 * rows instead.
 */
async function ownBikeWithList(
  label: string,
  locale: Locale,
): Promise<{
  user: { id: string; email: string; locale: Locale };
  bikeId: string;
}> {
  const client = new Client({ connectionString: resolveTestEnv().POSTGRES_URL });
  await client.connect();
  try {
    const email = `buildlist+${label}@velo-atelier.test`;
    const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    const build = buildOf(derived);

    const { rows: users } = await client.query<{ id: string }>(
      // `updatedAt` is Prisma's `@updatedAt`, filled in by the client rather
      // than by a column default: raw SQL has to set it itself.
      `INSERT INTO "User" (name, email, locale, "updatedAt") VALUES ($1, $2, $3::"UserLocale", now())
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      ["Camille", email, locale],
    );
    const userId = users[0].id;
    await client.query(`DELETE FROM "Bike" WHERE "userId" = $1`, [userId]);

    const { rows: bikes } = await client.query<{ id: string }>(
      `INSERT INTO "Bike" ("userId", name, answers, spec, parts, "updatedAt")
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
      // Stringified: `pg` turns a JS array into a Postgres ARRAY literal, not
      // into JSON, and `parts` is an array.
      [
        userId,
        "Gravel",
        JSON.stringify(derived.answers),
        JSON.stringify(build.spec),
        JSON.stringify(build.parts),
      ],
    );
    const bikeId = bikes[0].id;

    const { rows: lists } = await client.query<{ id: string }>(
      `INSERT INTO "BuildList" ("bikeId", name, "updatedAt") VALUES ($1, $2, now()) RETURNING id`,
      [bikeId, "Révision"],
    );
    await client.query(
      `INSERT INTO "BuildListItem"
         ("buildListId", "partId", action, "reasonKey", "guideSlug", "sortOrder", "updatedAt")
       VALUES ($1, 'chain', 'REPLACE', 'chain-elongation', 'replace-chain', 0, now()),
              ($1, 'brake-pads-rear', 'REPLACE', 'pad-worn', 'replace-brake-pads-disc', 1, now())`,
      [lists[0].id],
    );
    return { user: { id: userId, email, locale }, bikeId };
  } finally {
    await client.end();
  }
}

/**
 * Count the server actions a page fires.
 *
 * The list updates optimistically — a checkbox that waits for a round trip
 * reads as broken — so a reload placed straight after a click can outrun the
 * write and cancel it. A test that then asserts on what the DATABASE holds has
 * to wait for the write, and a server action is a POST to the page's own URL.
 */
function countServerActions(page: import("@playwright/test").Page): () => number {
  let posts = 0;
  page.on("response", (response) => {
    if (response.request().method() === "POST") posts += 1;
  });
  return () => posts;
}

// ── §6.8 AC7 — the vendor links ──────────────────────────────────────────────

forEachLocale((locale) => {
  test(`a replace line carries the three vendor links, encoded, with the exact rel (${locale})`, async ({
    page,
  }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));

    const chain = page.locator('[data-testid="build-item"][data-part-id="chain"]');
    await expect(chain).toBeVisible();

    const links = chain.locator("a[data-outbound]");
    await expect(links).toHaveCount(3);

    for (const [retailer, url] of Object.entries(CHAIN_LINKS[locale])) {
      const link = chain.locator(`a[data-retailer="${retailer}"]`);
      await expect(link).toHaveAttribute("href", url);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", OUTBOUND_REL);
    }
  });
});

forEachLocale((locale) => {
  test(`every outbound link on the page announces its new window (${locale})`, async ({ page }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));
    // The list is written by the browser after hydration: count nothing before it.
    await expect(page.locator('[data-testid="build-item"]').first()).toBeVisible();

    const links = page.locator("a[data-outbound]");
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(6);
    for (let index = 0; index < count; index += 1) {
      await expect(links.nth(index)).toContainText(SHOP_T[locale].outbound.newWindow);
    }
  });

  test(`clicking a vendor link leaves the page alone and calls nothing (${locale})`, async ({
    page,
    context,
  }) => {
    // Nothing in this suite may reach a real shop, so every request that is not
    // this server's is refused — and the refusals are recorded, because "zero
    // network calls on click" has to mean the page made none of its own either.
    const external: string[] = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("http://localhost") || url.startsWith("data:")) return route.continue();
      external.push(url);
      return route.abort();
    });

    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));
    const before = page.url();

    const chain = page.locator('[data-testid="build-item"][data-part-id="chain"]');
    await chain.locator('a[data-retailer="rosebikes"]').click();

    await expect(page).toHaveURL(before);
    // The only external URL a click may produce is the shop the visitor chose.
    const chosenShop = `${new URL(CHAIN_LINKS[locale].rosebikes).origin}/`;
    expect(external.filter((url) => !url.startsWith(chosenShop))).toEqual([]);
  });

  // ── §6.8 AC7 — the compatibility callout ─────────────────────────────────────

  test(`an incompatible refinement interrupts with a role=alert callout (${locale})`, async ({
    page,
  }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));

    const cassette = page.locator('[data-testid="build-item"][data-part-id="cassette"]');
    await expect(cassette.locator('[data-testid="build-item-compat"]')).toHaveCount(0);

    // The gravel bike's rear derailleur takes 42 teeth at most.
    await cassette.locator('[data-question="largest-cog"]').fill("50");

    const callout = cassette.locator('[data-testid="build-item-compat"]');
    await expect(callout).toBeVisible();
    await expect(callout).toHaveAttribute("role", "alert");
    // Translated, not a raw message key.
    expect(await callout.textContent()).not.toContain("rules.");
  });

  test(`a refinement that fits the bike says nothing (${locale})`, async ({ page }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));

    const cassette = page.locator('[data-testid="build-item"][data-part-id="cassette"]');
    await cassette.locator('[data-question="largest-cog"]').fill("40");
    await expect(cassette.locator('[data-testid="build-item-compat"]')).toHaveCount(0);
  });

  test(`a refinement follows into the vendor query and survives a reload (${locale})`, async ({
    page,
  }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));

    const cassette = page.locator('[data-testid="build-item"][data-part-id="cassette"]');
    await cassette.locator('[data-question="range"]').selectOption("11-34");
    await expect(cassette.locator('a[data-retailer="rosebikes"]')).toHaveAttribute("href", /11-34/);

    await page.reload();
    await expect(
      page
        .locator('[data-testid="build-item"][data-part-id="cassette"]')
        .locator('[data-question="range"]'),
    ).toHaveValue("11-34");
  });

  // ── The list a visitor works ─────────────────────────────────────────────────

  test(`an empty list offers a checkup rather than an empty page (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));
    await expect(page.getByTestId("build-list-empty")).toBeVisible();
    await expect(page.getByTestId("build-list-start-checkup")).toHaveAttribute(
      "href",
      href(locale, "/velo/[id]/controle", { id: "demo" }),
    );
  });

  test(`ticking a line off is remembered, hidden, and then cleared (${locale})`, async ({
    page,
  }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));

    const chain = page.locator('[data-testid="build-item"][data-part-id="chain"]');
    await chain.getByTestId("build-item-done").check();
    await expect(page.getByTestId("build-list-state")).toHaveText(doneState(locale, 1, 2));

    await page.reload();
    expect((await storedGuestList(page)).find((item) => item.partId === "chain")?.done).toBe(true);
    await expect(page.getByTestId("build-list-state")).toHaveText(doneState(locale, 1, 2));

    await page.getByTestId("build-list-hide-done").check();
    await expect(page.locator('[data-testid="build-item"]')).toHaveCount(1);

    await page.getByTestId("build-list-hide-done").uncheck();
    await page.getByTestId("build-list-clear-done").click();
    await expect(page.locator('[data-testid="build-item"]')).toHaveCount(1);
    expect((await storedGuestList(page)).map((item) => item.partId)).toEqual(["cassette"]);
  });

  test(`each line links to its guide and to the buying help (${locale})`, async ({ page }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));

    const chain = page.locator('[data-testid="build-item"][data-part-id="chain"]');
    await expect(chain.getByTestId("build-item-guide")).toHaveAttribute(
      "href",
      href(locale, "/guides/[slug]", { slug: "replace-chain" }),
    );
    await expect(chain.getByTestId("build-item-buying-guide")).toHaveAttribute(
      "href",
      `${href(locale, "/acheter")}?part=chain&bike=demo&item=${encodeURIComponent(GUEST_ITEMS[0].id)}`,
    );
  });

  // ── The saved bike's list ────────────────────────────────────────────────────

  test(`the seeded list opens on the account's gravel bike (${locale})`, async ({
    page,
    signedInContext,
  }) => {
    await signedInContext();
    const id = await gravelBikeId();
    await page.goto(href(locale, "/velo/[id]/liste", { id }));

    const items = page.locator('[data-testid="build-item"]');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveAttribute("data-part-id", "chain");
    await expect(items.nth(1)).toHaveAttribute("data-part-id", "brake-pads-rear");
    await expect(items.nth(0).getByTestId("build-item-chosen")).toContainText("CN-HG601");
  });

  test(`ticking a saved line off reaches the database (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await ownBikeWithList(`${locale}-${testInfo.project.name}`, locale);
    await signedInContext(user);
    const written = countServerActions(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: bikeId }));

    const pads = page.locator('[data-testid="build-item"][data-part-id="brake-pads-rear"]');
    await pads.getByTestId("build-item-done").check();
    await expect(page.getByTestId("build-list-state")).toHaveText(doneState(locale, 1, 2));

    await expect.poll(written).toBeGreaterThanOrEqual(1);
    await page.reload();
    await expect(
      page
        .locator('[data-testid="build-item"][data-part-id="brake-pads-rear"]')
        .getByTestId("build-item-done"),
    ).toBeChecked();
  });

  test(`clearing the done lines of a saved list removes the rows (${locale})`, async ({
    page,
    signedInContext,
  }, testInfo) => {
    const { user, bikeId } = await ownBikeWithList(
      `clear-${locale}-${testInfo.project.name}`,
      locale,
    );
    await signedInContext(user);
    const written = countServerActions(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: bikeId }));

    await page
      .locator('[data-testid="build-item"][data-part-id="chain"]')
      .getByTestId("build-item-done")
      .check();
    await page.getByTestId("build-list-clear-done").click();
    await expect(page.locator('[data-testid="build-item"]')).toHaveCount(1);

    // The tick AND the clear: the clear deletes by LIST, so it has to reach the
    // server after the update that made a line done (`BuildList` queues them).
    await expect.poll(written).toBeGreaterThanOrEqual(2);
    await page.reload();
    const left = page.locator('[data-testid="build-item"]');
    await expect(left).toHaveCount(1);
    await expect(left).toHaveAttribute("data-part-id", "brake-pads-rear");
  });

  // ── §6.8 AC7 — print ─────────────────────────────────────────────────────────

  test(`print emulation drops the site chrome and keeps the list (${locale})`, async ({ page }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));
    await expect(page.locator("[data-site-header]")).toBeVisible();

    await page.emulateMedia({ media: "print" });

    await expect(page.locator("[data-site-header]")).toBeHidden();
    await expect(page.locator("[data-site-footer]")).toBeHidden();
    await expect(page.locator("nav").first()).toBeHidden();
    await expect(page.getByTestId("build-list-print")).toBeHidden();
    await expect(page.getByTestId("build-list-hide-done")).toBeHidden();
    // What is printed is the content.
    await expect(page.locator('[data-testid="build-item"]').first()).toBeVisible();
  });

  test(`print emulation drops the 3D canvas (${locale}) @webgl`, async ({ page, webgl }) => {
    test.skip(!webgl, "no canvas without WebGL");
    await page.goto(href(locale, "/velo/[id]", { id: "demo" }));
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible({ timeout: 20_000 });

    await page.emulateMedia({ media: "print" });
    await expect(canvas).toBeHidden();
  });

  // ── §6.8 AC5 — tap targets ───────────────────────────────────────────────────

  test(`every control on the list is at least 44x44 CSS px (${locale})`, async ({ page }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));
    await expect(page.locator('[data-testid="build-item"]').first()).toBeVisible();

    const selector = [
      '[data-testid="build-list"] a[data-outbound]',
      '[data-testid="build-list"] button',
      '[data-testid="build-list"] select',
      '[data-testid="build-list"] input[type="number"]',
      '[data-testid="build-list"] label:has(input[type="checkbox"])',
      '[data-testid="build-item-guide"]',
      '[data-testid="build-item-buying-guide"]',
    ].join(", ");

    const small = await page.evaluate((query) => {
      const tooSmall: string[] = [];
      for (const node of document.querySelectorAll<HTMLElement>(query)) {
        const box = node.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue; // not rendered (print-only, collapsed)
        if (box.width < 44 || box.height < 44) {
          tooSmall.push(
            `${node.tagName.toLowerCase()} ${Math.round(box.width)}x${Math.round(box.height)}: ${node.textContent?.trim().slice(0, 40) ?? ""}`,
          );
        }
      }
      return tooSmall;
    }, selector);

    expect(small, "every tap target on /velo/demo/liste must be ≥ 44x44 (§6.8 AC5)").toEqual([]);
  });

  test(`a number field is at least 16 px, so iOS does not zoom the page (${locale})`, async ({
    page,
  }) => {
    await seedGuestList(page);
    await page.goto(href(locale, "/velo/[id]/liste", { id: "demo" }));
    await expect(page.locator('[data-question="largest-cog"]')).toBeVisible();

    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')].map((node) =>
        Number.parseFloat(getComputedStyle(node).fontSize),
      ),
    );
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
  });
});
