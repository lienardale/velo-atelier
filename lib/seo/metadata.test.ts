/**
 * `buildMetadata` — canonical, hreflang and robots.
 *
 * tests/setup.ts mocks `@/lib/i18n/navigation` with an identity mapping (the
 * internal French path). next-intl's real `getPathname` cannot load under the
 * node tier (vitest externalises next-intl, whose client build imports
 * `next/navigation` without an extension), so this file swaps in a
 * `getPathname` that compiles `routing.pathnames` the way next-intl does:
 * localized template, `[param]` substitution, `/<locale>` prefix. The real
 * mapping is asserted end-to-end on the rendered `<link rel="alternate">` tags
 * (tests/e2e/smoke.spec.ts, and the W3 seo spec).
 */
/* eslint-disable security/detect-object-injection -- test double indexing routing.pathnames with fixed keys */
import { describe, expect, it, vi } from "vitest";

import {
  buildMetadata,
  isIndexableRoute,
  localizedAlternates,
  OPEN_GRAPH_LOCALES,
} from "./metadata";

vi.mock("@/lib/i18n/navigation", async () => {
  const { routing } = await import("@/lib/i18n/routing");
  type Href = string | { pathname: string; params?: Record<string, string> };
  const pathnames: Record<string, string | Record<string, string>> = routing.pathnames;
  return {
    getPathname: ({ href, locale }: { href: Href; locale: "fr" | "en" }) => {
      const key = typeof href === "string" ? href : href.pathname;
      const params = typeof href === "string" ? {} : (href.params ?? {});
      const entry = pathnames[key];
      const template = typeof entry === "string" ? entry : entry[locale];
      const path = template.replace(/\[([^\]]+)\]/g, (_, name: string) => params[name]);
      return path === "/" ? `/${locale}` : `/${locale}${path}`;
    },
  };
});

describe("localizedAlternates", () => {
  it("maps an internal key to each locale's prefixed, localized path", () => {
    expect(localizedAlternates("/")).toEqual({ fr: "/fr", en: "/en" });
    expect(localizedAlternates("/acheter")).toEqual({ fr: "/fr/acheter", en: "/en/shop" });
    expect(localizedAlternates({ pathname: "/velo/[id]", params: { id: "demo" } })).toEqual({
      fr: "/fr/velo/demo",
      en: "/en/bike/demo",
    });
    expect(
      localizedAlternates({ pathname: "/guides/[slug]", params: { slug: "replace-chain" } }),
    ).toEqual({ fr: "/fr/guides/replace-chain", en: "/en/guides/replace-chain" });
  });
});

describe("buildMetadata", () => {
  it("sets canonical, hreflang alternates and x-default → French", () => {
    const metadata = buildMetadata({
      locale: "en",
      pathname: "/acheter",
      title: "Shop",
      description: "Find the right part.",
    });
    expect(metadata.title).toBe("Shop");
    expect(metadata.description).toBe("Find the right part.");
    expect(metadata.alternates).toEqual({
      canonical: "/en/shop",
      languages: { fr: "/fr/acheter", en: "/en/shop", "x-default": "/fr/acheter" },
    });
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph).toEqual({
      type: "website",
      title: "Shop",
      description: "Find the right part.",
      url: "/en/shop",
      locale: "en_GB",
      alternateLocale: ["fr_FR"],
    });
  });

  it("keeps an absolute title and omits an absent description", () => {
    const metadata = buildMetadata({
      locale: "fr",
      pathname: "/",
      title: { absolute: "vélo-atelier" },
    });
    expect(metadata.title).toEqual({ absolute: "vélo-atelier" });
    expect(metadata).not.toHaveProperty("description");
    expect(metadata.openGraph).toMatchObject({
      title: "vélo-atelier",
      url: "/fr",
      locale: "fr_FR",
    });
    expect(metadata.openGraph).not.toHaveProperty("description");
    expect(metadata.alternates?.canonical).toBe("/fr");
  });

  it("never indexes bike, auth, signed-in or dev routes — whatever the caller asks", () => {
    const privateHrefs = [
      { pathname: "/velo/[id]", params: { id: "demo" } },
      { pathname: "/velo/[id]/controle", params: { id: "demo" } },
      { pathname: "/velo/[id]/piece/[partId]", params: { id: "demo", partId: "saddle" } },
      "/connexion",
      "/inscription",
      "/compte",
      "/mes-velos",
      "/import",
      "/dev/bike3d",
    ] as const;
    for (const pathname of privateHrefs) {
      const metadata = buildMetadata({ locale: "fr", pathname, title: "x", index: true });
      expect(metadata.robots, JSON.stringify(pathname)).toEqual({ index: false, follow: false });
    }
  });

  it("lets a public page opt out of indexing", () => {
    expect(
      buildMetadata({ locale: "fr", pathname: "/guides", title: "x", index: false }).robots,
    ).toEqual({ index: false, follow: false });
  });
});

describe("isIndexableRoute", () => {
  it("allows the public pages", () => {
    for (const key of [
      "/",
      "/guides",
      "/guides/[slug]",
      "/acheter",
      "/mentions-legales",
      "/confidentialite",
    ] as const) {
      expect(isIndexableRoute(key), key).toBe(true);
    }
  });
});

describe("OPEN_GRAPH_LOCALES", () => {
  it("covers every locale", () => {
    expect(Object.keys(OPEN_GRAPH_LOCALES).sort()).toEqual(["en", "fr"]);
  });
});
