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

import { auth } from "@/auth";
import { assertSameOrigin, CrossOriginRequestError } from "@/lib/security/origin";
import type { Locale } from "@/lib/i18n/routing";

import { fail, type ActionResult } from "./result";

/** The caller, as an action sees it. */
export interface ActionUser {
  id: string;
  email: string;
  name: string | null;
  locale: Locale;
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
    },
  };
}

/** The session's user without the origin check — for server components, which are GETs. */
export async function currentUser(): Promise<ActionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  return { id: user.id, email: user.email, name: user.name ?? null, locale: user.locale };
}
