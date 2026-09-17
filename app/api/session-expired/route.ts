/**
 * `GET /api/session-expired?locale=fr&callbackUrl=/fr/compte` — the way out of a
 * session only half the app still believes in.
 *
 * The proxy decodes the session cookie with the proxy-safe Auth.js instance,
 * which has no `sessionVersion` check; pages use `@/auth`, which has one. After a
 * password change on another device (or an account deletion) the two disagree:
 * the page sends the visitor to sign-in, the proxy sees "signed in" on an
 * anonymous-only page and sends them back — ERR_TOO_MANY_REDIRECTS (W1 security
 * review, `.debug/003`). Nothing in that loop could delete the cookie: RSC
 * renders cannot write cookies, and the proxy never sees the session as invalid.
 *
 * A route handler can. `redirectToSignIn()` sends a visitor here when its session was
 * rejected but a session cookie is still present; this handler clears the cookie
 * and redirects to the localized sign-in form. `/api` is outside the proxy
 * matcher, so the proxy's stale view cannot bounce this request.
 *
 * It clears ONLY when `auth()` here agrees the session is invalid, so a third-party
 * page cannot use it to sign anyone out (`<img src="/api/session-expired">`).
 * The callback URL goes through `safeCallbackUrl`, like every other redirect.
 *
 * And ONLY on a top-level navigation (`Sec-Fetch-Mode: navigate`). A cookie is
 * deleted by NAME: a background request (a router prefetch or RSC fetch) that left
 * with an OLD token just before a password change landed would follow the page's
 * redirect here and delete the NEW cookie the browser holds by then — reproduced
 * with a stale token and `Sec-Fetch-Mode: cors` (.debug/003). Background requests
 * get a bare 401 instead; Next's router treats a non-RSC answer as "load this page
 * for real", and that full navigation is the one that clears. A client that sends
 * no fetch metadata at all (no browser race to lose) is treated as a navigation.
 */
import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { loginUrl, safeCallbackUrl } from "@/lib/auth/safe-callback-url";
import { sessionCookieNamesIn } from "@/lib/auth/session-cookie";
import { isLocale, routing } from "@/lib/i18n/routing";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const fetchMode = request.headers.get("sec-fetch-mode");
  if (fetchMode !== null && fetchMode !== "navigate") {
    return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const requested = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(requested) ? requested : routing.defaultLocale;
  const rawCallback = request.nextUrl.searchParams.get("callbackUrl");
  const target =
    rawCallback === null
      ? loginUrl(locale)
      : loginUrl(locale, { callbackUrl: safeCallbackUrl(rawCallback, locale) });

  const response = NextResponse.redirect(new URL(target, request.nextUrl.origin), 303);

  const session = await auth();
  if (!session?.user) {
    for (const name of sessionCookieNamesIn(
      request.cookies.getAll().map((cookie) => cookie.name),
    )) {
      response.cookies.set(name, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
        sameSite: "lax",
        secure: name.startsWith("__Secure-"),
      });
    }
  }
  return response;
}
