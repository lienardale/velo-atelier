/**
 * `/acheter` · `/shop` — the category grid and the free-text box (§5.5).
 *
 * The page is prerendered, and that is load-bearing: both YAML files behind it
 * are read at build time (`lib/shop/retailers.ts`). So the grid has to be in
 * the HTML, not fetched — and the one thing that would quietly break it, a
 * `useSearchParams` consumer outside a `<Suspense>` boundary, is what the
 * prerender-manifest assertion at the bottom of this file is for.
 *
 * Every test runs in FR and EN, with each locale's own shops and queries —
 * except that manifest assertion, which reads the build output rather than a
 * page and names both locales' routes itself.
 */
/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp -- locale-keyed fixtures indexed by a Locale literal, and one pattern built from href() */
import type { Locator, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SHOP_CATEGORIES } from "../../lib/shop/retailers";

import enShop from "../../messages/en/shop.json";
import frShop from "../../messages/fr/shop.json";

import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";

const OUTBOUND_REL = "noopener noreferrer nofollow";
const SHOP_T: Record<Locale, typeof frShop> = { fr: frShop, en: enShop };
const RETAILERS = ["rosebikes", "alltricks", "decathlon"];

/**
 * What the disclosure must SAY, in each language. Rendering `outbound.disclosure`
 * proves only that the key renders: an edit that dropped the promise from the
 * message would render just as well.
 */
const NO_AFFILIATION: Record<Locale, RegExp> = {
  fr: /sans affiliation ni suivi/,
  en: /no affiliation and no tracking/,
};

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

/** The chains card's Rose link, per locale — its query is `content/shop/categories.yaml`'s. */
const CHAINS_CARD_ROSE: Record<Locale, string> = {
  fr: "https://www.rosebikes.fr/search?q=cha%C3%AEne%20v%C3%A9lo",
  en: "https://www.rosebikes.com/search?q=bike%20chain",
};

/** The free-text box: what a visitor types, and what two of the shops are then asked. */
const TYPED: Record<Locale, { text: string; messy: string; rosebikes: string; decathlon: string }> =
  {
    fr: {
      text: "chaîne 11 vitesses",
      messy: "   chaîne    11   vitesses   ",
      rosebikes: "https://www.rosebikes.fr/search?q=cha%C3%AEne%2011%20vitesses",
      decathlon: "https://www.decathlon.fr/search?Ntt=cha%C3%AEne%2011%20vitesses",
    },
    en: {
      text: "chain 11 speed",
      messy: "   chain    11   speed   ",
      rosebikes: "https://www.rosebikes.com/search?q=chain%2011%20speed",
      decathlon: "https://www.decathlon.co.uk/search?Ntt=chain%2011%20speed",
    },
  };

/**
 * The free-text box, once React owns it. The page is prerendered, so the box is
 * on screen before React listens to it — and React 19.2 hydrates a controlled
 * input by leaving a value typed before hydration in the DOM and never passing
 * it to state: the box shows the text, and no shop link ever appears. That was
 * a WebKit flake on CI (`.debug/015` §9).
 */
async function searchBox(page: Page): Promise<Locator> {
  const input = page.getByTestId("vendor-search-input");
  await expect
    .poll(() =>
      input.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactProps"))),
    )
    .toBe(true);
  return input;
}

forEachLocale((locale) => {
  const typed = TYPED[locale];

  test(`a category title opens its part panel (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/acheter"));
    await page.getByTestId("category-link-chains").click();

    await expect(page).toHaveURL(new RegExp(`${href(locale, "/acheter")}\\?part=chain$`));
    await expect(page.getByTestId("part-questions")).toHaveAttribute("data-part-id", "chain");
  });

  test(`the page is ${href(locale, "/acheter")} and its cards link to that locale's shops (${locale})`, async ({
    page,
  }) => {
    await page.goto(href(locale, "/acheter"));
    expect(new URL(page.url()).pathname).toBe(locale === "fr" ? "/fr/acheter" : "/en/shop");
    await expect(
      page.locator('div[data-category="chains"] a[data-retailer="rosebikes"]'),
    ).toHaveAttribute("href", CHAINS_CARD_ROSE[locale]);
  });

  test(`the free-text box offers nothing until something is typed (${locale})`, async ({
    page,
  }) => {
    await page.goto(href(locale, "/acheter"));
    await expect(page.getByTestId("vendor-search-empty")).toBeVisible();
    await expect(page.getByTestId("vendor-search-links")).toHaveCount(0);
  });

  test(`what is typed becomes the search at the three shops, encoded (${locale})`, async ({
    page,
  }) => {
    await page.goto(href(locale, "/acheter"));
    await (await searchBox(page)).fill(typed.text);

    await expect(page.getByTestId("vendor-search-rosebikes")).toHaveAttribute(
      "href",
      typed.rosebikes,
    );
    await expect(page.getByTestId("vendor-search-decathlon")).toHaveAttribute(
      "href",
      typed.decathlon,
    );
    for (const retailer of RETAILERS) {
      await expect(page.getByTestId(`vendor-search-${retailer}`)).toHaveAttribute(
        "rel",
        OUTBOUND_REL,
      );
    }
  });

  test(`a pasted mess is cleaned before it becomes a URL (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/acheter"));
    await (await searchBox(page)).fill(typed.messy);
    await expect(page.getByTestId("vendor-search-rosebikes")).toHaveAttribute(
      "href",
      typed.rosebikes,
    );
  });

  test(`the page says plainly that nothing here is affiliated (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/acheter"));
    const disclosure = page.getByText(SHOP_T[locale].outbound.disclosure);
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toHaveText(NO_AFFILIATION[locale]);
  });
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

  forEachLocale((locale) => {
    test(`the grid is in the HTML, not built after hydration (${locale})`, async ({ page }) => {
      await page.goto(href(locale, "/acheter"));
      await expect(page.getByTestId("category-grid")).toBeVisible();
      await expect(page.locator("div[data-category]")).toHaveCount(SHOP_CATEGORIES.length);
      await expect(
        page.locator('div[data-category="chains"] a[data-retailer="rosebikes"]'),
      ).toHaveAttribute("href", CHAINS_CARD_ROSE[locale]);
    });
  });
});

forEachLocale((locale) => {
  test(`every control on the page is at least 44x44 CSS px (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/acheter"));
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
});
