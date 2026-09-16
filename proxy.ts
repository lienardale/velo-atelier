/**
 * Request proxy (Next 16's `middleware`) — Auth.js over next-intl (§4.3, §6.1).
 *
 * Three things happen on every matched request, in this order:
 *
 * 1. **`auth()` runs `authorized()`** (auth.config.ts) with the decoded
 *    session. If it returns a `Response` — a protected page with no session, a
 *    login page with one — Auth.js uses that response and the handler below
 *    never runs. That is why `authorized()` must return fully-formed,
 *    locale-prefixed URLs: next-intl will not get a chance to fix them up.
 *
 * 2. **Server-action requests short-circuit.** A POST carrying `Next-Action`
 *    targets the page it was rendered on; running the next-intl rewrite over it
 *    would resolve the localized path again and can land the action on a
 *    different route. bd-platform hit exactly that; `NextResponse.next()` is the
 *    fix.
 *
 * 3. **The unprefixed Auth.js pages get a locale.** `pages.signIn` /
 *    `pages.error` are `/connexion` with no prefix (see auth.config.ts), so an
 *    Auth.js-initiated redirect (`AccessDenied`, `OAuthCallbackError`,
 *    `Configuration`) arrives here bare. It is re-issued as
 *    `/<locale><localized path>` with the query intact, the locale taken from
 *    the `NEXT_LOCALE` cookie — `tests/unit/auth/error-locale.test.ts` pins
 *    `/connexion?error=AccessDenied` + `NEXT_LOCALE=en` → 307 `/en/sign-in?error=AccessDenied`.
 *
 * Everything else is next-intl exactly as W0 left it: `/` → 307 `/fr`
 * (`localePrefix: 'always'`, `localeDetection: false`), localized external paths
 * rewritten to their internal route, `NEXT_LOCALE` kept in sync.
 *
 * Next 16 runs `proxy.ts` on the Node runtime. **Never export `runtime`** from
 * this file, and keep it free of Prisma / bcrypt (ESLint enforces it).
 */
import NextAuth from "next-auth";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { authConfig } from "@/auth.config";
import {
  isDeletingSetCookie,
  isSessionSetCookie,
  presentSessionCookie,
  sessionRefreshPolicy,
  sessionTokenAgeS,
  withoutSessionSetCookies,
} from "@/lib/auth/session-cookie";
import { localizeUnprefixedAuthPath } from "@/lib/auth/unprefixed-paths";
import { routing } from "@/lib/i18n/routing";

// Re-exported so the behaviour stays discoverable from the file it runs in.
// It lives in lib/auth because `proxy.ts` is coverage-excluded wiring and
// importing it in a node test would boot a second Auth.js instance.
export { localizeUnprefixedAuthPath };

const intlMiddleware = createMiddleware(routing);

/**
 * A SECOND Auth.js instance, built from the proxy-safe half of the config only.
 *
 * This is the documented v5 split, and it is what keeps the promise made in
 * `auth.config.ts`: importing `@/auth` here would drag the Prisma adapter, the
 * generated client and bcrypt into a module that runs on every request. All the
 * proxy needs is to decode the session cookie and run `authorized()`, and both
 * live in `authConfig`.
 */
const { auth } = NextAuth(authConfig);

const authProxy = auth((request) => {
  if (isServerAction(request)) return actionResponse(request);
  return localizeUnprefixedAuthPath(request) ?? intlMiddleware(request);
}) as unknown as (request: NextRequest, event: NextFetchEvent) => Promise<Response>;

/** A server-action call: always a POST carrying `Next-Action`. */
function isServerAction(request: Request): boolean {
  return request.method === "POST" && request.headers.has("Next-Action");
}

