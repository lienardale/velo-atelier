"use server";

/**
 * Account management: profile, password, deletion (§4.3).
 *
 * Every action goes through `withUser()`, so by the time a body runs the
 * request is same-origin and signed in, and `user.id` is the only identity any
 * of them uses — none of them accepts a user id from the form. That is the
 * IDOR control `tests/security/idor.test.ts` asserts by replaying each of these
 * with another user's ids and checking the recorded Prisma calls.
 *
 * ## `sessionVersion`
 *
 * Sessions are JWTs; there is no row to delete when a password changes. So
 * `changePasswordAction` bumps `User.sessionVersion`, then writes **this**
 * device a fresh session cookie carrying the new number
 * (`lib/auth/session-cookie.ts`). Every other device still holds the old
 * number and is signed out the next time its token is re-checked — within five
 * minutes (`SESSION_RECHECK_MS`, `lib/auth/jwt.ts`) or on any `update` call.
 *
 * It does NOT use `unstable_update()` for that: the `jwt` callback refuses a
 * mismatch on `trigger: "update"` too, because Auth.js also fires `update` from
 * the client and a stolen cookie must not be able to adopt the new number.
 *
 * ## Deletion
 *
 * `user.delete()` and nothing else: every owned row cascades from `User`
 * (`onDelete: Cascade` on `Bike`, and from `Bike` down through part states,
 * checkups and build lists), which is what makes "delete my account" a single
 * statement and an assertion `tests/integration/account.test.ts` can make
 * exactly — zero rows anywhere for that id.
 */

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { AuthError } from "@auth/core/errors";
import { cookies } from "next/headers";
import * as z from "zod";

import { signIn, signOut, unstable_update } from "@/auth";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import { hasFreshGoogleAuth } from "@/lib/auth/reauth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  mintSessionToken,
  presentSessionCookie,
  sessionCookieOptions,
  type SessionTokenClaims,
} from "@/lib/auth/session-cookie";
import { rateLimitKey } from "@/lib/auth/tokens";
import { formFields } from "@/lib/actions/form-data";
import { DONE, fail, rateLimited, type FormResult } from "@/lib/actions/result";
import { withUser } from "@/lib/actions/with-user";
import { prisma } from "@/lib/db/prisma";
import { localizedPath } from "@/lib/i18n/protected-paths";
import { routing } from "@/lib/i18n/routing";
import { createPrismaRateLimiter, RATE_LIMITS } from "@/lib/security/rate-limit";

/**
 * The confirmation word, in every locale the site speaks.
 *
 * The dialog shows the visitor's own language, but the server cannot trust a
 * locale that arrived in the same form as the confirmation, so it accepts any
 * of them (or the account's password, which is the stronger proof).
 */
const CONFIRMATION_WORDS = new Set(["SUPPRIMER", "DELETE"]);

const profileSchema = z
  .object({
    name: z.string().trim().max(80, "errors.nameTooLong"),
    locale: z.enum(routing.locales, { error: "errors.localeInvalid" }),
  })
  .strict();

const changePasswordSchema = z
  .object({
    current: z.string().min(1, "errors.passwordRequired"),
    next: z.string().min(1, "errors.passwordRequired"),
  })
  .strict();

const setPasswordSchema = z.object({ next: z.string().min(1, "errors.passwordRequired") }).strict();

const deleteSchema = z.object({ confirmation: z.string().min(1) }).strict();

function firstFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : "form";
    // A schema message is a key we wrote ("errors.nameTooLong"); anything else is
    // zod's own English prose (an unknown key, a wrong type) and must never reach
    // the UI verbatim.
    const key = issue.message.startsWith("errors.") ? issue.message : "errors.VALIDATION";
    // eslint-disable-next-line security/detect-object-injection -- `field` is a zod path segment written into a fresh object
    errors[field] ??= key;
  }
  return errors;
}

