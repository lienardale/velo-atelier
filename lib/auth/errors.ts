/**
 * Sign-in failures, and how they reach a form (§4.3).
 *
 * Auth.js has two ways of telling us a credentials sign-in failed, and a server
 * action has to cope with both:
 *
 *   - `signIn()` called from a server action **throws**. The thrown value is an
 *     `AuthError`; for credentials it is a `CredentialsSignin`, whose `code`
 *     is whatever `authorize()` threw. Auth.js may also wrap the original in
 *     `error.cause.err`, so the walk below looks there too.
 *   - the hosted sign-in page redirects to `pages.error` with `?error=<Type>`
 *     (`CredentialsSignin`, `OAuthAccountNotLinked`, `AccessDenied`, …). The
 *     login page maps that query parameter to the same message keys.
 *
 * Everything funnels into two outcomes for the visitor:
 *
 *   UNAUTHORIZED + `errors.invalidCredentials` — an unknown e-mail and a wrong
 *   password produce **exactly** the same message and the same code path. That
 *   is not politeness, it is the anti-enumeration control asserted by
 *   `tests/e2e/auth-login.spec.ts` (§4.8 AC5).
 *
 *   RATE_LIMITED + `retryAfterSec` — the only failure allowed to say more,
 *   because "try again in 12 minutes" is information the legitimate owner needs
 *   and an attacker already has.
 */

// `@auth/core/errors` rather than `next-auth`: the latter's barrel pulls in
// `next-auth/lib/env`, which imports `next/server` and cannot be loaded in a
// plain Node test. `next-auth` re-exports this exact class from here, so
// `instanceof` still matches what `signIn()` throws.
import { CredentialsSignin } from "@auth/core/errors";

/** The `code` carried by a rate-limited credentials attempt. */
export const RATE_LIMITED_CODE = "rate_limited";

/**
 * Thrown by `authorizeCredentials` when a bucket is full.
 *
 * Extends `CredentialsSignin` so Auth.js treats it as a normal failed sign-in
 * (`?error=CredentialsSignin&code=rate_limited` on the hosted page) while the
 * server action reads `retryAfterSec` straight off the instance.
 */
export class RateLimitedSignin extends CredentialsSignin {
  code = RATE_LIMITED_CODE;
  readonly retryAfterSec: number;

  constructor(retryAfterMs: number) {
    super("Too many sign-in attempts");
    this.retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  }
}

export interface SignInFailure {
  code: "UNAUTHORIZED" | "RATE_LIMITED";
  /** A fully-qualified message key for the form-level slot. */
  messageKey: string;
  retryAfterSec?: number;
}

const INVALID_CREDENTIALS: SignInFailure = {
  code: "UNAUTHORIZED",
  messageKey: "errors.invalidCredentials",
};

/** Follow `cause.err` one link at a time; Auth.js nests at most once, the loop is the belt. */
function* errorChain(error: unknown): Generator<unknown> {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    yield current;
    current = (current as { cause?: { err?: unknown } }).cause?.err;
  }
}

/**
 * Classify whatever `signIn('credentials', …)` threw.
 *
 * Returns `null` when the error is not a sign-in failure at all (a redirect, a
 * bug) — the caller must rethrow those.
 */
export function signInFailure(error: unknown): SignInFailure | null {
  for (const link of errorChain(error)) {
    if (link instanceof RateLimitedSignin) {
      return {
        code: "RATE_LIMITED",
        messageKey: "errors.tooManyAttempts",
        retryAfterSec: link.retryAfterSec,
      };
    }
    const code = (link as { code?: unknown }).code;
    if (code === RATE_LIMITED_CODE) {
      const retryAfterSec = (link as { retryAfterSec?: unknown }).retryAfterSec;
      return {
        code: "RATE_LIMITED",
        messageKey: "errors.tooManyAttempts",
        retryAfterSec: typeof retryAfterSec === "number" ? retryAfterSec : undefined,
      };
    }
    if (link instanceof CredentialsSignin) return INVALID_CREDENTIALS;
    const type = (link as { type?: unknown }).type;
    if (typeof type === "string" && AUTH_ERROR_KEYS.has(type)) return INVALID_CREDENTIALS;
  }
  return null;
}

/**
 * `?error=` values Auth.js puts on `pages.error` (= the login page), mapped to
 * the message the visitor should read.
 *
 * `OAuthAccountNotLinked` is the one the `signIn` callback produces on its own
 * for a Google profile whose e-mail is not verified (§4.3): "this Google
 * account cannot be linked", not "wrong password".
 */
export const AUTH_ERROR_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  CredentialsSignin: "errors.invalidCredentials",
  OAuthAccountNotLinked: "errors.oauthAccountNotLinked",
  AccessDenied: "errors.accessDenied",
  OAuthCallbackError: "errors.oauthFailed",
  OAuthSignInError: "errors.oauthFailed",
  Configuration: "errors.authConfiguration",
  Verification: "errors.authConfiguration",
  SessionRequired: "errors.UNAUTHORIZED",
};

const AUTH_ERROR_KEYS = new Set(Object.keys(AUTH_ERROR_MESSAGE_KEYS));

/** The message key for an `?error=` query value; a generic one for anything unrecognised. */
export function authErrorMessageKey(error: string | undefined | null): string | undefined {
  if (!error) return undefined;
  // eslint-disable-next-line security/detect-object-injection -- membership is checked against a frozen literal map
  return AUTH_ERROR_MESSAGE_KEYS[error] ?? "errors.authFailed";
}
