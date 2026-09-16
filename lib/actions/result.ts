/**
 * `ActionResult<T>` — what every server action returns (§1.2, §4.4).
 *
 * Server actions never throw for an *expected* failure: a wrong password, a
 * foreign bike id, a quota, a rate limit. They return a discriminated union
 * whose failure arm carries a **message key**, never a sentence. The form then
 * renders `t(code)` in the visitor's locale, which is why the same action
 * works on the French and the English page without a second code path.
 *
 * Two levels of message:
 *
 *   `code`         one of seven, rendered as `errors.<code>` — the headline
 *                  ("Vous n'avez pas accès à cette page.")
 *   `fieldErrors`  per input, the value being a FULLY QUALIFIED key
 *                  (`errors.invalidCredentials`, `auth.password.tooShort`),
 *                  so a field message can come from any namespace. The key
 *                  `form` is the form-level slot, for errors that belong to no
 *                  single input.
 *
 * `retryAfterSec` accompanies `RATE_LIMITED` so the form can say *when* rather
 * than just *no*.
 *
 * Unexpected failures (a database that is down, a bug) are still thrown: they
 * belong to `error.tsx`, not to a field label.
 */

/** The closed set of failure codes. Each one is a key of `messages/<locale>/errors.json`. */
export const ACTION_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "RATE_LIMITED",
  "TOO_MANY",
  "CONFLICT",
] as const;

export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

/**
 * A fully qualified message key (`errors.invalidCredentials`,
 * `auth.password.common`). Not narrowed to the catalogue's key union: the
 * values are chosen at runtime by validation code, and next-intl's typed `t()`
 * is applied at the call site (see `translateMessageKey` below).
 */
export type MessageKey = string;

/** Per-input message keys. `form` is the form-level slot. */
export type FieldErrors = Readonly<Record<string, MessageKey>>;

export interface ActionSuccess<T> {
  ok: true;
  data: T;
}

export interface ActionFailure {
  ok: false;
  code: ActionErrorCode;
  fieldErrors?: FieldErrors;
  /** Present on `RATE_LIMITED`: how long before another attempt is accepted. */
  retryAfterSec?: number;
}

export type ActionResult<T = null> = ActionSuccess<T> | ActionFailure;

/**
 * The shape a `useActionState` form uses.
 *
 * `data` is "has this form succeeded at least once", which is the only thing a
 * form needs to know in order to decide between showing nothing, showing a
 * confirmation, and showing an error. A plain `ActionResult<null>` cannot say
 * it — `{ ok: true, data: null }` is both "not submitted yet" and "saved" —
 * and a form that confirms a save the visitor never made is worse than one that
 * confirms nothing.
 */
export type FormResult = ActionResult<boolean>;

/** Before any submission. */
export const IDLE: FormResult = { ok: true, data: false };

/** After a successful one. */
export const DONE: FormResult = { ok: true, data: true };

export function ok(): ActionResult<null>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | null> {
  return { ok: true, data: data ?? null };
}

export function fail(
  code: ActionErrorCode,
  options: { fieldErrors?: FieldErrors; retryAfterSec?: number } = {},
): ActionFailure {
  const result: ActionFailure = { ok: false, code };
  if (options.fieldErrors && Object.keys(options.fieldErrors).length > 0) {
    result.fieldErrors = options.fieldErrors;
  }
  if (options.retryAfterSec !== undefined) {
    result.retryAfterSec = Math.max(0, Math.ceil(options.retryAfterSec));
  }
  return result;
}

/** `VALIDATION` with one message key per invalid field. */
export function validationFailure(fieldErrors: FieldErrors): ActionFailure {
  return fail("VALIDATION", { fieldErrors });
}

/** `RATE_LIMITED`, with the wait rounded up to whole seconds. */
export function rateLimited(retryAfterMs: number, fieldErrors?: FieldErrors): ActionFailure {
  return fail("RATE_LIMITED", { retryAfterSec: retryAfterMs / 1000, fieldErrors });
}

export function isFailure<T>(result: ActionResult<T>): result is ActionFailure {
  return result.ok === false;
}

/**
 * Flatten a zod 4 `treeifyError` / `flatten`-style field map into `FieldErrors`.
 *
 * Zod issues carry our own message keys (the schemas are built with
 * `{ error: "auth.password.tooShort" }`), so the first issue per field is kept
 * verbatim. A field with several problems shows the first one — the visitor
 * fixes it, resubmits, and sees the next.
 */
export function fieldErrorsFrom(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  fallbackField = "form",
): FieldErrors {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : fallbackField;
    // eslint-disable-next-line security/detect-object-injection -- `field` is a zod path segment, and the object is a fresh literal
    if (errors[field] === undefined) errors[field] = issue.message;
  }
  return errors;
}

/**
 * Render a runtime-chosen message key with a next-intl root translator.
 *
 * next-intl types `t()` against the catalogue, which cannot prove that a key
 * assembled at runtime exists. The cast is confined to this one function, and
 * `tests/unit/i18n/messages-parity.test.ts` plus the action tests (which assert
 * the exact keys) are what actually keep the two in agreement.
 */
export function translateMessageKey(t: (key: never) => string, key: MessageKey): string {
  return (t as unknown as (key: string) => string)(key);
}
