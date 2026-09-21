/**
 * `app/sitemap.ts` — §6.6: per locale `/`, `/guides`, every guide, `/acheter`
 * and the legal pages, **with alternates** (fr, en, `x-default` → fr).
 *
 * The alternates are the part a crawler uses to pair the two languages of one
 * page, and the part nothing else checks entry by entry: `tests/e2e/seo.spec.ts`
 * compares the set of `<loc>`s and looks for one `hreflang="x-default"` in the
 * whole file. So this pins, for EVERY entry:
 *
 *   - `url` is its own locale's alternate (a French entry that advertised the
 *     English URL as itself would be a duplicate the crawler has to resolve);
 *   - the two twins carry the SAME languages map — each points at the other;
 *   - every alternate is absolute on `siteUrl()` (a relative `xhtml:link` is
 *     ignored), and `x-default` is the French URL, as in every page's head;
 *   - stub guides are left out (§5.7: they are `noindex`), and a legal page's
 *     `lastModified` is the date its own document records.
 *
 * The localized paths come from `tests/_fakes/routes.ts`, built straight from
 * `routing.pathnames`, not from the code under test.
 */
import { describe, expect, it, vi } from "vitest";

import type { LegalDocument } from "@/lib/content/legal";

vi.mock("content-collections", async () => ({
  allGuides: (await import("@/tests/_helpers/guides")).diskGuides(),
  allLegalPages: (
    [
      { id: "mentions", locale: "fr", updatedAt: "2026-09-17" },
      { id: "mentions", locale: "en", updatedAt: "2026-09-18" },
      { id: "confidentialite", locale: "fr", updatedAt: "2026-09-19" },
      { id: "confidentialite", locale: "en", updatedAt: "2026-09-20" },
    ] as const
  ).map((page): LegalDocument => ({ ...page, title: "t", summary: "s", mdx: "" })),
}));

vi.mock("@/lib/i18n/navigation", async () => ({
  getPathname: (await import("@/tests/_fakes/routes")).localizingGetPathname,
}));

const { default: sitemap } = await import("@/app/sitemap");
const { diskGuides } = await import("@/tests/_helpers/guides");
const { localizedUrl } = await import("@/tests/_fakes/routes");
const { routing } = await import("@/lib/i18n/routing");

type Locale = (typeof routing.locales)[number];

const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL!.replace(/\/+$/, "");
const entries = sitemap();

/** Which locale an entry is FOR: the one whose alternate it is. */
function localeOf(entry: (typeof entries)[number]): Locale {
  const languages = entry.alternates?.languages as Record<string, string>;
  // eslint-disable-next-line security/detect-object-injection -- `locale` is a Locale literal
  const match = routing.locales.find((locale) => languages[locale] === entry.url);
  if (match === undefined) throw new Error(`${entry.url} is none of its own alternates`);
  return match;
}

const fullSlugs = [
  ...new Set(
    diskGuides()
      .filter((guide) => guide.status === "full")
      .map((guide) => guide.slug),
  ),
];
const stubSlugs = [
  ...new Set(
    diskGuides()
      .filter((guide) => guide.status === "stub")
      .map((guide) => guide.slug),
  ),
];

describe("sitemap.xml", () => {
  it("lists every indexable page once per locale, and nothing else", () => {
    const expected = routing.locales.flatMap((locale) =>
      [
        localizedUrl(locale, "/"),
        localizedUrl(locale, "/guides"),
        localizedUrl(locale, "/acheter"),
        localizedUrl(locale, "/mentions-legales"),
        localizedUrl(locale, "/confidentialite"),
        ...fullSlugs.map((slug) => localizedUrl(locale, "/guides/[slug]", { slug })),
      ].map((path) => `${ORIGIN}${path}`),
    );
    const urls = entries.map((entry) => entry.url);

    expect(urls).toHaveLength(new Set(urls).size);
    expect(new Set(urls)).toEqual(new Set(expected));
  });

  it("leaves the stub guides out — they are noindex (§5.7)", () => {
    expect(stubSlugs.length).toBeGreaterThan(0);
    for (const slug of stubSlugs) {
      for (const locale of routing.locales) {
        const url = `${ORIGIN}${localizedUrl(locale, "/guides/[slug]", { slug })}`;
        expect(
          entries.some((entry) => entry.url === url),
          url,
        ).toBe(false);
      }
    }
  });

  it.each(entries.map((entry) => [entry.url, entry] as const))(
    "%s carries fr, en and x-default, absolute, x-default being French",
    (_url, entry) => {
      const languages = entry.alternates?.languages as Record<string, string>;
      expect(Object.keys(languages).sort()).toEqual(["en", "fr", "x-default"]);
      for (const href of Object.values(languages))
        expect(href.startsWith(`${ORIGIN}/`), href).toBe(true);
      expect(languages["x-default"]).toBe(languages.fr);
      expect(languages.fr.startsWith(`${ORIGIN}/fr`)).toBe(true);
      expect(languages.en.startsWith(`${ORIGIN}/en`)).toBe(true);
      expect(entry.url).toBe(languages[localeOf(entry)]);
    },
  );

  it("pairs each page with its twin: both entries carry the same alternates", () => {
    const byFrench = new Map<string, Array<(typeof entries)[number]>>();
    for (const entry of entries) {
      const french = (entry.alternates?.languages as Record<string, string>).fr;
      byFrench.set(french, [...(byFrench.get(french) ?? []), entry]);
    }
    for (const [french, twins] of byFrench) {
      expect(twins.map(localeOf).sort(), french).toEqual(["en", "fr"]);
      expect(twins[0].alternates, french).toEqual(twins[1].alternates);
    }
  });

  it("dates a legal page by its own document, and nothing else", () => {
    const mentionsEn = entries.find(
      (entry) => entry.url === `${ORIGIN}${localizedUrl("en", "/mentions-legales")}`,
    );
    const privacyFr = entries.find(
      (entry) => entry.url === `${ORIGIN}${localizedUrl("fr", "/confidentialite")}`,
    );
    expect(mentionsEn?.lastModified).toEqual(new Date("2026-09-18T00:00:00.000Z"));
    expect(privacyFr?.lastModified).toEqual(new Date("2026-09-19T00:00:00.000Z"));

    const home = entries.find((entry) => entry.url === `${ORIGIN}${localizedUrl("fr", "/")}`);
    expect(home?.lastModified).toBeUndefined();
  });
});
