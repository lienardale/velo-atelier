/**
 * `app/robots.ts` — the crawl rules of §6.6: disallow `/velo/[id]`, `/compte`,
 * `/mes-velos`, `/import`, `/connexion`, `/inscription`, `/dev/*` and `/api/`,
 * in BOTH locales, built from `routing.pathnames` so a renamed localized path
 * cannot leave a private area crawlable.
 *
 * `tests/e2e/seo.spec.ts` checks the served file after a production build. This
 * is the same contract one tier down, where the coverage gate can see it and a
 * regression fails without a build — and it is written against CONCRETE URLS
 * rather than against the rule strings: `robots.txt` is a prefix match, so the
 * question for every private route is "does some rule cover a real address of
 * it", and a `Disallow: /fr/velo/[id]` line (brackets and all) answers no for
 * every real bike (the W3 lesson, `.debug/010 §1`).
 */
import { describe, expect, it } from "vitest";

import robots, { disallowedPaths } from "@/app/robots";
import { routing, type Pathname } from "@/lib/i18n/routing";
import { localizedUrl } from "@/tests/_fakes/routes";

/** §6.6's list, as internal keys — every sub-route of a bike, and both `/dev/*` pages. */
const PRIVATE_KEYS = [
  "/velo/[id]",
  "/velo/[id]/piece/[partId]",
  "/velo/[id]/controle",
  "/velo/[id]/liste",
  "/velo/[id]/reglages",
  "/compte",
  "/mes-velos",
  "/import",
  "/connexion",
  "/inscription",
  "/dev/bike3d",
  "/dev/bike3d-perf",
] as const satisfies readonly Pathname[];

const PUBLIC_KEYS = [
  "/",
  "/guides",
  "/guides/[slug]",
  "/acheter",
  "/mentions-legales",
  "/confidentialite",
] as const satisfies readonly Pathname[];

/** What a search engine would actually be handed a link to. */
const PARAMS = {
  id: "8f7c0e0a-3a52-4f9b-9d65-3e1f0c2a7b41",
  partId: "chain",
  slug: "check-brakes-disc",
};

const covered = (url: string, rules: readonly string[]) =>
  rules.some((rule) => url.startsWith(rule));

describe("robots.txt", () => {
  const rules = disallowedPaths();

  it.each(routing.locales.flatMap((locale) => PRIVATE_KEYS.map((key) => [locale, key] as const)))(
    "keeps %s %s out of the crawl, for a real id",
    (locale, key) => {
      const url = localizedUrl(locale, key, PARAMS);
      expect(covered(url, rules), `${url} is crawlable under ${JSON.stringify(rules)}`).toBe(true);
    },
  );

  it("spells each locale's own path, so the English site is not left open", () => {
    const french = rules.filter((rule) => rule.startsWith("/fr/"));
    expect(covered(localizedUrl("en", "/velo/[id]", PARAMS), french)).toBe(false);
    expect(rules).toEqual(expect.arrayContaining(["/fr/velo/", "/en/bike/", "/en/account"]));
  });

  it("never writes a dynamic segment into a rule", () => {
    for (const rule of rules) expect(rule, rule).not.toMatch(/[[\]]/);
  });

  it("blocks /api/ as a literal — it carries no locale", () => {
    expect(rules).toContain("/api/");
  });

  it("sweeps up nothing public — every indexable page stays crawlable", () => {
    for (const locale of routing.locales) {
      for (const key of PUBLIC_KEYS) {
        const url = localizedUrl(locale, key, PARAMS);
        expect(covered(url, rules), `${url} is disallowed`).toBe(false);
      }
    }
  });

  it("allows the rest, and points at the sitemap on the site's own origin", () => {
    const origin = process.env.NEXT_PUBLIC_SITE_URL!.replace(/\/+$/, "");
    const file = robots();
    expect(file.rules).toEqual([{ userAgent: "*", allow: "/", disallow: rules }]);
    expect(file.sitemap).toBe(`${origin}/sitemap.xml`);
    expect(file.host).toBe(origin);
  });
});