/** Name and interface language. The e-mail address is not editable in the MVP. */
export const updateProfileAction = withUser(
  async ({ user }, _previous: FormResult, formData: FormData) => {
    const parsed = profileSchema.safeParse(formFields(formData));
    if (!parsed.success) {
      return fail("VALIDATION", { fieldErrors: firstFieldErrors(parsed.error.issues) });
    }

    const name = parsed.data.name.length > 0 ? parsed.data.name : null;
    await prisma.user.update({
      where: { id: user.id },
      data: { name, locale: parsed.data.locale },
    });

    // The JWT carries `name` and `locale`; refresh it so the header and the
    // next page render the new values without a sign-out.
    await unstable_update({ user: { name, locale: parsed.data.locale } });
    revalidatePath("/[locale]/compte", "page");
    return DONE;
  },
);

/**
 * Replace the session cookie THIS request arrived with by one carrying `claims`.
 *
 * Only called after the current password was verified. Fails closed: with no
 * session cookie on the request or no `AUTH_SECRET`, it writes nothing, and the
 * device is signed out at its next re-check like every other one — never the
 * reverse. Chunk cookies of an oversized previous token are removed so Auth.js
 * cannot splice old chunks onto the new value.
 */
async function reissueSessionCookie(claims: SessionTokenClaims): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return;
  const jar = await cookies();
  const present = presentSessionCookie(jar.getAll().map((cookie) => cookie.name));
  if (!present) return;

  const value = await mintSessionToken(claims, { secret, cookieName: present.name });
  for (const chunk of present.chunks) jar.delete(chunk);
  jar.set(present.name, value, sessionCookieOptions(present.name));
}

/**
 * Change an existing password.
 *
 * `FORBIDDEN` for a Google-only account — there is nothing to change, and the
 * page shows `SetPasswordForm` instead. Rate-limited per user, because this is
 * the one place a stolen-but-locked session could brute-force the current
 * password.
 */
export const changePasswordAction = withUser(
  async ({ user }, _previous: FormResult, formData: FormData) => {
    const parsed = changePasswordSchema.safeParse(formFields(formData));
    if (!parsed.success) {
      return fail("VALIDATION", { fieldErrors: firstFieldErrors(parsed.error.issues) });
    }

    const limiter = createPrismaRateLimiter(prisma);
    const verdict = await limiter.consume(
      rateLimitKey("pwchange", user.id),
      RATE_LIMITS.passwordChangePerUser,
    );
    if (!verdict.ok) {
      return rateLimited(verdict.retryAfterMs, { form: "errors.tooManyAttempts" });
    }

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true, sessionVersion: true },
    });
    if (!row) return fail("NOT_FOUND");
    if (!row.passwordHash) return fail("FORBIDDEN", { fieldErrors: { form: "errors.noPassword" } });

    if (!(await verifyPassword(parsed.data.current, row.passwordHash))) {
      return fail("VALIDATION", { fieldErrors: { current: "errors.wrongPassword" } });
    }
    if (parsed.data.current === parsed.data.next) {
      return fail("VALIDATION", { fieldErrors: { next: "errors.samePassword" } });
    }

    const policy = await checkPasswordPolicy(parsed.data.next, { email: user.email });
    if (!policy.ok) return fail("VALIDATION", { fieldErrors: { next: policy.key } });

    const passwordHash = await hashPassword(parsed.data.next);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, sessionVersion: { increment: 1 } },
      select: { sessionVersion: true, name: true, image: true, locale: true },
    });

    // Keep THIS device signed in: write it a token carrying the new number.
    // Not `unstable_update()` — that is an `update` trigger, and the `jwt` check
    // refuses a mismatch on update so a stolen cookie cannot adopt the new number.
    await reissueSessionCookie({
      id: user.id,
      email: user.email,
      name: updated.name,
      picture: updated.image,
      locale: updated.locale,
      sessionVersion: updated.sessionVersion,
    });
    // No revalidatePath here: a re-render in THIS response would read the old
    // cookie from the request headers (Next updates cookies(), not headers(), after
    // jar.set), re-check it, find the old sessionVersion and bounce the visitor off
    // the page they just saved. Nothing on the page depends on the password; the
    // form shows its own success state (W1 security review, .debug/003).
    return DONE;
  },
);

