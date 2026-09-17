/**
 * The wrapper every authenticated server action goes through (§4.4).
 *
 * Two checks, in this order, before a single line of the action's own body
 * runs:
 *
 *   1. **Same origin.** A server action is a POST to the page's own URL. Next
 *      already refuses a foreign `Origin`; this is our own copy of that lock,
 *      and `tests/security/csrf-and-actions.test.ts` is what keeps it honest.
 *      It runs FIRST, so a cross-origin probe is answered `FORBIDDEN` without
 *      revealing whether the cookie it carried was valid.
 *
 *   2. **A session.** No session → `UNAUTHORIZED`, returned **before any Prisma
 *      call** (the same security test asserts the call log is empty).
 *
 * The action then receives `{ user }` — never `null` — and returns an
 * `ActionResult`. It does not receive the raw `Session`: everything downstream
 * needs `user.id` and `user.locale`, and handing it less makes an accidental
 * `session.user.email`-based lookup impossible to write.
 *
 * `import "server-only"` is one of the three the project allows (see
 * `CLAUDE.md`): this module reaches `next/headers` and `@/auth`, so it must
 * never be reachable from `prisma/seed.ts` or `scripts/**`.
 *
 * Ownership is NOT handled here — it belongs in each action's `where` clause,
 * nesting `bike: { userId }`, because that is what makes a foreign id return
 * nothing (and therefore `NOT_FOUND`, never `FORBIDDEN`) instead of being
 * fetched and then rejected.
 */

import "server-only";

import { cookies, headers } from "next/headers";
import { redirect as nextRedirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { loginUrl } from "@/lib/auth/safe-callback-url";
import {
  cookieFromHeader,
  decodeSessionClaims,
  presentSessionCookie,
  SECURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-cookie";
import { isLocale, routing } from "@/lib/i18n/routing";
import { localizedPath } from "@/lib/i18n/protected-paths";
import { assertSameOrigin, CrossOriginRequestError } from "@/lib/security/origin";
import type { Locale, Pathname } from "@/lib/i18n/routing";

import { fail, type ActionResult } from "./result";

/** The caller, as an action sees it. */
export interface ActionUser {
  id: string;
  email: string;
  name: string | null;
  locale: Locale;
  /** When and how the session signed in — see lib/auth/reauth.ts. */
  authAt?: number;
  authProvider?: string;
}

export interface ActionContext {
  user: ActionUser;
}

/**
 * Wrap an action body so it only ever runs same-origin and signed in.
 *
 * ```ts
 * export const renameBikeAction = withUser(async ({ user }, formData: FormData) => { … });
 * ```
 *
 * The rest parameter keeps `useActionState`'s `(prevState, formData)` shape
 * working unchanged.
 */
export function withUser<Args extends unknown[], T>(
  action: (context: ActionContext, ...args: Args) => Promise<ActionResult<T>>,
): (...args: Args) => Promise<ActionResult<T>> {
  return async (...args: Args) => {
    const context = await requireUser();
    if (!context.ok) return context;
    return action({ user: context.data }, ...args);
  };
}

/**
 * `FORBIDDEN` when the request is not same-origin, `null` when it is.
 *
 * The anonymous actions (sign in, sign up, Google, sign out) have no session to
 * wrap but need exactly the same first check, so they call this directly rather
 * than repeating the try/catch.
 */
export async function guardSameOrigin(): Promise<ActionResult<never> | null> {
  try {
    await assertSameOrigin();
    return null;
  } catch (error) {
    if (error instanceof CrossOriginRequestError) return fail("FORBIDDEN");
    throw error;
  }
}

/**
 * The same two checks, as a value rather than a wrapper.
 *
 * Server *components* (the `(protected)` pages) use this: they have no origin
 * to check and redirect rather than return, but the session shape must be the
 * one actions see.
 */
export async function requireUser(): Promise<ActionResult<ActionUser>> {
  const crossOrigin = await guardSameOrigin();
  if (crossOrigin) return crossOrigin;

  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return fail("UNAUTHORIZED");

  return {
    ok: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      locale: user.locale,
      authAt: user.authAt,
      authProvider: user.authProvider,
    },
  };
}

/** The session's user without the origin check — for server components, which are GETs. */
export async function currentUser(): Promise<ActionUser | null> {
  const reissued = await sessionWrittenThisRequest();
  if (reissued !== undefined) return reissued;

  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    locale: user.locale,
    authAt: user.authAt,
    authProvider: user.authProvider,
  };
}

/**
 * Send a visitor who is not (or no longer) signed in to the sign-in form, with
 * `from` as the callback URL.
 *
 * When a session cookie is still present the session was rejected here — a
 * password changed on another device, a deleted account — while the proxy, which
 * cannot check `sessionVersion`, still believes it. Redirecting straight to the
 * form would loop (the proxy sends "signed-in" visitors away from it), so the
 * visitor goes through `/api/session-expired`, which clears the cookie first.
 * An unlocalized `/api` path, hence `next/navigation`'s `redirect`.
 */
export async function redirectToSignIn(locale: Locale, from: Pathname): Promise<never> {
  const callbackUrl = `/${locale}${localizedPath(from, locale)}`;
  const jar = await cookies();
  if (presentSessionCookie(jar.getAll().map((cookie) => cookie.name))) {
    nextRedirect(`/api/session-expired?${new URLSearchParams({ locale, callbackUrl }).toString()}`);
  }
  nextRedirect(loginUrl(locale, { callbackUrl }));
}

/** The signed-in user for a protected page, or a redirect that cannot loop. */
export async function requireSignedInUser(locale: Locale, from: Pathname): Promise<ActionUser> {
  const user = await currentUser();
  if (user) return user;
  return redirectToSignIn(locale, from);
}

/**
 * The session as THIS request left it, when server code rewrote the session
 * cookie during the request; `undefined` when it did not.
 *
 * Setting a cookie in a server action makes Next re-render the page in the same
 * response, and that render's `auth()` reads the cookie from the request HEADERS,
 * which Next does not update after `cookies().set()`. After a password change the
 * render therefore saw the old token, failed the `sessionVersion` re-check and
 * bounced the visitor off the page they had just saved (W1 security review,
 * `.debug/003`). The cookie store does carry the new value, and only server code
 * can have put it there, so a value that differs from the incoming header is the
 * one to trust: decode it; an emptied one means signed out.
 */
async function sessionWrittenThisRequest(): Promise<ActionUser | null | undefined> {
  const jar = await cookies();
  const incoming = (await headers()).get("cookie");
  for (const name of [SECURE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME]) {
    const now = jar.get(name)?.value;
    const before = cookieFromHeader(incoming, name);
    if ((now ?? null) === before) continue;
    if (!now) return null;
    const secret = process.env.AUTH_SECRET;
    if (!secret) return undefined;
    const claims = await decodeSessionClaims(now, { secret, cookieName: name });
    if (!claims) return undefined;
    // Defence in depth: whatever made the two values differ, a token that does not
    // carry the row's current sessionVersion is never trusted from here — it goes
    // through auth()'s normal re-check instead.
    const row = await prisma.user.findUnique({
      where: { id: claims.id },
      select: { sessionVersion: true },
    });
    if (!row || row.sessionVersion !== claims.sessionVersion) return undefined;
    return {
      id: claims.id,
      email: claims.email,
      name: claims.name,
      locale: isLocale(claims.locale) ? claims.locale : routing.defaultLocale,
    };
  }
  return undefined;
}
