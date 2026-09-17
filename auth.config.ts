/**
 * The half of the Auth.js configuration that runs in `proxy.ts` (§4.3).
 *
 * `proxy.ts` wraps this in `auth()`, and Next 16 runs it on every matched
 * request. So this file must stay **small and dependency-free**: no Prisma, no
 * bcrypt, no `@/lib/db/**`, no generated client. ESLint enforces that
 * (`velo-atelier/proxy-safe` in `eslint.config.mjs`); the adapter, the
 * Credentials provider and the `jwt` callback live in `auth.ts`, which the
 * proxy never imports.
 *
 * Two things are worth reading carefully.
 *
 * **`pages` is unprefixed by design.** `signIn: '/connexion'` has no locale,
 * because Auth.js builds those URLs itself and has no idea which locale the
 * visitor is in. `proxy.ts` catches the bare `/connexion` and `/inscription` and
 * re-prefixes them from the `NEXT_LOCALE` cookie, so
 * `/connexion?error=AccessDenied` becomes `/en/sign-in?error=AccessDenied` for
 * an English visitor (`tests/unit/auth/error-locale.test.ts`).
 *
 * **`authorized()` never returns `false`.** Returning `false` makes Auth.js
 * redirect to the *unprefixed* `pages.signIn`, losing the locale and the
 * localized path; it also skips the wrapped middleware entirely, so next-intl
 * never runs. Every branch here returns `true` or an explicit
 * `Response.redirect` to a fully-formed, locale-prefixed URL.
 */

import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

import { loginUrl } from "@/lib/auth/safe-callback-url";
import { SESSION_MAX_AGE_S, SESSION_UPDATE_AGE_S } from "@/lib/auth/session-cookie";
import { localizedPath, pathAccess, splitLocale } from "@/lib/i18n/protected-paths";
import { isLocale, routing, type Locale } from "@/lib/i18n/routing";

/** next-intl's cookie. The one place a locale can be recovered from an unprefixed URL. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** The locale to use when the URL does not carry one: the cookie, else French. */
export function localeFromCookie(value: string | undefined | null): Locale {
  return isLocale(value) ? value : routing.defaultLocale;
}

/**
 * Google's `email_verified` claim, read defensively.
 *
 * The OIDC `Profile` type is an open bag of claims and some providers send the
 * boolean as the string `"true"`. Only a real `true` (or that exact string)
 * counts: `undefined` and `false` are equally "not verified", and the whole
 * safety of `allowDangerousEmailAccountLinking` rests on this one predicate.
 */
export function isEmailVerified(profile: unknown): boolean {
  const claim = (profile as { email_verified?: unknown } | undefined)?.email_verified;
  return claim === true || claim === "true";
}

/** The locale of the request that started an OAuth round trip, from its cookie. */
async function requestLocale(): Promise<Locale> {
  // Imported lazily: this file is also loaded by `proxy.ts`, where `next/headers`
  // does not exist. The callback that calls it only ever runs in a route handler.
  const { cookies } = await import("next/headers");
  return localeFromCookie((await cookies()).get(LOCALE_COOKIE)?.value);
}

/** `/fr/compte` — a locale-prefixed external path for an internal pathname key. */
function external(key: Parameters<typeof localizedPath>[0], locale: Locale): string {
  const path = localizedPath(key, locale);
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

export const authConfig = {
  providers: [
    Google({
      // Accounts are keyed by e-mail here: a visitor who signed up with a
      // password and later clicks "Continue with Google" must land on the same
      // account, not a duplicate. The hole this opens — an OAuth provider that
      // hands out unverified addresses could take over an account — is closed
      // by the `signIn` callback in `auth.ts`, which refuses any Google profile
      // without `email_verified === true`.
      allowDangerousEmailAccountLinking: true,
      profile: (profile) => ({
        id: profile.sub,
        name: profile.name,
        email: profile.email,
        image: profile.picture,
      }),
    }),
  ],

  // SESSION_MAX_AGE_S is shared with the cookie the app re-issues on a password change.
  // updateAge is enforced by proxy.ts for JWT sessions (Auth.js only honours it for database sessions).
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S, updateAge: SESSION_UPDATE_AGE_S },

  // Unprefixed on purpose — see the header comment.
  pages: { signIn: "/connexion", error: "/connexion" },

  callbacks: {
    /**
     * The gate that makes account linking by e-mail safe.
     *
     * Only Google is inspected — a credentials sign-in has already been decided
     * by `authorizeCredentials`. A Google profile whose address is not verified
     * is refused, and refused by *returning a URL* rather than `false`, so the
     * visitor lands on the login page in their own language with a message that
     * says what happened instead of on Auth.js's unprefixed error page.
     */
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      if (isEmailVerified(profile)) return true;
      return loginUrl(await requestLocale(), { error: "OAuthAccountNotLinked" });
    },

    /**
     * Copy the JWT's own fields onto the session object the app reads.
     * Auth.js only forwards `name`, `email` and `image` by default.
     */
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? token.sub ?? session.user.id;
        session.user.locale = token.locale ?? routing.defaultLocale;
        session.user.authAt = token.authAt;
        session.user.authProvider = token.authProvider;
      }
      return session;
    },

    /**
     * Same-origin redirects only.
     *
     * `url` is whatever was handed to `signIn({ redirectTo })` or arrived as
     * `?callbackUrl=`. A relative path is resolved against our own origin; an
     * absolute URL is accepted only if it *is* our origin; anything else falls
     * back to the base URL. `safeCallbackUrl()` has already run for the paths
     * the app builds — this is the backstop for the ones Auth.js builds.
     */
    redirect({ url, baseUrl }) {
      if (url.startsWith("/") && !url.startsWith("//")) return `${baseUrl}${url}`;
      try {
        return new URL(url).origin === baseUrl ? url : baseUrl;
      } catch {
        return baseUrl;
      }
    },

    /**
     * Route guard, run inside the proxy on every matched request.
     *
     * Protected page + no session → the login form, carrying the page as
     * `?callbackUrl=` so the visitor resumes where they were aiming
     * (§4.8 AC5: `/fr/mes-velos` → `/fr/connexion?callbackUrl=%2Ffr%2Fmes-velos`).
     * Login/sign-up page + a session → their bikes; there is nothing to do on a
     * sign-in form you have already used.
     *
     * `/dev/*` is deliberately NOT guarded here: those pages are gated
     * server-side by `ENABLE_TEST_PAGES`, which is the gate that must hold, and
     * a second one in the proxy would only make the first look optional.
     */
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const { locale: urlLocale } = splitLocale(nextUrl.pathname);
      const locale = urlLocale ?? localeFromCookie(request.cookies.get(LOCALE_COOKIE)?.value);
      const access = pathAccess(nextUrl.pathname);
      const signedIn = Boolean(auth?.user);

      if (access === "protected" && !signedIn) {
        const target = new URL(external("/connexion", locale), nextUrl);
        target.searchParams.set("callbackUrl", `${nextUrl.pathname}${nextUrl.search}`);
        return Response.redirect(target);
      }

      if (access === "anon-only" && signedIn) {
        return Response.redirect(new URL(external("/mes-velos", locale), nextUrl));
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
