/**
 * Shared Playwright fixtures — import `test` and `expect` from here, never
 * from `@playwright/test` directly, so every spec gets the same guards.
 *
 *   import { test, expect, forEachLocale, href, DEMO_USER } from "./_fixtures";
 *
 *   forEachLocale((locale) => {
 *     test(`account page (${locale})`, async ({ page, signedInContext }) => {
 *       await signedInContext();                         // DEMO_USER by default
 *       await page.goto(href(locale, "/compte"));         // /fr/compte · /en/account
 *     });
 *   });
 *
 * What is here:
 *
 * - `forEachLocale(fn)` / `href(locale, key, params?)` — every spec runs in FR
 *   and EN (§7.2), and URLs come from `routing.pathnames`, so a renamed route
 *   is changed in one place (lib/i18n/routing.ts), not in forty specs.
 *
 * - `signedInContext(user?)` — signs the browser context in WITHOUT the login
 *   form: it writes the Auth.js v5 session cookie itself, a JWE produced by
 *   `encode()` from `next-auth/jwt` with the same secret and the cookie name
 *   as salt (Auth.js v5 requires the salt). The login form has its own specs
 *   (`auth-login`); every other spec should not pay for it or depend on it.
 *   Google is never mocked here — it is asserted as a button href only.
 *
 * - `webgl` — `false` in the `no-webgl` project, `true` elsewhere, so a spec
 *   can assert the SVG fallback or the canvas accordingly.
 *
 * - `signupEmail` — `signup+<testId>@velo-atelier.test`, unique per test and
 *   per retry-safe run (the database is truncated by the global setup).
 *
 * - an automatic horizontal-overflow guard on every mobile project: after each
 *   passing test the current page must not scroll sideways (§4.8 AC5,
 *   "no horizontal overflow"). Opt out for one test with
 *   `test.info().annotations.push({ type: "allow-horizontal-overflow" })`.
 */
import { expect, test as base, type BrowserContext } from "@playwright/test";
import { encode } from "next-auth/jwt";

import { DEMO_USER, DEMO_USER_EN, type DemoUserSeed } from "../../prisma/seed-data";

export { DEMO_USER, DEMO_USER_EN, expect };

// ──────────────────────────────────────────────────────────────────── locales ──
//
// INTERIM COPY. The source of truth is `routing.locales` / `routing.pathnames`
// in lib/i18n/routing.ts (§6.1), which W0-T2 writes after this file. Until it
// exists these two constants mirror §6.1 verbatim; once it lands they become
//
//   import { routing } from "@/lib/i18n/routing";
//   export const LOCALES = routing.locales;
//   const PATHNAMES = routing.pathnames;
//
// and nothing else in this file (or in any spec) changes.

export const LOCALES = ["fr", "en"] as const;

export type Locale = (typeof LOCALES)[number];

const PATHNAMES = {
  "/": "/",
  "/velo/[id]": { fr: "/velo/[id]", en: "/bike/[id]" },
  "/velo/[id]/piece/[partId]": { fr: "/velo/[id]/piece/[partId]", en: "/bike/[id]/part/[partId]" },
  "/velo/[id]/controle": { fr: "/velo/[id]/controle", en: "/bike/[id]/checkup" },
  "/velo/[id]/liste": { fr: "/velo/[id]/liste", en: "/bike/[id]/build-list" },
  "/velo/[id]/reglages": { fr: "/velo/[id]/reglages", en: "/bike/[id]/fit" },
  "/guides": "/guides",
  "/guides/[slug]": "/guides/[slug]",
  "/acheter": { fr: "/acheter", en: "/shop" },
  "/connexion": { fr: "/connexion", en: "/sign-in" },
  "/inscription": { fr: "/inscription", en: "/sign-up" },
  "/compte": { fr: "/compte", en: "/account" },
  "/mes-velos": { fr: "/mes-velos", en: "/my-bikes" },
  "/import": "/import",
  "/mentions-legales": { fr: "/mentions-legales", en: "/legal" },
  "/confidentialite": { fr: "/confidentialite", en: "/privacy" },
  "/dev/bike3d": "/dev/bike3d",
  "/dev/bike3d-perf": "/dev/bike3d-perf",
} as const satisfies Record<string, string | Record<Locale, string>>;

const ROUTES: ReadonlyMap<string, string | Readonly<Record<Locale, string>>> = new Map(
  Object.entries(PATHNAMES),
);

/** Declare the same tests once per locale (FR first — it is the default). */
export function forEachLocale(declare: (locale: Locale) => void): void {
  for (const locale of LOCALES) declare(locale);
}

/** Internal pathname keys of `routing.pathnames` (the French paths). */
export type RouteKey = keyof typeof PATHNAMES & string;

