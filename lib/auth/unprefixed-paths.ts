/**
 * Putting a locale back on the URLs Auth.js builds (§4.3).
 *
 * `auth.config.ts` sets `pages: { signIn: '/connexion', error: '/connexion' }`
 * with **no locale prefix**, because Auth.js builds those URLs itself and has no
 * idea which language the visitor reads. Every Auth.js-initiated redirect
 * (`AccessDenied`, `OAuthCallbackError`, `Configuration`, `Verification`)
 * therefore arrives at the proxy as a bare `/connexion?error=…`, which under
 * `localePrefix: 'always'` is not a real page.
 *
 * This is the one function that fixes that, and it lives here rather than inline
 * in `proxy.ts` for two reasons: `proxy.ts` is excluded from coverage as pure
 * wiring, and importing it in a Node test boots a whole second Auth.js instance.
 *
 * `proxy.ts` re-exports it, so the behaviour is still documented where it runs.
 */

import { NextResponse, type NextRequest } from "next/server";

import { localizedPath } from "@/lib/i18n/protected-paths";
import { isLocale, routing, type Locale, type Pathname } from "@/lib/i18n/routing";

/** next-intl's locale cookie — the only clue an unprefixed URL carries. */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

/** The internal pathname keys Auth.js may redirect to without a locale prefix. */
export const UNPREFIXED_AUTH_PATHS = [
  "/connexion",
  "/inscription",
] as const satisfies readonly Pathname[];

function localeOf(value: string | undefined): Locale {
  return isLocale(value) ? value : routing.defaultLocale;
}

/**
 * A 307 to the localized, prefixed form of a bare `/connexion` / `/inscription`,
 * or `null` when the request is not one of those.
 *
 * The match is exact: `/connexion-oubliee` is a different page (or a 404), not a
 * login form, and `/fr/connexion` is already correct.
 */
export function localizeUnprefixedAuthPath(request: NextRequest): NextResponse | null {
  const { pathname, search } = request.nextUrl;
  const key = UNPREFIXED_AUTH_PATHS.find((candidate) => candidate === pathname);
  if (!key) return null;

  const locale = localeOf(request.cookies.get(LOCALE_COOKIE_NAME)?.value);
  const target = new URL(`/${locale}${localizedPath(key, locale)}${search}`, request.nextUrl);
  return NextResponse.redirect(target, 307);
}
