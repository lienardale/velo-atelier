/**
 * Which URLs need a session, and which must not have one (§4.3).
 *
 * Consumed by the Auth.js `authorized()` callback in `auth.config.ts`, which
 * runs inside `proxy.ts` — so this module stays free of next-intl's navigation
 * runtime (no `createNavigation`, no `getPathname`): it expands the external
 * paths directly from the `routing.pathnames` data.
 *
 *   PROTECTED_KEYS   signed-out visitors are sent to `/<locale>/connexion?callbackUrl=…`
 *   ANON_ONLY_KEYS   signed-in visitors are sent to `/<locale>/mes-velos`
 *
 * Every key is an internal pathname of `routing.pathnames`, so a renamed
 * localized path (say `/en/account` → `/en/profile`) is picked up here without
 * a second edit.
 */
/* eslint-disable security/detect-object-injection -- indexes are `Pathname` / `Locale` literals from routing, never user input */
import { routing, type Locale, type Pathname } from "./routing";

export const PROTECTED_KEYS = [
  "/compte",
  "/mes-velos",
  "/import",
] as const satisfies readonly Pathname[];

export const ANON_ONLY_KEYS = ["/connexion", "/inscription"] as const satisfies readonly Pathname[];

export type ProtectedKey = (typeof PROTECTED_KEYS)[number];
export type AnonOnlyKey = (typeof ANON_ONLY_KEYS)[number];

export type PathAccess = "protected" | "anon-only" | "public";

/**
 * `/(fr|en)` at the start of a pathname, followed by `/` or the end — built
 * from `routing.locales` so a third locale needs no edit here.
 */
// eslint-disable-next-line security/detect-non-literal-regexp -- built from routing.locales (two literals)
const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join("|")})(?=/|$)`);

/**
 * Split `/en/account/x` into `{ locale: 'en', rest: '/account/x' }`.
 * A pathname without a known locale prefix yields `locale: null` and itself.
 */
export function splitLocale(pathname: string): { locale: Locale | null; rest: string } {
  const match = LOCALE_PREFIX.exec(pathname);
  if (!match) return { locale: null, rest: pathname };
  const rest = pathname.slice(match[0].length);
  return { locale: match[1] as Locale, rest: rest === "" ? "/" : rest };
}

/** The unprefixed path `locale` shows for the internal pathname `key` (`/compte` → `/account` in EN). */
export function localizedPath(key: Pathname, locale: Locale): string {
  const entry: string | Readonly<Record<Locale, string>> = routing.pathnames[key];
  return typeof entry === "string" ? entry : entry[locale];
}

/** Every external, locale-prefixed path for `keys`: `/fr/compte`, `/en/account`, … */
export function externalPaths(keys: readonly Pathname[]): string[] {
  return keys.flatMap((key) =>
    routing.locales.map((locale) => {
      const path = localizedPath(key, locale);
      return path === "/" ? `/${locale}` : `/${locale}${path}`;
    }),
  );
}

export const PROTECTED_PATHS: readonly string[] = externalPaths(PROTECTED_KEYS);
export const ANON_ONLY_PATHS: readonly string[] = externalPaths(ANON_ONLY_KEYS);

/** `pathname` is `base` itself or below it (`/fr/compte`, `/fr/compte/x` — never `/fr/comptes`). */
function isAtOrBelow(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Classify a request pathname as seen by the proxy (locale-prefixed, external).
 * A trailing slash is ignored. Anything unprefixed is `public`: the proxy's
 * next-intl step redirects it to a prefixed URL, which is then classified.
 */
export function pathAccess(pathname: string): PathAccess {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (PROTECTED_PATHS.some((base) => isAtOrBelow(normalized, base))) return "protected";
  if (ANON_ONLY_PATHS.some((base) => isAtOrBelow(normalized, base))) return "anon-only";
  return "public";
}
