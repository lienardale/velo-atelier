/**
 * What search engines are told (§6.6, §6.8 AC10) — against the production
 * build, because half of it only exists there: `/sitemap.xml` and
 * `/robots.txt` are prerendered routes, and the canonical URLs are resolved
 * against the build's `NEXT_PUBLIC_SITE_URL`.
 *
 * Three claims, and they have to agree with each other or the site is telling
 * crawlers two different stories:
 *
 *   1. **Every indexable page names itself.** One canonical, one `hreflang`
 *      per locale plus `x-default` → French, and the pair points at each other
 *      across the localized paths (`/fr/mentions-legales` ↔ `/en/legal`).
 *   2. **Every page that must not be indexed says so in its own head** —
 *      `/velo/**` (private or the demo), the auth pages, the signed-in pages,
 *      and stub guides (§5.7). `robots.txt` is the crawl rule; the meta tag is
 *      the index rule, and a page reached from a link only obeys the second.
 *   3. **The sitemap lists exactly the first set.** A `noindex` URL advertised
 *      in a sitemap is a contradiction crawlers report as an error, so the stub
 *      guides being absent is asserted as hard as the full ones being present.
 *
 * `/velo/demo` is deliberately NOT held to the indexable contract: it is
 * `noindex` by §6.6 and failed an SEO assertion it can never satisfy once
 * before (`.debug/004 §10`). Here it is only ever checked for being excluded.
 */
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename -- locale-keyed catalogues, fixed content paths, patterns built from repo slugs */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { parseFrontmatter } from "../../lib/content/frontmatter";
import { GuideFrontmatterSchema } from "../../lib/content/schema";
import { LEGAL_PAGE_IDS } from "../../lib/content/legal";

import { expect, forEachLocale, href, test, type Locale, type RouteKey } from "./_fixtures";

const GUIDES_DIR = join(process.cwd(), "content", "guides");

function statusOf(slug: string): "full" | "stub" {
  const parsed = parseFrontmatter(readFileSync(join(GUIDES_DIR, slug, "fr.mdx"), "utf8"));
  return GuideFrontmatterSchema.parse(parsed?.data).status;
}

const SLUGS = readdirSync(GUIDES_DIR).sort();
const FULL_SLUGS = SLUGS.filter((slug) => statusOf(slug) === "full");
const STUB_SLUGS = SLUGS.filter((slug) => statusOf(slug) === "stub");

/** §6.8 AC1's guide, and the one AC10 names. */
const GUIDE_SLUG = "check-brakes-disc";

const LEGAL_KEYS = { mentions: "/mentions-legales", confidentialite: "/confidentialite" } as const;

const OTHER: Record<Locale, Locale> = { fr: "en", en: "fr" };

/** The `href` of a `<link rel=…>` in the document head, or `null` when absent. */
async function linkHref(page: Page, selector: string): Promise<string | null> {
  const locator = page.locator(selector);
  return (await locator.count()) === 0 ? null : locator.first().getAttribute("href");
}

/** The origin the run is served from (`PLAYWRIGHT_PORT` moves it per worktree). */
function origin(page: Page): string {
  return new URL(page.url()).origin;
}

// ───────────────────────────────────────────────── structured data (AC10) ──

