/**
 * The `jwt` callback's logic, extracted so it can be tested (§4.3).
 *
 * `auth.ts` is deliberately "wiring with no branches" — that is the stated
 * reason it is excluded from coverage — so the one callback in it that *does*
 * branch lives here instead, behind explicit dependencies. The whole decision
 * table is then exercised by `tests/unit/auth/jwt-callback.test.ts` against the
 * recording fake Prisma, with no Auth.js runtime and no clock.
 *
 * What it decides, in order:
 *
 *   1. **Sign-in** (`user` present): seed the token from the provider's user.
 *      Credentials hands us `locale` and `sessionVersion` directly; Google goes
 *      through the adapter and hands us neither, so step 3 fetches them.
 *   2. **No subject at all**: drop the token. A JWT with no `sub` cannot be
 *      tied to an account and must not be treated as a session.
 *   3. **Re-check**, when the token has not been checked for `recheckMs`, when
 *      the caller triggered an update (`unstable_update()`), or when
 *      `sessionVersion` is missing. Any of three outcomes:
 *        - no row  → the account was deleted → drop the token;
 *        - a different `sessionVersion` → the password was changed on another
 *          device → drop the token;
 *        - otherwise refresh `locale`, `name`, `image` and the check stamp.
 *   4. Everything else: hand the token back untouched.
 *
 * "Drop the token" is `null`, which Auth.js turns into a signed-out session.
 */

import type { JWT } from "next-auth/jwt";

import { routing } from "@/lib/i18n/routing";

/** How long a JWT may go without a `sessionVersion` re-read (§4.3: five minutes). */
export const SESSION_RECHECK_MS = 5 * 60_000;

/** What a provider hands the callback on sign-in. */
export interface JwtSignInUser {
  id?: string;
  locale?: "fr" | "en";
  sessionVersion?: number;
}

/** The row the re-check reads. Exactly the four columns, nothing else. */
export interface SessionUserRow {
  sessionVersion: number;
  locale: "fr" | "en" | null;
  name: string | null;
  image: string | null;
}

/**
 * The one query this module makes, as a port rather than `Pick<PrismaClient, 'user'>`.
 *
 * A Prisma delegate is a generic, twenty-method object; typing the dependency
 * as one forces every test to build a twenty-method fake in order to stub a
 * single `findUnique`. The port says what is actually needed, the real client
 * satisfies it structurally, and a test can hand over a two-line object.
 */
export interface SessionUserStore {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { sessionVersion: true; locale: true; name: true; image: true };
    }): PromiseLike<SessionUserRow | null>;
  };
}

export interface RefreshTokenDeps {
  prisma: SessionUserStore;
  now?: () => number;
  recheckMs?: number;
}

export interface RefreshTokenParams {
  token: JWT;
  user?: JwtSignInUser | null;
  /** Present on sign-in only: which provider authenticated this session. */
  account?: { provider?: string } | null;
  trigger?: "signIn" | "signUp" | "update";
}

export async function refreshSessionToken(
  { token, user, account, trigger }: RefreshTokenParams,
  { prisma, now = Date.now, recheckMs = SESSION_RECHECK_MS }: RefreshTokenDeps,
): Promise<JWT | null> {
  if (user) {
    token.id = user.id ?? token.sub;
    token.locale = user.locale;
    token.sessionVersion = user.sessionVersion;
    token.checkedAt = now();
    // When and how this session authenticated: setting a first password on a
    // Google-only account demands a recent Google sign-in (lib/auth/reauth.ts).
    token.authAt = now();
    token.authProvider = account?.provider;
  }

  const id = token.id ?? token.sub;
  if (!id) return null;
  token.id = id;

  const stale = now() - (token.checkedAt ?? 0) > recheckMs;
  const mustCheck = stale || trigger === "update" || token.sessionVersion === undefined;
  if (!mustCheck) return token;

  const row = await prisma.user.findUnique({
    where: { id },
    select: { sessionVersion: true, locale: true, name: true, image: true },
  });

  // The account was deleted while this token was still in a cookie.
  if (!row) return null;

  // `changePasswordAction` bumped the counter: every token still carrying the old
  // number is dropped here — on its periodic re-check AND on `trigger: "update"`.
  // Refusing on update is the point: Auth.js fires `update` from the client too,
  // so adopting the row's number there would let a stolen cookie survive the
  // password change. The device that changed the password is not rescued here;
  // the action wrote it a new cookie (`lib/auth/session-cookie.ts`).
  if (token.sessionVersion !== undefined && row.sessionVersion !== token.sessionVersion) {
    return null;
  }

  token.sessionVersion = row.sessionVersion;
  token.locale = row.locale ?? routing.defaultLocale;
  token.name = row.name;
  token.picture = row.image;
  token.checkedAt = now();
  return token;
}
