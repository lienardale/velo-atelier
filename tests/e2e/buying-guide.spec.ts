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
import { expect, forEachLocale, href, test } from "./_fixtures";

const OUTBOUND_REL = "noopener noreferrer nofollow";

function shopUrl(locale: "fr" | "en", query: Record<string, string>): string {
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

test("no part named, no panel", async ({ page }) => {
  await page.goto(href("fr", "/acheter"));
  await expect(page.getByTestId("category-grid")).toBeVisible();
  await expect(page.getByTestId("part-questions")).toHaveCount(0);
});

test("a part the catalogue does not know is ignored, not guessed at", async ({ page }) => {
  for (const part of ["sprocket", "__proto__", "a".repeat(200)]) {
    await page.goto(shopUrl("fr", { part }));
    await expect(page.getByTestId("category-grid")).toBeVisible();
    await expect(page.getByTestId("part-questions")).toHaveCount(0);
  }
});

test("an answer follows into the query and into the three links", async ({ page }) => {
  await page.goto(shopUrl("fr", { part: "chain" }));

  const panel = page.getByTestId("part-questions");
  await expect(panel).toBeVisible();
  await panel.locator('[data-question="speeds"]').selectOption("11");

  await expect(page.getByTestId("part-query")).toContainText("chaîne 11 vitesses");

  const links = page.getByTestId("part-vendor-buttons").locator("a[data-outbound]");
  await expect(links).toHaveCount(3);
  await expect(
    page.locator('[data-testid="part-vendor-buttons"] a[data-retailer="rosebikes"]'),
  ).toHaveAttribute("href", "https://www.rosebikes.fr/search?q=cha%C3%AEne%2011%20vitesses");
  await expect(
    page.locator('[data-testid="part-vendor-buttons"] a[data-retailer="decathlon"]'),
  ).toHaveAttribute("href", "https://www.decathlon.fr/search?Ntt=cha%C3%AEne%2011%20vitesses");
  // The shop with no search endpoint gets the category page for the part.
  await expect(
    page.locator('[data-testid="part-vendor-buttons"] a[data-retailer="alltricks"]'),
  ).toHaveAttribute("href", "https://www.alltricks.fr/C-40598-toutes-les-chaines");
  for (let index = 0; index < 3; index += 1) {
    await expect(links.nth(index)).toHaveAttribute("rel", OUTBOUND_REL);
    await expect(links.nth(index)).toHaveAttribute("target", "_blank");
  }
});

test("the English page asks in English and links to the English shops", async ({ page }) => {
  await page.goto(shopUrl("en", { part: "chain" }));

  const panel = page.getByTestId("part-questions");
  await panel.locator('[data-question="speeds"]').selectOption("11");
  await expect(page.getByTestId("part-query")).toContainText("chain 11 speed");
  await expect(
    page.locator('[data-testid="part-vendor-buttons"] a[data-retailer="rosebikes"]'),
  ).toHaveAttribute("href", "https://www.rosebikes.com/search?q=chain%2011%20speed");
});

test("a chosen range names brands and puts one in the search", async ({ page }) => {
  await page.goto(shopUrl("fr", { part: "chain" }));

  const tiers = page.getByTestId("brand-tiers");
  await expect(tiers).toBeVisible();
  await expect(tiers.locator('[data-tier="entry"]')).not.toBeEmpty();
  await expect(tiers.locator('[data-tier="high"]')).not.toBeEmpty();

  await page.locator('[data-question="brand-tier"]').selectOption("mid");
  const query = await page.getByTestId("part-query").textContent();
  expect(query).toMatch(/chaîne .*(KMC|Shimano|SRAM)/);
});

test("a part the brand file does not cover still asks its questions", async ({ page }) => {
  // `content/brands.yaml` covers 25 parts; a bottom bracket is not one of them.
  await page.goto(shopUrl("fr", { part: "bottom-bracket" }));
  await expect(page.getByTestId("part-questions")).toBeVisible();
  await expect(page.getByTestId("brand-tiers")).toHaveCount(0);
});

test("arriving from a build-list item offers the way back to it", async ({ page }) => {
  await page.goto(shopUrl("fr", { part: "chain", bike: "demo", item: "x|chain|replace" }));

  const back = page.getByTestId("part-questions-back");
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute("href", href("fr", "/velo/[id]/liste", { id: "demo" }));
});

test("a bike ref that is not a bike simply drops the back-link", async ({ page }) => {
  await page.goto(shopUrl("fr", { part: "chain", bike: "../etc/passwd" }));
  await expect(page.getByTestId("part-questions")).toBeVisible();
  await expect(page.getByTestId("part-questions-back")).toHaveCount(0);
});

test("every control of the panel is at least 44x44 CSS px", async ({ page }) => {
  await page.goto(shopUrl("fr", { part: "cassette" }));
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
