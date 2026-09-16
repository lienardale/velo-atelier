/**
 * The password policy, enforced (§4.3).
 *
 * `import "server-only"` is deliberate and load-bearing: this module pulls in
 * the 10 000-entry common-password list and the four zxcvbn dictionaries
 * (common + English + French, several hundred kilobytes). None of that may ever
 * be bundled for a browser. The sign-up form's live meter uses
 * `lib/auth/password-strength.ts` (dependency-free) plus a dynamically imported
 * zxcvbn, and the client's verdict is only ever advisory — this file is what
 * actually decides, on every sign-up and every password change, whether the
 * client ran at all (§4.8 AC5: "weak password rejected server-side even when
 * the client is bypassed").
 *
 * Order of the rules is the order of usefulness to the person typing:
 *
 *   1. the four syntactic rules (`lib/auth/password-strength.ts`) — actionable,
 *      free, and they make the later messages coherent (a 6-character password
 *      is "too short", never "too common");
 *   2. the vendored common list — exact, case-insensitive;
 *   3. zxcvbn score ≥ 3, with the e-mail's local part as a user input so
 *      `camille2026!!` is scored as the near-miss it is.
 *
 * Everything returns a **message key** (`auth.password.*`); nothing here
 * returns a sentence.
 */

import "server-only";

import * as z from "zod";

import { isCommonPassword } from "./common-passwords";
import {
  PASSWORD_MIN_SCORE,
  passwordIssueKey,
  syntacticIssues,
  type PasswordContext,
  type PasswordIssue,
  type PasswordIssueKey,
} from "./password-strength";
import { emailLocalPart } from "./tokens";

export type { PasswordIssue, PasswordIssueKey };

/**
 * The zxcvbn engine, built once per process.
 *
 * Construction loads four dictionaries and the adjacency graphs; doing it per
 * request would add tens of milliseconds to every sign-up. It is built lazily
 * rather than at import so that a module that only needs `syntacticIssues`
 * (and a test that mocks the checker) never pays for it.
 *
 * Verified against @zxcvbn-ts/core 4.2.0: `new ZxcvbnFactory(options).check(
 * password, userInputs)` is synchronous and returns `{ score: 0 | 1 | 2 | 3 | 4, … }`.
 */
let checker: ((password: string, userInputs: string[]) => number) | undefined;

async function zxcvbnScore(password: string, userInputs: string[]): Promise<number> {
  if (!checker) {
    const [{ ZxcvbnFactory }, common, en, fr] = await Promise.all([
      import("@zxcvbn-ts/core"),
      import("@zxcvbn-ts/language-common"),
      import("@zxcvbn-ts/language-en"),
      import("@zxcvbn-ts/language-fr"),
    ]);
    const factory = new ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...en.dictionary, ...fr.dictionary },
      graphs: common.adjacencyGraphs,
      translations: en.translations,
      useLevenshteinDistance: true,
    });
    checker = (value, inputs) => factory.check(value, inputs).score;
  }
  return checker(password, userInputs);
}

/** Test seam: drop the memoised engine (and any injected one). */
export function resetPasswordChecker(
  next?: (password: string, userInputs: string[]) => number,
): void {
  checker = next;
}

/**
 * The "word + year + punctuation" a password is built around.
 *
 * `Password2026!` → `password`, `Motdepasse-99` → `motdepasse`,
 * `Guidon-Tandem-47!` → `guidon-tandem` (an interior hyphen is part of the
 * phrase, not decoration).
 *
 * **Why this exists.** Measured on the vendored SecLists top-10k: only 10 of its
 * 9 999 entries are 12 characters or longer, and every one of those is a single
 * lower-case word — so the length and character-class rules refuse all of them
 * first, and a plain membership test on the password itself can never fire. The
 * rule as written would be dead code that *looks* like a control. Stripping the
 * decoration puts the list back to work on the shape people actually use when a
 * form asks for twelve characters and three classes.
 *
 * Only leading and trailing runs are stripped, and only once: an interior word
 * is left alone, so `chaine-velo-2026` does not collapse to `chaine`.
 */
export function commonBaseWord(password: string): string {
  return password
    .toLowerCase()
    .replace(/^[^\p{L}\p{Nd}]+|[^\p{L}\p{Nd}]+$/gu, "")
    .replace(/\p{Nd}+$/u, "")
    .replace(/[^\p{L}\p{Nd}]+$/u, "");
}

export type PolicyVerdict =
  { ok: true } | { ok: false; issue: PasswordIssue; key: PasswordIssueKey };

function refuse(issue: PasswordIssue): PolicyVerdict {
  return { ok: false, issue, key: passwordIssueKey(issue) };
}

/**
 * Run the full policy. Returns the FIRST rule broken, not all of them: a form
 * that lists five complaints at once is read as noise and fixed one round-trip
 * at a time anyway.
 */
export async function checkPasswordPolicy(
  password: string,
  context: PasswordContext = {},
): Promise<PolicyVerdict> {
  const [syntactic] = syntacticIssues(password, context);
  if (syntactic) return refuse(syntactic);

  if (isCommonPassword(password) || isCommonPassword(commonBaseWord(password))) {
    return refuse("common");
  }

  const userInputs = context.email
    ? [context.email, emailLocalPart(context.email), "velo", "atelier", "velo-atelier"]
    : ["velo", "atelier", "velo-atelier"];

  const score = await zxcvbnScore(password, userInputs);
  if (score < PASSWORD_MIN_SCORE) return refuse("weak");

  return { ok: true };
}

/**
 * The policy as a zod schema, for the sign-up and change-password inputs.
 *
 * Async because zxcvbn's factory is imported lazily — callers use
 * `await schema.safeParseAsync(...)`. Issues carry the message key as their
 * `message`, which `fieldErrorsFrom()` (lib/actions/result.ts) lifts straight
 * into `ActionResult.fieldErrors`.
 */
export function passwordSchema(context: PasswordContext = {}) {
  return z.string().superRefine(async (password, ctx) => {
    const verdict = await checkPasswordPolicy(password, context);
    if (!verdict.ok) ctx.addIssue({ code: "custom", message: verdict.key });
  });
}
