import type { MetadataRoute } from "next";

import { GUIDES, LEGAL } from "@/lib/content/collection";
import { guidesForLocale } from "@/lib/content/guides";
import { findLegal, LEGAL_PAGE_IDS, type LegalPageId } from "@/lib/content/legal";
import { routing, type Locale } from "@/lib/i18n/routing";
import { localizedAlternates, siteUrl, type MetadataHref } from "@/lib/seo/metadata";

/**
 * `/sitemap.xml` (§6.6) — every page a search engine should crawl, in both
 * locales, each carrying the `xhtml:link` alternates of its twin.
 *
 * What is IN: `/`, `/guides`, every **full** guide, `/acheter`, and the two
 * legal pages. What is out, and why it is out by construction rather than by a
 * list maintained here:
 *
 *   - `/velo/**`, the auth pages, the signed-in pages and `/dev/**` are not
 *     indexable (`isIndexableRoute`, and `app/robots.ts` disallows them);
 *   - **stub guides** (§5.7): a page with complete frontmatter and one
 *     placeholder step is published for a reader who followed a link, and is
 *     the wrong thing to offer a searcher. `generateMetadata` on the guide page
 *     already sends `robots: { index: false }` for them; leaving them out here
 *     is the other half of the same decision. Listing a `noindex` URL in a
 *     sitemap is a contradiction crawlers report as an error.
 *
 * Both are asserted by `tests/e2e/seo.spec.ts` against the served XML.
 *
 * `lastModified` is only set where a document actually records a revision date
 * (the legal pages). Stamping `new Date()` on every entry would tell crawlers
 * the whole site changed at every deploy, which is worse than saying nothing.
 *
 * Static: nothing here reads the request, so the route is prerendered at build
 * time like the pages it lists. The proxy's matcher excludes `sitemap.xml`
 * (`proxy.ts`), so this URL is never locale-prefixed.
 */

/** A sitemap entry's `alternates.languages`, absolute — `getPathname` yields paths. */
function languagesOf(href: MetadataHref): Record<Locale, string> {
  const paths = localizedAlternates(href);
  return Object.fromEntries(
    routing.locales.map((locale) => [locale, `${siteUrl()}${paths[locale]}`]),
  ) as Record<Locale, string>;
}

function entry(
  locale: Locale,
  href: MetadataHref,
  extra: Partial<MetadataRoute.Sitemap[number]> = {},
): MetadataRoute.Sitemap[number] {
  const languages = languagesOf(href);
  return {
    // eslint-disable-next-line security/detect-object-injection -- `locale` is a Locale from routing.locales
    url: languages[locale],
    alternates: { languages },
    ...extra,
  };
}

/** The last revision of a legal page, or `undefined` when the document is missing. */
function legalLastModified(id: LegalPageId, locale: Locale): Date | undefined {
  const document = findLegal(LEGAL, id, locale);
  return document ? new Date(`${document.updatedAt}T00:00:00.000Z`) : undefined;
}

export default function sitemap(): MetadataRoute.Sitemap {
  return routing.locales.flatMap((locale) => [
    entry(locale, "/", { priority: 1, changeFrequency: "monthly" }),
    entry(locale, "/guides", { priority: 0.8, changeFrequency: "weekly" }),
    entry(locale, "/acheter", { priority: 0.6, changeFrequency: "monthly" }),
    ...guidesForLocale(GUIDES, locale)
      .filter((guide) => guide.status === "full")
      .map((guide) =>
        entry(
          locale,
          { pathname: "/guides/[slug]", params: { slug: guide.slug } },
          { priority: 0.7, changeFrequency: "yearly" },
        ),
      ),
    ...LEGAL_PAGE_IDS.map((id) => {
      const lastModified = legalLastModified(id, locale);
      return entry(locale, id === "mentions" ? "/mentions-legales" : "/confidentialite", {
        priority: 0.2,
        changeFrequency: "yearly",
        ...(lastModified === undefined ? {} : { lastModified }),
      });
    }),
  ]);
}
