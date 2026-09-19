/**
 * `/acheter` · `/shop` — the category grid and the free-text box (§5.5).
 *
 * The page is prerendered, and that is load-bearing: both YAML files behind it
 * are read at build time (`lib/shop/retailers.ts`). So the grid has to be in
 * the HTML, not fetched — and the one thing that would quietly break it, a
 * `useSearchParams` consumer outside a `<Suspense>` boundary, is what the
 * prerender-manifest assertion at the bottom of this file is for.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SHOP_CATEGORIES } from "../../lib/shop/retailers";

import { expect, forEachLocale, href, test } from "./_fixtures";

const OUTBOUND_REL = "noopener noreferrer nofollow";
const RETAILERS = ["rosebikes", "alltricks", "decathlon"];

forEachLocale((locale) => {
  test(`the grid lists every category, three shops each (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/acheter"));

    const grid = page.getByTestId("category-grid");
    await expect(grid).toBeVisible();

    const cards = grid.locator("[data-category]:not(a)");
    await expect(cards).toHaveCount(SHOP_CATEGORIES.length);
    expect(SHOP_CATEGORIES.length).toBeGreaterThanOrEqual(8);

    for (const category of SHOP_CATEGORIES) {
      const card = grid.locator(`div[data-category="${category.id}"]`);
      await expect(card).toBeVisible();
      await expect(card.getByText(category.label[locale], { exact: false }).first()).toBeVisible();
      for (const retailer of RETAILERS) {
        const link = card.locator(`a[data-retailer="${retailer}"]`);
        await expect(link).toHaveAttribute("rel", OUTBOUND_REL);
        await expect(link).toHaveAttribute("target", "_blank");
        expect(await link.getAttribute("href")).toMatch(/^https:\/\//);
      }
    }
  });
});

test("a category title opens its part panel", async ({ page }) => {
  await page.goto(href("fr", "/acheter"));
  await page.getByTestId("category-link-chains").click();

  await expect(page).toHaveURL(new RegExp(`${href("fr", "/acheter")}\\?part=chain$`));
  await expect(page.getByTestId("part-questions")).toHaveAttribute("data-part-id", "chain");
});

test("the English page is /shop and its cards link to the English shops", async ({ page }) => {
  await page.goto(href("en", "/acheter"));
  expect(new URL(page.url()).pathname).toBe("/en/shop");
  await expect(
    page.locator('div[data-category="chains"] a[data-retailer="rosebikes"]'),
  ).toHaveAttribute("href", "https://www.rosebikes.com/search?q=bike%20chain");
});

test("the free-text box offers nothing until something is typed", async ({ page }) => {
  await page.goto(href("fr", "/acheter"));
  await expect(page.getByTestId("vendor-search-empty")).toBeVisible();
  await expect(page.getByTestId("vendor-search-links")).toHaveCount(0);
});

test("what is typed becomes the search at the three shops, encoded", async ({ page }) => {
  await page.goto(href("fr", "/acheter"));
  await page.getByTestId("vendor-search-input").fill("chaîne 11 vitesses");

  await expect(page.getByTestId("vendor-search-rosebikes")).toHaveAttribute(
    "href",
    "https://www.rosebikes.fr/search?q=cha%C3%AEne%2011%20vitesses",
  );
  await expect(page.getByTestId("vendor-search-decathlon")).toHaveAttribute(
    "href",
    "https://www.decathlon.fr/search?Ntt=cha%C3%AEne%2011%20vitesses",
  );
  for (const retailer of RETAILERS) {
    await expect(page.getByTestId(`vendor-search-${retailer}`)).toHaveAttribute(
      "rel",
      OUTBOUND_REL,
    );
  }
});

test("a pasted mess is cleaned before it becomes a URL", async ({ page }) => {
  await page.goto(href("fr", "/acheter"));
  await page.getByTestId("vendor-search-input").fill("   chaîne    11   vitesses   ");
  await expect(page.getByTestId("vendor-search-rosebikes")).toHaveAttribute(
    "href",
    "https://www.rosebikes.fr/search?q=cha%C3%AEne%2011%20vitesses",
  );
});

test("the page says plainly that nothing here is affiliated", async ({ page }) => {
  await page.goto(href("fr", "/acheter"));
  await expect(page.getByText(/sans affiliation ni suivi/)).toBeVisible();
});

/**
 * The route is PRERENDERED, asserted on the build output.
 *
 * This is the one that matters, and it has to read the manifest rather than the
 * page. `content/shop/categories.yaml` is read with `readFileSync` at module
 * scope (`lib/shop/retailers.ts`); on a prerendered route that happens at build
 * time and the grid is baked into the HTML, on a per-request route it happens
 * per request — and Next's output tracing does not follow a computed
 * `readFileSync` path, so the file is simply absent from the deployment. That
 * failure is invisible to every test that only looks at the rendered page:
 * `next start` serves from the checkout, where the YAML is still on disk, so a
 * dynamic `/acheter` renders a perfect grid locally and 500s in production.
 * Verified by mutation — adding `export const dynamic = "force-dynamic"` to the
 * page turned the build's `● /fr/acheter` into `ƒ /[locale]/acheter` and left
 * every other test in this file green, this one included until it read the
 * manifest.
 *
 * `.next/prerender-manifest.json` is present wherever the e2e tier runs: the
 * suite needs `npm run start`, and CI's e2e job downloads the whole `next-build`
 * artifact into `.next/` before it starts.
 */
test("/acheter is prerendered, in both locales", () => {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), ".next", "prerender-manifest.json"), "utf8"),
  ) as { routes?: Record<string, unknown> };
  const prerendered = Object.keys(manifest.routes ?? {});

  expect(
    prerendered,
    "/acheter must stay prerendered: content/**.yaml is read at module scope and " +
      "Next's tracing does not copy it into a per-request deployment (§5.5)",
  ).toEqual(expect.arrayContaining(["/fr/acheter", "/en/acheter"]));
});

test.describe("without JavaScript", () => {
  // The grid is server-rendered markup, not something hydration builds. This
  // says nothing about WHEN it was rendered — the assertion above owns that.
  test.use({ javaScriptEnabled: false });

  test("the grid is in the HTML, not built after hydration", async ({ page }) => {
    await page.goto(href("fr", "/acheter"));
    await expect(page.getByTestId("category-grid")).toBeVisible();
    await expect(page.locator("div[data-category]")).toHaveCount(SHOP_CATEGORIES.length);
    await expect(
      page.locator('div[data-category="chains"] a[data-retailer="rosebikes"]'),
    ).toHaveAttribute("href", "https://www.rosebikes.fr/search?q=cha%C3%AEne%20v%C3%A9lo");
  });
});

test("every control on the page is at least 44x44 CSS px", async ({ page }) => {
  await page.goto(href("fr", "/acheter"));
  await expect(page.getByTestId("category-grid")).toBeVisible();

  const small = await page.evaluate(() => {
    const query =
      '[data-testid="category-grid"] a, [data-testid="vendor-search"] :is(a, input, button)';
    const tooSmall: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>(query)) {
      const box = node.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.width < 44 || box.height < 44) {
        tooSmall.push(
          `${node.tagName.toLowerCase()} ${Math.round(box.width)}x${Math.round(box.height)}: ${node.textContent?.trim().slice(0, 30) ?? ""}`,
        );
      }
    }
    return tooSmall;
  });
  expect(small, "every tap target on /acheter must be ≥ 44x44 (§6.8 AC5)").toEqual([]);
});
