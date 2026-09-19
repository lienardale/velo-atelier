import type { MetadataRoute } from "next";

import { localizedPath } from "@/lib/i18n/protected-paths";
import { routing, type Pathname } from "@/lib/i18n/routing";
import { siteUrl } from "@/lib/seo/metadata";

/**
 * `/robots.txt` (§6.6) — the crawl rules, derived from `routing.pathnames` so a
 * renamed localized path cannot leave a private area crawlable.
 *
 * The disallow list is the same set `lib/seo/metadata.ts` refuses to mark
 * indexable, spelled as URL prefixes in BOTH locales (`/fr/compte` and
 * `/en/account`, `/fr/velo/` and `/en/bike/`). `robots.txt` is a prefix match,
 * so a dynamic segment is cut at its first `[`: `/velo/[id]` becomes
 * `/fr/velo/`, which covers the bike page and every sub-route under it.
 *
 * This is belt and braces, not the control: a `Disallow` line keeps a page out
 * of the crawl, and `robots: { index: false }` keeps it out of the index even
 * when it is reached from a link. Both are asserted in `tests/e2e/seo.spec.ts`.
 *
 * `/api/` is listed as a literal — it is not a next-intl route and carries no
 * locale prefix.
 *
 * Static, like the sitemap: no request API, and the proxy matcher excludes
 * `robots.txt` so it is never locale-prefixed.
 */

/** The keys whose pages must not be crawled — §6.6, in the plan's order. */
const DISALLOWED_KEYS = [
  "/velo/[id]",
  "/compte",
  "/mes-velos",
  "/import",
  "/connexion",
  "/inscription",
  "/dev/bike3d",
  "/dev/bike3d-perf",
] as const satisfies readonly Pathname[];

/**
 * `/fr/velo/` for `/velo/[id]`, `/en/account` for `/compte`.
 *
 * A path with a dynamic segment is truncated at it — there is no id to spell —
 * which also makes `/velo/[id]/controle` and the rest fall under the same line.
 */
function disallowPrefix(key: Pathname, locale: (typeof routing.locales)[number]): string {
  const path = localizedPath(key, locale);
  const bracket = path.indexOf("[");
  return `/${locale}${bracket === -1 ? path : path.slice(0, bracket)}`;
}

/** Deduplicated (`/dev/bike3d` and `/dev/bike3d-perf` share no prefix; both are listed). */
export function disallowedPaths(): string[] {
  const paths = new Set<string>();
  for (const key of DISALLOWED_KEYS) {
    for (const locale of routing.locales) paths.add(disallowPrefix(key, locale));
  }
  paths.add("/api/");
  return [...paths].sort();
}

export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: disallowedPaths() }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
