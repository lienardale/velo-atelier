/**
 * Page metadata with correct canonical and hreflang URLs (§6.6).
 *
 *   export async function generateMetadata({ params }) {
 *     const { locale } = await params;
 *     return buildMetadata({ locale, pathname: "/guides", title: t("…"), description: t("…") });
 *   }
 *
 * - `alternates.canonical` is this locale's URL; `alternates.languages` lists
 *   every locale plus `x-default` (→ French), all computed with `getPathname`
 *   so `/en/bike/demo` and `/fr/velo/demo` point at each other.
 * - `robots` is `noindex, nofollow` for bike pages (`/velo/**`, private by
 *   nature), the auth pages, the signed-in pages and `/dev/**` — whatever the
 *   caller passes. Everything else is indexable unless `index: false`.
 * - URLs are relative; `metadataBase` (set once in `app/[locale]/layout.tsx`
 *   from `NEXT_PUBLIC_SITE_URL`) makes them absolute.
 */
/* eslint-disable security/detect-object-injection -- every index is a `Locale` from routing.locales, never user input */
import type { Metadata } from "next";

import { getPathname } from "@/lib/i18n/navigation";
import { ANON_ONLY_KEYS, PROTECTED_KEYS } from "@/lib/i18n/protected-paths";
import { routing, type Locale, type Pathname } from "@/lib/i18n/routing";

/** What `getPathname` / `Link` accept: an internal pathname key, or one with its params. */
export type MetadataHref = Parameters<typeof getPathname>[0]["href"];

export interface BuildMetadataInput {
  locale: Locale;
  pathname: MetadataHref;
  /** A page title (the layout's `%s · vélo-atelier` template applies) or `{ absolute }`. */
  title: string | { absolute: string };
  description?: string;
  /** Opt a public page out of indexing. Private routes are never indexed, whatever this says. */
  index?: boolean;
}

/** `og:locale` values (language_TERRITORY). */
export const OPEN_GRAPH_LOCALES: Readonly<Record<Locale, string>> = { fr: "fr_FR", en: "en_GB" };

const PRIVATE_KEYS: ReadonlySet<string> = new Set<string>([...PROTECTED_KEYS, ...ANON_ONLY_KEYS]);

/** The internal pathname key of an href (`/velo/[id]` for `{ pathname: '/velo/[id]', params }`). */
function keyOf(href: MetadataHref): Pathname {
  return (typeof href === "string" ? href : href.pathname) as Pathname;
}

/** Whether search engines may index the route `key` at all. */
export function isIndexableRoute(key: Pathname): boolean {
  if (key === "/velo/[id]" || key.startsWith("/velo/")) return false;
  if (key.startsWith("/dev/")) return false;
  return !PRIVATE_KEYS.has(key);
}

/** Localized, locale-prefixed path of `href` in every locale. */
export function localizedAlternates(href: MetadataHref): Record<Locale, string> {
  return Object.fromEntries(
    routing.locales.map((locale) => [locale, getPathname({ href, locale })]),
  ) as Record<Locale, string>;
}

export function buildMetadata({
  locale,
  pathname,
  title,
  description,
  index = true,
}: BuildMetadataInput): Metadata {
  const alternates = localizedAlternates(pathname);
  const canonical = alternates[locale];
  const indexable = index && isIndexableRoute(keyOf(pathname));
  const plainTitle = typeof title === "string" ? title : title.absolute;

  return {
    title,
    ...(description === undefined ? {} : { description }),
    alternates: {
      canonical,
      languages: { ...alternates, "x-default": alternates[routing.defaultLocale] },
    },
    openGraph: {
      type: "website",
      title: plainTitle,
      ...(description === undefined ? {} : { description }),
      url: canonical,
      locale: OPEN_GRAPH_LOCALES[locale],
      alternateLocale: routing.locales
        .filter((other) => other !== locale)
        .map((other) => OPEN_GRAPH_LOCALES[other]),
    },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
  };
}
