/**
 * A localized, locale-prefixed URL built straight from `routing.pathnames` —
 * the same expansion `tests/e2e/_fixtures.ts` `href()` does, for the node tiers.
 *
 * The node tiers mock `@/lib/i18n/navigation` globally (`tests/setup.ts`), and
 * that mock echoes the INTERNAL key: `/acheter` comes out as `/en/acheter`, not
 * `/en/shop`. next-intl's own `createNavigation` does not load under Vitest's
 * node ESM resolution (it imports `next/navigation` without an extension), so a
 * test that is ABOUT the localized URLs — the sitemap, robots.txt — builds them
 * here, independently of the code under test.
 *
 *   localizedUrl("en", "/velo/[id]/controle", { id: "demo" }) → "/en/bike/demo/checkup"
 */
import { routing, type Locale, type Pathname } from "@/lib/i18n/routing";

export function localizedUrl(
  locale: Locale,
  key: Pathname,
  params: Readonly<Record<string, string>> = {},
): string {
  const entry: string | Readonly<Record<Locale, string>> = routing.pathnames[key];
  // eslint-disable-next-line security/detect-object-injection -- `locale` is a Locale literal
  const template = typeof entry === "string" ? entry : entry[locale];
  const path = template.replace(/\[([^\]]+)\]/g, (_, name: string) => {
    if (!Object.hasOwn(params, name))
      throw new Error(`localizedUrl(): missing "${name}" for ${key}`);
    // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
    return encodeURIComponent(params[name]);
  });
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/**
 * `getPathname` of `@/lib/i18n/navigation`, done right for the node tiers: a
 * `vi.mock` factory for tests whose subject is the localized URL itself.
 */
export function localizingGetPathname({
  href,
  locale,
}: {
  href: string | { pathname: string; params?: Record<string, string> };
  locale: Locale;
}): string {
  return typeof href === "string"
    ? localizedUrl(locale, href as Pathname)
    : localizedUrl(locale, href.pathname as Pathname, href.params ?? {});
}