/**
 * Add a password to a Google-only account.
 *
 * Refuses when one already exists — that path is `changePasswordAction`, which
 * requires the current password. Without this check, a session alone would be
 * enough to overwrite a password.
 */
export const setPasswordAction = withUser(
  async ({ user }, _previous: FormResult, formData: FormData) => {
    const parsed = setPasswordSchema.safeParse(formFields(formData));
    if (!parsed.success) {
      return fail("VALIDATION", { fieldErrors: firstFieldErrors(parsed.error.issues) });
    }

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!row) return fail("NOT_FOUND");
    if (row.passwordHash) {
      return fail("FORBIDDEN", { fieldErrors: { form: "errors.passwordAlreadySet" } });
    }
    // A session alone must not be enough: a stolen cookie could otherwise turn
    // itself into a permanent password the owner cannot revoke (lib/auth/reauth.ts).
    if (!hasFreshGoogleAuth(user)) {
      return fail("FORBIDDEN", { fieldErrors: { form: "errors.reauthRequired" } });
    }

    const policy = await checkPasswordPolicy(parsed.data.next, { email: user.email });
    if (!policy.ok) return fail("VALIDATION", { fieldErrors: { next: policy.key } });

    const passwordHash = await hashPassword(parsed.data.next);
    // Like a password change, adding one signs every OTHER device out (a stolen
    // cookie included) and re-issues this device's cookie with the new number.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, sessionVersion: { increment: 1 } },
      select: { sessionVersion: true, name: true, image: true, locale: true },
    });
    await reissueSessionCookie({
      id: user.id,
      email: user.email,
      name: updated.name,
      picture: updated.image,
      locale: updated.locale,
      sessionVersion: updated.sessionVersion,
    });
    revalidatePath("/[locale]/compte", "page");
    return DONE;
  },
);

/**
 * Delete the account and everything that hangs off it.
 *
 * Confirmation is either the account's password (when it has one) or the
 * confirmation word. On success `signOut()` throws a redirect to the home page,
 * so the `return` below is unreachable in practice and kept for the type.
 */
export const deleteAccountAction = withUser(
  async ({ user }, _previous: FormResult, formData: FormData) => {
    const parsed = deleteSchema.safeParse(formFields(formData));
    if (!parsed.success) {
      return fail("VALIDATION", { fieldErrors: { confirmation: "errors.confirmationMismatch" } });
    }

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!row) return fail("NOT_FOUND");

    const confirmation = parsed.data.confirmation.trim();
    const confirmed = row.passwordHash
      ? await verifyPassword(confirmation, row.passwordHash)
      : CONFIRMATION_WORDS.has(confirmation.toUpperCase());

    if (!confirmed && !CONFIRMATION_WORDS.has(confirmation.toUpperCase())) {
      return fail("VALIDATION", { fieldErrors: { confirmation: "errors.confirmationMismatch" } });
    }

    await prisma.user.delete({ where: { id: user.id } });
    await signOut({ redirectTo: `/${user.locale}` });
    return DONE;
  },
);

/**
 * Re-run Google sign-in (`prompt=login`, so Google asks again rather than reusing
 * its own session) and come back to the account page with a fresh `authAt`.
 */
export const reauthenticateWithGoogleAction = withUser(async ({ user }): Promise<FormResult> => {
  const redirectTo = `/${user.locale}${localizedPath("/compte", user.locale)}`;
  try {
    await signIn("google", { redirectTo }, { prompt: "login" });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuthError) {
      return fail("UNAUTHORIZED", { fieldErrors: { form: "errors.oauthFailed" } });
    }
    throw error;
  }
  return DONE;
});
