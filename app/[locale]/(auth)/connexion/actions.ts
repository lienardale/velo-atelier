"use server";

/**
 * Sign-in, Google sign-in and sign-out (§4.3).
 *
 * ## Why these are so defensive about `signIn()`
 *
 * `signIn()` called from a server action does not return on success — it throws
 * a `NEXT_REDIRECT`. So every call sits in a `try`, and the very first thing the
 * `catch` does is `unstable_rethrow(error)`, which re-throws Next's own control
 * flow (redirects, `notFound()`) untouched. Swallowing it would leave the
 * visitor on the login page with a valid session and no explanation.
 *
 * ## Why every failure says the same thing
 *
 * An unknown address and a wrong password both return
 * `errors.invalidCredentials`, through the same branch, at the same cost
 * (`authorizeCredentials` runs a real bcrypt compare either way). That is the
 * anti-enumeration control `tests/e2e/auth-login.spec.ts` asserts. The single
 * exception is a full rate-limit bucket, which reports how long to wait —
 * information the account's owner needs and an attacker already has.
 */

// Imported from @auth/core (the class next-auth re-exports) so this module can
// be loaded in a Node test without dragging in `next-auth/lib/env`.
import { AuthError } from "@auth/core/errors";
import { unstable_rethrow } from "next/navigation";
import * as z from "zod";

import { signIn, signOut } from "@/auth";
import { LOCALE_COOKIE } from "@/auth.config";
import { signInFailure } from "@/lib/auth/errors";
import { safeCallbackUrl } from "@/lib/auth/safe-callback-url";
import { formFields } from "@/lib/actions/form-data";
import { DONE, fail, type FormResult } from "@/lib/actions/result";
import { guardSameOrigin } from "@/lib/actions/with-user";
import { routing, isLocale, type Locale } from "@/lib/i18n/routing";

/**
 * `.strict()`: an unexpected field is a rejected submission, not a silently
 * ignored one (§4.7 `mass-assignment`). The form posts exactly these four.
 */
const loginSchema = z
  .object({
    email: z.string().trim().min(1, "errors.emailRequired").max(254, "errors.emailInvalid"),
    password: z.string().min(1, "errors.passwordRequired"),
    callbackUrl: z.string().optional(),
    locale: z.string().optional(),
  })
  .strict();

/** The locale the form was rendered in; anything else falls back to French. */
function formLocale(value: unknown): Locale {
  return isLocale(value) ? value : routing.defaultLocale;
}

export async function loginAction(_previous: FormResult, formData: FormData): Promise<FormResult> {
  const crossOrigin = await guardSameOrigin();
  if (crossOrigin) return crossOrigin;

  const parsed = loginSchema.safeParse(formFields(formData));
  if (!parsed.success) {
    // Both fields are required and nothing else is accepted; a failure here is
    // an empty form or a tampered payload, and neither deserves a per-field
    // breakdown that would also confirm which address exists.
    return fail("VALIDATION", { fieldErrors: { form: "errors.invalidCredentials" } });
  }

  const locale = formLocale(parsed.data.locale);
  const redirectTo = safeCallbackUrl(parsed.data.callbackUrl, locale);

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo,
    });
  } catch (error) {
    // A successful sign-in leaves through here as a NEXT_REDIRECT.
    unstable_rethrow(error);

    const failure = signInFailure(error);
    if (!failure) throw error;

    if (failure.code === "RATE_LIMITED") {
      return fail("RATE_LIMITED", {
        fieldErrors: { form: failure.messageKey },
        retryAfterSec: failure.retryAfterSec ?? 60,
      });
    }
    return fail("UNAUTHORIZED", { fieldErrors: { form: failure.messageKey } });
  }

  // `signIn` always redirects on success; reaching this line means Auth.js
  // changed its contract, and a silent success would be worse than a message.
  return fail("UNAUTHORIZED", { fieldErrors: { form: "errors.authFailed" } });
}

/**
 * Start the Google round trip.
 *
 * The `NEXT_LOCALE` cookie is written first: the callback comes back through
 * `/api/auth/callback/google`, which carries no locale at all, and both the
 * `signIn` callback (for an unverified address) and the `createUser` event (for
 * a brand-new account) read that cookie to decide which language the visitor
 * was in.
 */
export async function googleSignInAction(
  _previous: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const crossOrigin = await guardSameOrigin();
  if (crossOrigin) return crossOrigin;

  const locale = formLocale(formData.get("locale"));
  const redirectTo = safeCallbackUrl(formData.get("callbackUrl"), locale);

  const { cookies } = await import("next/headers");
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 365 * 24 * 3600,
  });

  try {
    await signIn("google", { redirectTo });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuthError) {
      return fail("UNAUTHORIZED", { fieldErrors: { form: "errors.oauthFailed" } });
    }
    throw error;
  }
  return DONE;
}

/** Sign out and land on the home page of the locale the visitor is browsing in. */
export async function signOutAction(
  _previous: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const crossOrigin = await guardSameOrigin();
  if (crossOrigin) return crossOrigin;

  const locale = formLocale(formData.get("locale"));
  await signOut({ redirectTo: `/${locale}` });
  return DONE;
}