forEachLocale((locale) => {
  test(`a guide carries exactly one TechArticle JSON-LD (${locale})`, async ({ page }) => {
    await page.goto(href(locale, "/guides/[slug]", { slug: GUIDE_SLUG }));

    const scripts = page.locator('script[type="application/ld+json"]');
    await expect(scripts).toHaveCount(1);

    const data = JSON.parse((await scripts.first().textContent()) ?? "{}") as Record<
      string,
      unknown
    >;
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("TechArticle");
    expect(data.inLanguage).toBe(locale);
    expect(String(data.url)).toContain(href(locale, "/guides/[slug]", { slug: GUIDE_SLUG }));
    // The headline is the page's own `<h1>`, not a second copy that can drift.
    expect(data.headline).toBe(await page.getByRole("heading", { level: 1 }).first().textContent());
  });

  test(`the guide's Open Graph image is a static PNG (${locale})`, async ({ request }) => {
    const response = await request.get(
      `${href(locale, "/guides/[slug]", { slug: GUIDE_SLUG })}/opengraph-image`,
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    // Generated at build time, not per request: a real PNG with a PNG header.
    const body = await response.body();
    expect(body.byteLength).toBeGreaterThan(1000);
    expect([...body.subarray(1, 4)].map((byte) => String.fromCharCode(byte)).join("")).toBe("PNG");
  });

  test(`the site's own Open Graph card is served for the home page (${locale})`, async ({
    page,
    request,
  }) => {
    await page.goto(href(locale, "/"));
    const url = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(url, "the home page declares no og:image").toBeTruthy();
    expect(url).toContain(`/${locale}/opengraph-image`);

    const response = await request.get(new URL(url!).pathname + new URL(url!).search);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
  });
});

// ──────────────────────────────────────────── canonical + hreflang (§6.6) ──

const INDEXABLE: ReadonlyArray<{ key: RouteKey; params?: Record<string, string> }> = [
  { key: "/" },
  { key: "/guides" },
  { key: "/guides/[slug]", params: { slug: GUIDE_SLUG } },
  { key: "/mentions-legales" },
  { key: "/confidentialite" },
];

forEachLocale((locale) => {
  for (const { key, params } of INDEXABLE) {
    test(`${key} names itself and its twin (${locale})`, async ({ page }) => {
      const self = href(locale, key, params);
      const twin = href(OTHER[locale], key, params);

      const response = await page.goto(self);
      expect(response?.status()).toBe(200);

      expect(await linkHref(page, 'link[rel="canonical"]')).toBe(`${origin(page)}${self}`);
      expect(await linkHref(page, 'link[rel="alternate"][hreflang="' + locale + '"]')).toBe(
        `${origin(page)}${self}`,
      );
      expect(await linkHref(page, 'link[rel="alternate"][hreflang="' + OTHER[locale] + '"]')).toBe(
        `${origin(page)}${twin}`,
      );
      // x-default is French, whichever locale is being viewed (§6.6).
      expect(await linkHref(page, 'link[rel="alternate"][hreflang="x-default"]')).toBe(
        `${origin(page)}${href("fr", key, params)}`,
      );
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
    });
  }
});

// ─────────────────────────────────────────────────── what is NOT indexed ──

test("the private routes say noindex in their own head", async ({ page, signedInContext }) => {
  await signedInContext();

  const noindex: Array<[RouteKey, Record<string, string>]> = [
    ["/velo/[id]", { id: "demo" }],
    ["/velo/[id]/piece/[partId]", { id: "demo", partId: "saddle" }],
    ["/velo/[id]/reglages", { id: "demo" }],
    ["/compte", {}],
    ["/mes-velos", {}],
  ];

  for (const [key, params] of noindex) {
    await page.goto(href("fr", key, params));
    await expect(page.locator('meta[name="robots"]'), key).toHaveAttribute("content", /noindex/);
  }
});

test("the sign-in and sign-up pages say noindex too", async ({ page }) => {
  for (const key of ["/connexion", "/inscription"] as const) {
    await page.goto(href("fr", key));
    await expect(page.locator('meta[name="robots"]'), key).toHaveAttribute("content", /noindex/);
  }
});

test("a stub guide is published but not indexed", async ({ page }) => {
  test.skip(STUB_SLUGS.length === 0, "no stub guide on disk");

  const response = await page.goto(href("fr", "/guides/[slug]", { slug: STUB_SLUGS[0] }));

  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

// ───────────────────────────────────────────────────────────── sitemap.xml ──

test("the sitemap lists every indexable page, in both locales", async ({ request }) => {
  const response = await request.get("/sitemap.xml");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("xml");

  const xml = await response.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);

  const expected = [
    ...(["fr", "en"] as const).flatMap((locale) => [
      href(locale, "/"),
      href(locale, "/guides"),
      href(locale, "/acheter"),
      ...LEGAL_PAGE_IDS.map((id) => href(locale, LEGAL_KEYS[id])),
      ...FULL_SLUGS.map((slug) => href(locale, "/guides/[slug]", { slug })),
    ]),
  ];

  expect(new Set(locs)).toEqual(new Set(expected));
  // Every entry carries its alternates, so a crawler finds the other locale.
  expect(xml).toContain('hreflang="x-default"');
});

test("the sitemap advertises no page that is noindex", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();

  for (const slug of STUB_SLUGS) {
    expect(xml, `stub guide ${slug} is in the sitemap`).not.toContain(`/guides/${slug}<`);
  }
  for (const fragment of [
    "/velo/",
    "/bike/",
    "/compte",
    "/account",
    "/connexion",
    "/sign-in",
    "/inscription",
    "/sign-up",
    "/mes-velos",
    "/my-bikes",
    "/import",
    "/dev/",
  ]) {
    expect(xml, `${fragment} is in the sitemap`).not.toContain(fragment);
  }
});

// ────────────────────────────────────────────────────────────── robots.txt ──

test("robots.txt disallows the private routes in both locales and points at the sitemap", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");

  const body = await response.text();
  const siteOrigin = new URL(response.url()).origin;

  expect(body).toContain("User-Agent: *");
  expect(body).toContain("Allow: /");
  expect(body).toContain(`Sitemap: ${siteOrigin}/sitemap.xml`);

  for (const path of [
    "/fr/velo/",
    "/en/bike/",
    "/fr/compte",
    "/en/account",
    "/fr/mes-velos",
    "/en/my-bikes",
    "/fr/import",
    "/en/import",
    "/fr/connexion",
    "/en/sign-in",
    "/fr/inscription",
    "/en/sign-up",
    "/fr/dev/bike3d",
    "/en/dev/bike3d",
    "/api/",
  ]) {
    expect(body, `${path} is crawlable`).toContain(`Disallow: ${path}`);
  }

  // …and nothing public is swept up with them.
  for (const path of ["/fr/guides", "/en/guides", "/fr/mentions-legales", "/en/legal"]) {
    expect(body, `${path} is disallowed`).not.toContain(`Disallow: ${path}`);
  }
});

// ─────────────────────────────────────────────────────────── legal pages ──

forEachLocale((locale) => {
  for (const id of LEGAL_PAGE_IDS) {
    test(`${LEGAL_KEYS[id]} renders its document with a revision date (${locale})`, async ({
      page,
    }) => {
      const response = await page.goto(href(locale, LEGAL_KEYS[id]));

      expect(response?.status()).toBe(200);
      await expect(page.getByTestId("legal-page")).toHaveAttribute("data-legal-id", id);
      await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
      // The frontmatter's date, machine-readable, and rendered in the locale.
      const time = page.getByTestId("legal-updated");
      await expect(time).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
      await expect(time).not.toBeEmpty();
      // The body arrived: legal documents are sectioned prose, never one blob.
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    });
  }
});
