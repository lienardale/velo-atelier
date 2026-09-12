/**
 * Locale routing — the single source of truth for locales and URL shapes (§6.1).
 *
 * - `localePrefix: 'always'`: every URL carries its locale (`/fr/…`, `/en/…`).
 *   It keeps the Auth.js `authorized()` prefix-strip safe, keeps `?error=`
 *   redirects localized and makes hreflang trivial. (nextjs-blog uses
 *   `as-needed`; this project deliberately does not.)
 * - `localeDetection: false`: `/` always lands on `/fr`; the `Accept-Language`
 *   header never picks the locale. The visitor picks it with `LocaleSwitcher`.
 * - `pathnames`: keys are the INTERNAL (French) paths — the folder names under
 *   `app/[locale]/` — and values are what each locale shows in the address bar.
 *   `Link`, `redirect`, `getPathname` and `useRouter` (from
 *   `@/lib/i18n/navigation`) take the internal key; the proxy rewrites the
 *   external path back to it.
 *
 * Query-parameter names are locale-neutral (`?part=`, `?parts=`, `?step=`,
 * `?spec=`, `?item=`, `?system=`, `?kind=`, `?bike=`, `?q=`, `?callbackUrl=`).
 *
 * Adding a route: add its key here (the e2e `href()` fixture and
 * `lib/i18n/protected-paths.ts` pick it up from this object).
 */
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "en"],
  defaultLocale: "fr",
  localePrefix: "always",
  localeDetection: false,
  pathnames: {
    "/": "/",
    "/velo/[id]": { fr: "/velo/[id]", en: "/bike/[id]" },
    "/velo/[id]/piece/[partId]": {
      fr: "/velo/[id]/piece/[partId]",
      en: "/bike/[id]/part/[partId]",
    },
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
  },
});

/** `'fr' | 'en'`. (The Prisma enum is `UserLocale`, to avoid the name clash.) */
export type Locale = (typeof routing.locales)[number];

/** An internal pathname key of `routing.pathnames` (the French path template). */
export type Pathname = keyof typeof routing.pathnames;

/** Type guard over `routing.locales`, for values that come from outside (URL, cookie, header). */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (routing.locales as readonly string[]).includes(value);
}
