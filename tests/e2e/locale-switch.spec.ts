/**
 * Every route, in every locale, and the switch between them (§6.8 AC1).
 *
 * The list is not written here: it is `routing.pathnames` itself, walked. That
 * is the point of the test — a route added to the routing table without a page,
 * or with a page that only exists in French, fails this file the day it lands
 * rather than the day someone clicks it. `/dev/*` is excluded (it 404s unless
 * `ENABLE_TEST_PAGES=1` is read per request, and `tests/security/dev-pages-gated.test.ts`
 * owns that question); everything else is visited with the plan's parameters —
 * `[id]` = `demo`, `[partId]` = `saddle`, `[slug]` = `check-brakes-disc`.
 *
 * Public keys are visited anonymously, protected ones with a session cookie.
 * `/connexion` and `/inscription` count as public: they are the pages a
 * signed-OUT visitor is sent to, and `auth-login.spec.ts` owns what happens to
 * a signed-in one who asks for them.
 *
 * Each route is its own `test()` rather than a loop inside one, so a red run
 * names the route instead of the first route that broke — and so the two that
 * W3-T1 and W3-T2 are building in parallel can be identified by name.
 *
 * The switch itself is asserted on the hardest URL the site has: a localized
 * path with two dynamic segments and a query string
 * (`/en/bike/demo/part/brake-caliper-front?parts=chain`). Getting that one
 * right means `getPathname` is being used everywhere, because nothing else
 * could produce it.
 */
/* eslint-disable security/detect-object-injection -- locale-keyed message fixtures and patterns built from paths this file computed itself */
import { ANON_ONLY_KEYS, PROTECTED_KEYS } from "../../lib/i18n/protected-paths";
import { routing, type Pathname } from "../../lib/i18n/routing";
import en from "../../messages/en/common.json";
import fr from "../../messages/fr/common.json";

import { expect, forEachLocale, href, test, type Locale, type RouteKey } from "./_fixtures";

const COMMON: Record<Locale, typeof fr> = { fr, en };
const OTHER: Record<Locale, Locale> = { fr: "en", en: "fr" };

/** §6.8 AC1 fixes these: one bike, one part, one guide. */
const PARAMS: Readonly<Record<string, string>> = {
  id: "demo",
  partId: "saddle",
  slug: "check-brakes-disc",
};

const KEYS = Object.keys(routing.pathnames) as Pathname[];
const PROTECTED: ReadonlySet<string> = new Set<string>(PROTECTED_KEYS);

/** Request-time gated (`ENABLE_TEST_PAGES`); not part of the site. */
const isDevRoute = (key: Pathname): boolean => key.startsWith("/dev/");

const PUBLIC = KEYS.filter((key) => !isDevRoute(key) && !PROTECTED.has(key));

/**
 * `domcontentloaded`, not the default `load`.
 *
 * What AC1 asks of each route — a 200 and the right `<html lang>` — is settled
 * the moment the document is parsed. Waiting for `load` on `/velo/demo/piece/saddle`
 * means waiting for the 3D workspace to finish fetching and warming a
 * SwiftShader context: ~32 s on this machine, which is most of the 45 s budget
 * and made the route walk time out under four parallel workers rather than
 * report anything about the route.
 */
const DOM_READY = { waitUntil: "domcontentloaded" } as const;

/** The params `key` needs, taken from {@link PARAMS}. */
function paramsFor(key: Pathname): Record<string, string> {
  return Object.fromEntries(
    [...key.matchAll(/\[([^\]]+)\]/g)].map((match) => [match[1], PARAMS[match[1]]]),
  );
}

forEachLocale((locale) => {
  for (const key of PUBLIC) {
    test(`${key} renders 200 anonymously (${locale})`, async ({ page }) => {
      const response = await page.goto(href(locale, key as RouteKey, paramsFor(key)), DOM_READY);

      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    });
  }

  for (const key of PROTECTED_KEYS) {
    test(`${key} renders 200 for a signed-in visitor (${locale})`, async ({
      page,
      signedInContext,
    }) => {
      await signedInContext();
      const response = await page.goto(href(locale, key as RouteKey, paramsFor(key)), DOM_READY);

      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    });
  }
});

// Once, not per locale: it visits no page, it compares routing.pathnames with
// the lists this file walks above (which do run in FR and EN).
test("every key of routing.pathnames is covered by this file", () => {
  // The walk above is only a guarantee if nothing silently drops out of it:
  // a key that is neither public, protected nor a dev page would be visited by
  // no test at all, and the file would still be green.
  const covered = new Set<string>([
    ...PUBLIC,
    ...PROTECTED_KEYS,
    ...KEYS.filter(isDevRoute).map(String),
  ]);

  expect([...KEYS].filter((key) => !covered.has(key))).toEqual([]);
  // And the anon-only pages really are in the public walk (they answer 200
  // without a session, which is exactly what AC1 asks of a "public key").
  expect(ANON_ONLY_KEYS.every((key) => PUBLIC.includes(key))).toBe(true);
});

forEachLocale((locale) => {
  const other = OTHER[locale];

  test(`the switcher keeps the path and the query across locales (${locale} → ${other})`, async ({
    page,
  }) => {
    const from = href(
      locale,
      "/velo/[id]/piece/[partId]",
      { id: "demo", partId: "brake-caliper-front" },
      { parts: "chain" },
    );
    const to = href(
      other,
      "/velo/[id]/piece/[partId]",
      { id: "demo", partId: "brake-caliper-front" },
      { parts: "chain" },
    );

    await page.goto(from);
    await page
      .getByRole("banner")
      .getByRole("group", { name: COMMON[locale].localeSwitcher.label })
      .getByRole("button", { name: COMMON[locale].localeNames[other] })
      .click();

    await page.waitForURL((url) => `${url.pathname}${url.search}` === to);
    await expect(page.locator("html")).toHaveAttribute("lang", other);
    await expect(
      page.getByRole("banner").getByRole("button", { name: COMMON[other].localeNames[other] }),
    ).toHaveAttribute("aria-current", "true");
  });
});
