/**
 * The buying guide of `/acheter?part=<id>` (§5.5, §6.8 AC7).
 *
 * `/acheter` is a prerendered page, so the part panel is entirely the browser's
 * work: it reads the URL after hydration, asks the part's own questions, and
 * folds every answer into the query the three shops receive. That whole chain —
 * URL to `<Suspense>` to query to href — is what this spec exercises, and it is
 * the reason the panel cannot be a server component (`lib/shop/retailers.ts`).
 *
 * The URL is untrusted input, so the parts of it that are not a part are
 * checked too.
 */
/* eslint-disable security/detect-object-injection -- locale-keyed fixtures indexed by a Locale literal */
import { expect, forEachLocale, href, test, type Locale } from "./_fixtures";

const OUTBOUND_REL = "noopener noreferrer nofollow";

function shopUrl(locale: Locale, query: Record<string, string>): string {
  return `${href(locale, "/acheter")}?${new URLSearchParams(query).toString()}`;
}

forEachLocale((locale) => {
  test(`the panel opens on the part the URL names (${locale})`, async ({ page }) => {
    await page.goto(shopUrl(locale, { part: "cassette" }));

    const panel = page.getByTestId("part-questions");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-part-id", "cassette");
    await expect(page.getByRole("heading", { level: 2, name: /Cassette/ })).toBeVisible();
  });
});

/** Chain, 11 speeds: the query the panel builds, and the three links it gives, per locale. */
const CHAIN_11: Record<
  Locale,
  { query: string; rosebikes: string; decathlon: string; alltricks: string; brandQuery: RegExp }
> = {
  fr: {
    query: "chaîne 11 vitesses",
    rosebikes: "https://www.rosebikes.fr/search?q=cha%C3%AEne%2011%20vitesses",
    decathlon: "https://www.decathlon.fr/search?Ntt=cha%C3%AEne%2011%20vitesses",
    // The shop with no search endpoint gets the category page for the part.
    alltricks: "https://www.alltricks.fr/C-40598-toutes-les-chaines",
    brandQuery: /chaîne .*(KMC|Shimano|SRAM)/,
  },
  en: {
    query: "chain 11 speed",
    rosebikes: "https://www.rosebikes.com/search?q=chain%2011%20speed",
    decathlon: "https://www.decathlon.co.uk/search?Ntt=chain%2011%20speed",
    // The shop with no search endpoint gets the category page for the part.
    alltricks: "https://www.alltricks.com/C-40598-chains",
    brandQuery: /chain .*(KMC|Shimano|SRAM)/,
  },
};

forEachLocale((locale) => {
  const chain = CHAIN_11[locale];

  test(`no part named, no panel (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/acheter"));
    await expect(page.getByTestId("category-grid")).toBeVisible();
    await expect(page.getByTestId("part-questions")).toHaveCount(0);
  });

  test(`a part the catalogue does not know is ignored, not guessed at (${locale})`, async ({
    page,
  }) => {
    for (const part of ["sprocket", "__proto__", "a".repeat(200)]) {
      await page.goto(shopUrl(locale, { part }));
      await expect(page.getByTestId("category-grid")).toBeVisible();
      await expect(page.getByTestId("part-questions")).toHaveCount(0);
    }
  });

  test(`an answer follows into the query and into the three links, in the page's language (${locale})`, async ({
    page,
  }) => {
    await page.goto(shopUrl(locale, { part: "chain" }));

    const panel = page.getByTestId("part-questions");
    await expect(panel).toBeVisible();
    await panel.locator('[data-question="speeds"]').selectOption("11");

    await expect(page.getByTestId("part-query")).toContainText(chain.query);

    const links = page.getByTestId("part-vendor-buttons").locator("a[data-outbound]");
    await expect(links).toHaveCount(3);
    for (const retailer of ["rosebikes", "decathlon", "alltricks"] as const) {
      await expect(
        page.locator(`[data-testid="part-vendor-buttons"] a[data-retailer="${retailer}"]`),
      ).toHaveAttribute("href", chain[retailer]);
    }
    for (let index = 0; index < 3; index += 1) {
      await expect(links.nth(index)).toHaveAttribute("rel", OUTBOUND_REL);
      await expect(links.nth(index)).toHaveAttribute("target", "_blank");
    }
  });

  test(`a chosen range names brands and puts one in the search (${locale})`, async ({ page }) => {
    await page.goto(shopUrl(locale, { part: "chain" }));

    const tiers = page.getByTestId("brand-tiers");
    await expect(tiers).toBeVisible();
    await expect(tiers.locator('[data-tier="entry"]')).not.toBeEmpty();
    await expect(tiers.locator('[data-tier="high"]')).not.toBeEmpty();

    await page.locator('[data-question="brand-tier"]').selectOption("mid");
    const query = await page.getByTestId("part-query").textContent();
    expect(query).toMatch(chain.brandQuery);
  });

  test(`a part the brand file does not cover still asks its questions (${locale})`, async ({
    page,
  }) => {
    // `content/brands.yaml` covers 25 parts; a bottom bracket is not one of them.
    await page.goto(shopUrl(locale, { part: "bottom-bracket" }));
    await expect(page.getByTestId("part-questions")).toBeVisible();
    await expect(page.getByTestId("brand-tiers")).toHaveCount(0);
  });

  test(`arriving from a build-list item offers the way back to it (${locale})`, async ({
    page,
  }) => {
    await page.goto(shopUrl(locale, { part: "chain", bike: "demo", item: "x|chain|replace" }));

    const back = page.getByTestId("part-questions-back");
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", href(locale, "/velo/[id]/liste", { id: "demo" }));
  });

  test(`a bike ref that is not a bike simply drops the back-link (${locale})`, async ({ page }) => {
    await page.goto(shopUrl(locale, { part: "chain", bike: "../etc/passwd" }));
    await expect(page.getByTestId("part-questions")).toBeVisible();
    await expect(page.getByTestId("part-questions-back")).toHaveCount(0);
  });

  test(`every control of the panel is at least 44x44 CSS px (${locale})`, async ({ page }) => {
    await page.goto(shopUrl(locale, { part: "cassette" }));
    await expect(page.getByTestId("part-questions")).toBeVisible();

    const small = await page.evaluate(() => {
      const query = '[data-testid="part-questions"] :is(a[data-outbound], select, input, button)';
      const tooSmall: string[] = [];
      for (const node of document.querySelectorAll<HTMLElement>(query)) {
        const box = node.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        if (box.width < 44 || box.height < 44) {
          tooSmall.push(
            `${node.tagName.toLowerCase()} ${Math.round(box.width)}x${Math.round(box.height)}`,
          );
        }
      }
      return tooSmall;
    });
    expect(small, "every control on /acheter must be ≥ 44x44 (§6.8 AC5)").toEqual([]);
  });
});
