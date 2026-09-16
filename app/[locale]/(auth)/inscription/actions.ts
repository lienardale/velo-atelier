"use server";

/**
 * Account creation (§4.3).
 *
 * ## Enumeration is accepted here, deliberately
 *
 * A sign-up form that answers "this address is already registered" tells an
 * attacker whether an address has an account. The alternative — always claiming
 * success and sending a "you already have an account" e-mail — needs a mailer,
 * and e-mail is explicitly out of scope for the MVP (§"Decisions", password
 * reset). So the honest message stays, the risk is written down here and in
 * `docs/backlog.md`, and the mitigation is the `signup:<ip>` bucket below:
 * five attempts an hour is not a workable oracle.
 *
 * The **login** form has no such leak — that is the one that matters, and
 * `tests/e2e/auth-login.spec.ts` pins it.
 *
 * ## Order of operations
 *
 * origin → rate limit → shape → password policy → hash → insert → sign in.
 *
 * The policy runs on the server whatever the client did: `tests/e2e/auth-signup.spec.ts`
 * submits a weak password with the client-side check bypassed and expects a
 * server-side refusal (§4.8 AC5). `signIn()` is called **outside** the try that
 * wraps the insert, because it signals success by throwing a redirect and that
 * must not be mistaken for a failed insert.
 */

import { unstable_rethrow } from "next/navigation";
import * as z from "zod";

import { signIn } from "@/auth";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import { hashPassword } from "@/lib/auth/password";
import { safeCallbackUrl } from "@/lib/auth/safe-callback-url";
import { normalizeEmail, rateLimitKey } from "@/lib/auth/tokens";
import { formFields } from "@/lib/actions/form-data";
import { fail, rateLimited, type FormResult } from "@/lib/actions/result";
import { guardSameOrigin } from "@/lib/actions/with-user";
import { isUniqueViolation } from "@/lib/db/errors";
import { prisma } from "@/lib/db/prisma";
import { isLocale, routing, type Locale } from "@/lib/i18n/routing";
import { LOCAL_CLIENT_IP, requestClientIp } from "@/lib/security/ip";
import {
  allowAllRateLimiter,
  createPrismaRateLimiter,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

const signUpSchema = z
  .object({
    email: z.email("errors.emailInvalid").max(254, "errors.emailInvalid"),
    password: z.string().min(1, "errors.passwordRequired"),
    name: z.string().trim().max(80, "errors.nameTooLong").optional(),
    locale: z.enum(routing.locales).optional(),
    callbackUrl: z.string().optional(),
  })
  .strict();

function formLocale(value: unknown): Locale {
  return isLocale(value) ? value : routing.defaultLocale;
}

/** Inputs the sign-up form actually draws; anything else reports form-level. */
const RENDERED_FIELDS = new Set(["email", "password", "name"]);

export async function signUpAction(_previous: FormResult, formData: FormData): Promise<FormResult> {
  const crossOrigin = await guardSameOrigin();
  if (crossOrigin) return crossOrigin;

  const ip = await requestClientIp();
  // Same rule as login (`lib/auth/authorize.ts`): a loopback request with no proxy
  // header is a developer on `next dev`, who should not be locked out of their own
  // sign-up form after five tries. Production keeps the limit (and on Vercel
  // `x-vercel-forwarded-for` is always set, so `ip` is never the sentinel there).
  // The e2e suite runs `next start` (NODE_ENV=production) and isolates itself with
  // a per-test `x-real-ip` instead — see tests/e2e/_fixtures.ts.
  const limiter =
    ip === LOCAL_CLIENT_IP && process.env.NODE_ENV !== "production"
      ? allowAllRateLimiter
      : createPrismaRateLimiter(prisma);
  const verdict = await limiter.consume(rateLimitKey("signup", ip), RATE_LIMITS.signupPerIp);
  if (!verdict.ok) {
    return rateLimited(verdict.retryAfterMs, { form: "errors.tooManyAttempts" });
  }

  const parsed = signUpSchema.safeParse(formFields(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.length > 0 ? String(issue.path[0]) : "form";
      // A `.strict()` rejection names the unknown key: report it as a
      // form-level problem rather than labelling an input nobody rendered.
      const slot = RENDERED_FIELDS.has(field) ? field : "form";
      // eslint-disable-next-line security/detect-object-injection -- `slot` is one of four literals
      fieldErrors[slot] ??= issue.message || "errors.VALIDATION";
    }
    return fail("VALIDATION", { fieldErrors });
  }

  const email = normalizeEmail(parsed.data.email);
  const locale = formLocale(parsed.data.locale);

  const policy = await checkPasswordPolicy(parsed.data.password, { email });
  if (!policy.ok) return fail("VALIDATION", { fieldErrors: { password: policy.key } });

  const passwordHash = await hashPassword(parsed.data.password);

  try {
    await prisma.user.create({
      data: {
        email,
        name: parsed.data.name && parsed.data.name.length > 0 ? parsed.data.name : null,
        passwordHash,
        locale,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error, "email")) {
      return fail("CONFLICT", { fieldErrors: { email: "errors.emailTaken" } });
    }
    throw error;
  }

  // Outside the try: success is a thrown NEXT_REDIRECT.
  const redirectTo = safeCallbackUrl(parsed.data.callbackUrl, locale);
  try {
    await signIn("credentials", { email, password: parsed.data.password, redirectTo });
  } catch (error) {
    unstable_rethrow(error);
    // The account exists; only the automatic sign-in failed. Send them to the
    // login form rather than leaving them on a sign-up page that now cannot
    // succeed.
    return fail("UNAUTHORIZED", { fieldErrors: { form: "errors.authFailed" } });
  }

  return fail("UNAUTHORIZED", { fieldErrors: { form: "errors.authFailed" } });
}