/**
 * `auth()` runs on EVERY request, actions included — the protected layout has
 * no session check of its own, so `authorized()` here is the guard and must not
 * be skipped for any request.
 *
 * On an action POST, though, the response `auth()` builds carries a refreshed
 * session cookie next to whatever cookie the action itself writes (sign-in sets
 * it, sign-out deletes it, a password change re-issues it with a new
 * `sessionVersion`). Two `Set-Cookie`s for one name make the outcome depend on
 * which the browser applies last: sign-out sometimes left the visitor signed in,
 * and a password change sometimes left this device with the old version.
 * `withoutSessionSetCookies` drops the proxy's copy, so the action's wins.
 *
 * The same race exists for every GET that reads the session while a sign-out is
 * landing: router prefetches re-wrote the cookie after sign-out in 10 of 16
 * parallel runs. So the proxy keeps Auth.js's rolling refresh only on a full
 * document navigation with a token at least a day old (`sessionRefreshPolicy`,
 * which is also §4's `updateAge`); deletions always pass.
 */
export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
): Promise<Response> {
  const response = await authProxy(request, event);
  const writesSession = response.headers
    .getSetCookie()
    .some((cookie) => isSessionSetCookie(cookie) && !isDeletingSetCookie(cookie));
  if (!writesSession && !isServerAction(request)) return response;

  const policy = sessionRefreshPolicy({
    isServerAction: isServerAction(request),
    isRouterRequest: isRouterRequest(request),
    tokenAgeS: await incomingTokenAgeS(request),
  });
  if (policy === "keep") return response;
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: withoutSessionSetCookies(response.headers, {
      keepDeletions: policy === "drop-refresh",
    }),
  });
}

/** A client-router request: an RSC payload or a prefetch, never a full document load. */
function isRouterRequest(request: NextRequest): boolean {
  return (
    request.headers.has("RSC") ||
    request.headers.has("Next-Router-Prefetch") ||
    request.nextUrl.searchParams.has("_rsc")
  );
}

/** Age of the session token this request carries, for the daily refresh rule. */
async function incomingTokenAgeS(request: NextRequest): Promise<number | null> {
  const secret = process.env.AUTH_SECRET;
  const present = presentSessionCookie(request.cookies.getAll().map((cookie) => cookie.name));
  if (!secret || !present || present.chunks.length > 0) return null;
  const token = request.cookies.get(present.name)?.value;
  return token ? sessionTokenAgeS(token, { secret, cookieName: present.name }) : null;
}

/**
 * The proxy's answer to a server-action POST.
 *
 * The plan (and bd-platform) short-circuit these with a bare
 * `NextResponse.next()`, on the grounds that running the next-intl rewrite over
 * an action can land it on a different route. That is true of a *redirect* —
 * a 307 turns the POST into a GET on some browsers and drops the body either
 * way — but here it threw away something the English side needs.
 *
 * A server action posts to the URL of the page it was rendered on, and in
 * English that URL is the TRANSLATED path: `/en/sign-in`, `/en/account`,
 * `/en/my-bikes`. Only next-intl's rewrite maps those back to the app routes
 * (`/en/connexion`, `/en/compte`, `/en/mes-velos`). Skipping it made every
 * English action resolve against a route that does not exist: the sign-in
 * action returned 200 with no `Set-Cookie` and the visitor landed signed-out on
 * `/en/my-bikes` (`tests/e2e/auth-login.spec.ts` "a correct pair signs in…",
 * which is why this is caught by a browser test and by nothing below it).
 * French never noticed, because `/fr/connexion` is already the internal path.
 *
 * So: run the middleware, and keep its answer only when it is a rewrite —
 * method, body and headers all preserved. Anything else (a redirect, a locale
 * negotiation) is dropped in favour of `next()`, which is the protection the
 * plan was asking for.
 */
function actionResponse(request: Parameters<typeof intlMiddleware>[0]): NextResponse {
  const response = intlMiddleware(request);
  return response.headers.has("x-middleware-rewrite") ? response : NextResponse.next();
}

export const config = {
  // Everything except API routes, Next internals, Vercel internals, the
  // metadata files and any path with a dot (static assets).
  matcher: "/((?!api|_next|_vercel|sitemap\\.xml|robots\\.txt|opengraph-image|.*\\..*).*)",
};
