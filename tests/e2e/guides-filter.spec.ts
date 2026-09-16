/**
 * `/guides` and its client filter (§6.2, §6.7) against the production build.
 *
 *   - the list is server-rendered with every guide of the locale;
 *   - `?kind=` / `?system=` narrow it; unknown values are ignored;
 *   - changing a filter rewrites the URL with `replaceState` — no navigation,
 *     no server request;
 *   - no result → "Aucun guide" + reset (§6.7);
 *   - "Pour mon vélo" follows the guest bike stored in `va:bike:local`.
 *
 * Counts come from `content/guides/` on disk, never from literals, so W2's
 * guides do not break this spec.
 */
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- locale-keyed catalogues, fixed content paths, patterns built from repo slugs */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter } from "../../lib/content/frontmatter";
import { GuideFrontmatterSchema } from "../../lib/content/schema";
import enGuides from "../../messages/en/guides.json";
import frGuides from "../../messages/fr/guides.json";
import { BIKE_PRESETS } from "../../lib/domain/data/presets";

import { expect, forEachLocale, href, test } from "./_fixtures";

const GUIDES_DIR = join(process.cwd(), "content", "guides");
const T = { fr: frGuides, en: enGuides };

const guides = readdirSync(GUIDES_DIR)
  .sort()
  .map((slug) =>
    GuideFrontmatterSchema.parse(
      parseFrontmatter(readFileSync(join(GUIDES_DIR, slug, "fr.mdx"), "utf8"))?.data,
    ),
  );
const slugsWhere = (predicate: (g: (typeof guides)[number]) => boolean) =>
  guides
    .filter(predicate)
    .map((g) => g.slug)
    .sort();

forEachLocale((locale) => {
  const t = T[locale];
  const list = (page: import("@playwright/test").Page) =>
    page.getByTestId("guide-list").locator("article");
  const shownSlugs = async (page: import("@playwright/test").Page) =>
    (
      await list(page).evaluateAll((cards) => cards.map((c) => c.getAttribute("data-guide-slug")))
    ).sort();

  test(`lists every guide (${locale})`, async ({ page }) => {
    const response = await page.goto(href(locale, "/guides"));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.list.title);
    await expect(list(page)).toHaveCount(guides.length);
  });

  test(`?kind= narrows the list and unknown values are ignored (${locale})`, async ({ page }) => {
    await page.goto(`${href(locale, "/guides")}?kind=clean`);
    await expect(page.getByTestId("guide-filters")).toBeVisible();
    await expect(list(page)).toHaveCount(slugsWhere((g) => g.kind === "clean").length);
    expect(await shownSlugs(page)).toEqual(slugsWhere((g) => g.kind === "clean"));

    await page.goto(`${href(locale, "/guides")}?kind=bogus&system=nope`);
    await expect(page.getByTestId("guide-filters")).toBeVisible();
    await expect(list(page)).toHaveCount(guides.length);
  });

  test(`changing a filter rewrites the URL without a request (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/guides"));
    await expect(page.getByTestId("guide-filters")).toBeVisible();
    const requests: string[] = [];
    page.on("request", (request) => {
      // Link prefetches of cards scrolling into view (and of the header links)
      // are not the filter talking to the server; a navigation or an RSC fetch is.
      if (request.headers()["next-router-prefetch"]) return;
      if (request.resourceType() === "document" || request.url().includes("_rsc"))
        requests.push(request.url());
    });

    await page.getByRole("combobox", { name: t.filters.system }).selectOption("brakes");
    await expect(page).toHaveURL(/\?system=brakes$/);
    const brakes = slugsWhere((g) => g.partIds.some((id) => /^(brake|rotor)-/.test(id)));
    await expect(list(page)).toHaveCount(brakes.length);

    await page.getByRole("combobox", { name: t.filters.kind }).selectOption("check");
    await expect(page).toHaveURL(/\?system=brakes&kind=check$/);
    await expect(list(page)).toHaveCount(
      slugsWhere((g) => g.kind === "check" && brakes.includes(g.slug)).length,
    );
    expect(requests).toEqual([]);
  });

  test(`no result shows "no guide" and a reset (${locale})`, async ({ page }) => {
    await page.goto(`${href(locale, "/guides")}?kind=clean&system=suspension`);
    const empty = page.getByTestId("guides-empty");
    await expect(empty).toContainText(t.list.empty);
    await empty.getByRole("button", { name: t.list.reset }).click();
    await expect(page).toHaveURL(new RegExp(`${href(locale, "/guides")}$`));
    await expect(list(page)).toHaveCount(guides.length);
  });

  test(`"for my bike" hides the guides that do not apply (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/guides"));
    const toggle = page.getByRole("checkbox", { name: t.filters.forMyBike });
    await expect(toggle).toBeDisabled();

    await page.evaluate(
      (answers) =>
        window.localStorage.setItem("va:bike:local", JSON.stringify({ version: 1, answers })),
      BIKE_PRESETS["road-rim-2x11"],
    );
    await page.reload();
    await expect(toggle).toBeEnabled();
    await toggle.check();
    await expect(page).toHaveURL(/\?bike=local$/);
    // A rim-brake road bike: no disc-brake guide.
    const disc = slugsWhere((g) => JSON.stringify(g.appliesTo ?? {}).includes("isDisc"));
    for (const slug of disc)
      await expect(page.locator(`[data-guide-slug="${slug}"]`)).toHaveCount(0);
    await expect(list(page)).toHaveCount(guides.length - disc.length);
  });

  test(`a card opens its guide (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/guides"));
    const first = list(page).first();
    const slug = await first.getAttribute("data-guide-slug");
    await first.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/guides/${slug}$`));
  });
});