/**
 * Localized URL path for `key`: `/${locale}` + the locale's pathname, with
 * `[param]` segments filled from `params` (URI-encoded) and an optional query.
 * `localePrefix: 'always'` means every URL carries its locale.
 *
 *   href("en", "/velo/[id]/controle", { id: "demo" }) → "/en/bike/demo/checkup"
 */
export function href(
  locale: Locale,
  key: RouteKey,
  params: Readonly<Record<string, string>> = {},
  query?: Record<string, string> | URLSearchParams,
): string {
  const entry = ROUTES.get(key);
  if (entry === undefined) throw new Error(`href(): "${key}" is not in routing.pathnames`);
  const localized = typeof entry === "string" ? entry : locale === "fr" ? entry.fr : entry.en;
  const values = new Map(Object.entries(params));
  const path = localized.replace(/\[([^\]]+)\]/g, (_, name: string) => {
    const value = values.get(name);
    if (value === undefined) throw new Error(`href(): missing param "${name}" for "${key}"`);
    return encodeURIComponent(value);
  });
  const search = query ? `?${new URLSearchParams(query).toString()}` : "";
  return `${path === "/" ? `/${locale}` : `/${locale}${path}`}${search}`;
}

// ───────────────────────────────────────────────────────── signed-in session ──

/** Anything with an id and an e-mail — a seeded `DemoUserSeed` or a user a test created. */
export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  locale?: Locale;
  sessionVersion?: number;
}

const SESSION_MAX_AGE = 30 * 24 * 3600;

/** Auth.js v5 names the cookie by scheme: the `__Secure-` prefix is used on https only. */
export function sessionCookieName(baseURL: string): string {
  return new URL(baseURL).protocol === "https:"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

/**
 * The encrypted session token Auth.js itself would set after a sign-in —
 * the §7.2 contract, field for field (`checkedAt: now` means the `jwt`
 * callback's 5-minute `sessionVersion` re-check does not run on the first
 * request; `sessionVersion` must match the row, 0 for the seed).
 */
export async function encodeSessionToken(user: SessionUser, cookieName: string): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set (playwright.config.ts loads .env.test)");
  return encode({
    token: {
      sub: user.id,
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      locale: user.locale ?? "fr",
      sessionVersion: user.sessionVersion ?? 0,
      checkedAt: Date.now(),
    },
    secret,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE,
  });
}

/** Sign `context` in as `user` by writing the session cookie for `baseURL`. */
export async function signInContext(
  context: BrowserContext,
  user: SessionUser | DemoUserSeed,
  baseURL: string,
): Promise<BrowserContext> {
  const name = sessionCookieName(baseURL);
  const { hostname, protocol } = new URL(baseURL);
  await context.addCookies([
    {
      name,
      value: await encodeSessionToken(user, name),
      domain: hostname,
      path: "/",
      httpOnly: true,
      secure: protocol === "https:",
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    },
  ]);
  return context;
}

// ─────────────────────────────────────────────────────────────────── fixtures ──

/** Per-project options (set in playwright.config.ts `use`). */
export interface E2EOptions {
  /** Whether this project's browser exposes WebGL. */
  webgl: boolean;
}

interface E2EFixtures {
  /** Sign the test's browser context in (default `DEMO_USER`) and return it. */
  signedInContext: (user?: SessionUser | DemoUserSeed) => Promise<BrowserContext>;
  /** `signup+<testId>@velo-atelier.test` */
  signupEmail: string;
  /** Automatic: fails a passing mobile test whose page scrolls horizontally. */
  noHorizontalOverflow: void;
}

// The fixture callback Playwright documents as `use` is named `provide` here:
// eslint-plugin-react-hooks reads any `use(...)` call as React 19's `use` hook.
export const test = base.extend<E2EFixtures & E2EOptions>({
  webgl: [true, { option: true }],

  signedInContext: async ({ context, baseURL }, provide) => {
    await provide((user = DEMO_USER) =>
      signInContext(context, user, baseURL ?? "http://localhost:3100"),
    );
  },

  signupEmail: async ({}, provide, testInfo) => {
    await provide(`signup+${testInfo.testId}@velo-atelier.test`);
  },

  noHorizontalOverflow: [
    async ({ page, isMobile }, provide, testInfo) => {
      await provide();
      if (!isMobile || testInfo.status !== "passed" || page.isClosed()) return;
      if (testInfo.annotations.some((a) => a.type === "allow-horizontal-overflow")) return;
      if (!/^https?:/.test(page.url())) return;
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        scrollWidth,
        `horizontal overflow on ${page.url()}: content is ${scrollWidth}px wide in a ${clientWidth}px viewport`,
      ).toBeLessThanOrEqual(clientWidth + 1);
    },
    { auto: true },
  ],
});
