/**
 * The Auth.js session cookie, as a contract this app can re-issue itself.
 *
 * ## Why the app mints a session token at all
 *
 * Sessions are JWTs, so there is no row to delete when a password changes.
 * `User.sessionVersion` stands in for one: `changePasswordAction` increments it,
 * and the `jwt` callback (`lib/auth/jwt.ts`) drops any token whose number no
 * longer matches the row — on its periodic re-check **and on `trigger:
 * "update"`**. That second part is deliberate: Auth.js fires `update` from the
 * client too (`POST /api/auth/session`), so if an update could adopt the new
 * number, a stolen cookie would survive the very password change meant to kill it.
 *
 * The device that changed the password must stay signed in, though (§4.3). It
 * cannot get there through `unstable_update()` — that is an `update` trigger, and
 * the check above refuses it. So the server action, which has just verified the
 * current password, writes this device a fresh token carrying the new number
 * (`mintSessionToken`), under the same cookie name the request arrived with
 * (`presentSessionCookie`). No client-reachable path can do that.
 *
 * Decided with the user on 2026-09-13 to resolve a contradiction in plan §4
 * line 484; see `.debug/003`.
 *
 * ## The contract
 *
 * The token is encrypted with `encode()` from `next-auth/jwt`, salted with the
 * cookie name — exactly what Auth.js does, so Auth.js decodes it as its own.
 * `tests/e2e/_fixtures.ts` signs browsers in through the same function, so
 * e2e and production can never drift apart.
 *
 * Plain Node: no `server-only`, no `next/headers`. The action reads and writes
 * the cookie jar; this module only computes names and values.
 */

import { decode, encode } from "next-auth/jwt";

/** Session lifetime in seconds. `auth.config.ts` reads it too. */
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

/**
 * How old a session token must be before a page load may roll its expiry (§4:
 * `updateAge: 24h`). Auth.js core honours `updateAge` for database sessions only;
 * for JWT sessions it re-writes the cookie on EVERY read, so `proxy.ts` applies
 * this rule itself (`sessionRefreshPolicy`).
 */
export const SESSION_UPDATE_AGE_S = 24 * 60 * 60;

/** The cookie name Auth.js uses over plain HTTP. */
export const SESSION_COOKIE_NAME = "authjs.session-token";

/** The cookie name Auth.js uses over HTTPS (the `__Secure-` prefix). */
export const SECURE_SESSION_COOKIE_NAME = "__Secure-authjs.session-token";

/** The session cookie name for a site served over HTTPS or not. */
export function sessionCookieNameFor(secure: boolean): string {
  return secure ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME;
}

/** The session cookie a request carries, and any chunk cookies that belong to it. */
export interface PresentSessionCookie {
  /** The base name: `authjs.session-token` or `__Secure-authjs.session-token`. */
  name: string;
  /** Chunk cookies (`<name>.0`, `<name>.1`, …) Auth.js wrote for a token over 4 KB. */
  chunks: string[];
}

/**
 * Which session cookie a request carries, judging by cookie names alone.
 *
 * Re-issuing under the name the request arrived with is what makes the new
 * cookie replace the old one, whether the site runs on HTTP (local, e2e) or
 * HTTPS (Vercel) — no guessing the protocol from proxy headers. The secure name
 * wins if a browser somehow holds both. Returns `null` when there is no session
 * cookie: then there is no device to keep signed in.
 */
export function presentSessionCookie(cookieNames: Iterable<string>): PresentSessionCookie | null {
  const names = [...cookieNames];
  for (const name of [SECURE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME]) {
    const chunks = names.filter(
      (candidate) =>
        candidate.startsWith(`${name}.`) && /^\d+$/.test(candidate.slice(name.length + 1)),
    );
    if (names.includes(name) || chunks.length > 0) return { name, chunks };
  }
  return null;
}

/** The claims this app puts in a session token (§7.2 fixture contract). */
export interface SessionTokenClaims {
  id: string;
  email: string;
  name: string | null;
  picture?: string | null;
  locale: string;
  sessionVersion: number;
}

export interface MintOptions {
  secret: string;
  /** The cookie name — also the encryption salt, as in Auth.js. */
  cookieName: string;
  maxAge?: number;
  now?: () => number;
}

/**
 * An encrypted session token Auth.js accepts as its own.
 *
 * `checkedAt: now` means the `jwt` callback does not re-read the row on the
 * next request: the caller has just written `sessionVersion` itself.
 */
export async function mintSessionToken(
  claims: SessionTokenClaims,
  { secret, cookieName, maxAge = SESSION_MAX_AGE_S, now = Date.now }: MintOptions,
): Promise<string> {
  return encode({
    token: {
      sub: claims.id,
      id: claims.id,
      email: claims.email,
      name: claims.name,
      picture: claims.picture ?? null,
      locale: claims.locale,
      sessionVersion: claims.sessionVersion,
      checkedAt: now(),
    },
    secret,
    salt: cookieName,
    maxAge,
  });
}

/**
 * Cookie attributes matching Auth.js's own session cookie, for a given name.
 *
 * `secure` follows the `__Secure-` prefix, which browsers require to be set
 * with `Secure` and which Auth.js only uses over HTTPS.
 */
export function sessionCookieOptions(cookieName: string, maxAge = SESSION_MAX_AGE_S) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: cookieName.startsWith("__Secure-"),
    maxAge,
  };
}

/** Whether a `Set-Cookie` header value deletes its cookie (empty value, or `Max-Age=0`). */
export function isDeletingSetCookie(setCookie: string): boolean {
  const [pair = "", ...attributes] = setCookie.split(";");
  const value = pair.slice(pair.indexOf("=") + 1).trim();
  return value === "" || attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute));
}

/** Whether a `Set-Cookie` header value writes the session cookie or one of its chunks. */
export function isSessionSetCookie(setCookie: string): boolean {
  const name = setCookie.slice(0, setCookie.indexOf("=")).trim();
  return [SESSION_COOKIE_NAME, SECURE_SESSION_COOKIE_NAME].some(
    (base) =>
      name === base || (name.startsWith(`${base}.`) && /^\d+$/.test(name.slice(base.length + 1))),
  );
}

/**
 * `headers` without the session cookies `auth()` wrote into them.
 *
 * `proxy.ts` wraps every request in Auth.js's `auth()`, which re-encodes a JWT
 * session and sets the cookie again on every read (a rolling expiry). On a
 * server-action POST that refresh lands in the SAME response as the cookie the
 * action writes — `signOut()` deleting it, `signIn()` setting it, a password
 * change re-issuing it — and two `Set-Cookie`s for one name make the result
 * depend on which the browser applies last. Observed on the sign-out POST:
 *
 *     authjs.session-token=eyJ…; Expires=…    ← auth() refresh (proxy)
 *     authjs.session-token=; Max-Age=0         ← signOut()
 *
 * The proxy strips its own session cookies on action POSTs, so the action's is
 * the only one. Other cookies (`NEXT_LOCALE`, the CSRF and callback cookies)
 * pass through. The session keeps its previous expiry until the next page load.
 */
export function withoutSessionSetCookies(
  headers: Headers,
  { keepDeletions = false }: { keepDeletions?: boolean } = {},
): Headers {
  const kept = new Headers(headers);
  kept.delete("set-cookie");
  for (const cookie of headers.getSetCookie()) {
    const drop = isSessionSetCookie(cookie) && !(keepDeletions && isDeletingSetCookie(cookie));
    if (!drop) kept.append("set-cookie", cookie);
  }
  return kept;
}

/**
 * The response of `GET /api/auth/session`, minus the refreshed session cookie.
 *
 * Auth.js re-encodes a JWT session and sets the cookie again on every session
 * read. The browser reads it constantly: `SessionProvider` on mount, and
 * `AccountMenu` on every route change. A read that is still in flight when the
 * visitor signs out comes back AFTER the sign-out response, carrying the old
 * token, and its `Set-Cookie` signs the visitor straight back in (reproduced in
 * `tests/e2e/auth-login.spec.ts` "signing out clears the session cookie" under
 * parallel load). The same late read would also overwrite the cookie a password
 * change just re-issued with the previous `sessionVersion`.
 *
 * So the JSON endpoint writes no refreshed session cookie. The expiry still
 * rolls: `proxy.ts` refreshes it on every page and RSC navigation. A deletion
 * (an invalidated session) still passes, because a deletion can only sign out.
 */
export function withoutSessionRefresh(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: withoutSessionSetCookies(response.headers, { keepDeletions: true }),
  });
}

/** What the proxy may do with the session cookies `auth()` put on a response. */
export type SessionRefreshPolicy =
  /** Leave the response as Auth.js built it. */
  | "keep"
  /** Drop refreshed session cookies; a deletion (invalidated session) still passes. */
  | "drop-refresh"
  /** Drop every session cookie the proxy added: the action writes the only one. */
  | "drop-all";

export interface SessionRefreshRequest {
  /** A server-action call (`POST` + `Next-Action`). */
  isServerAction: boolean;
  /** A client-router request: RSC payload or prefetch (`RSC`, `Next-Router-Prefetch`, `?_rsc=`). */
  isRouterRequest: boolean;
  /** Seconds since the incoming session token was issued, or `null` when there is none or it is unreadable. */
  tokenAgeS: number | null;
}

/**
 * Whether the proxy keeps the rolling refresh Auth.js added to a response.
 *
 * Every session read re-writes the cookie, and a read can land AFTER the visitor
 * signed out: reproduced with Next.js router prefetches (`/fr?_rsc=…`,
 * `/fr/guides?_rsc=…`, fired by the header links right after the sign-out
 * redirect) — 10 of 16 parallel sign-outs were undone by one (`.debug/003`).
 * So only a request that cannot race a sign-out may refresh: a full document
 * navigation, and only once the token is `SESSION_UPDATE_AGE_S` old, which is
 * also the daily sliding refresh §4 asks for.
 */
export function sessionRefreshPolicy(
  { isServerAction, isRouterRequest, tokenAgeS }: SessionRefreshRequest,
  updateAgeS = SESSION_UPDATE_AGE_S,
): SessionRefreshPolicy {
  if (isServerAction) return "drop-all";
  if (isRouterRequest) return "drop-refresh";
  return tokenAgeS !== null && tokenAgeS >= updateAgeS ? "keep" : "drop-refresh";
}

/**
 * Seconds since a session token was issued (its `iat`), or `null` when it cannot
 * be decrypted with `secret` — a wrong salt, a corrupt value, a chunked token.
 * `null` never keeps a refresh, so an unreadable token only ever means fewer writes.
 */
export async function sessionTokenAgeS(
  token: string,
  {
    secret,
    cookieName,
    now = Date.now,
  }: { secret: string; cookieName: string; now?: () => number },
): Promise<number | null> {
  try {
    const payload = await decode({ token, secret, salt: cookieName });
    const issuedAt = payload?.iat;
    return typeof issuedAt === "number" ? Math.max(0, Math.floor(now() / 1000) - issuedAt) : null;
  } catch {
    return null;
  }
}
