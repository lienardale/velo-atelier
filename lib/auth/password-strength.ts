/**
 * The password rules that can run anywhere (§4.3).
 *
 * This module is **isomorphic on purpose**: the sign-up form imports it to
 * draw the live meter, and `lib/auth/password-policy.ts` imports it to enforce
 * the same rules on the server. One list of rules, one set of message keys, no
 * way for the two sides to disagree about what "too short" means.
 *
 * It therefore has **no dependencies at all** — not `zod`, not `bcryptjs`, not
 * the 10 000-entry common-password list. Everything here is a few string
 * operations, so it costs the client bundle almost nothing; the expensive
 * checks (the common list, zxcvbn) live behind the server module and behind a
 * dynamic import in the meter.
 *
 * The four rules, in the order a visitor meets them:
 *
 *   1. ≥ 12 characters                      `auth.password.tooShort`
 *   2. ≤ 72 **bytes** (bcrypt's own limit)   `auth.password.tooLong`
 *   3. ≥ 3 of 4 character classes            `auth.password.classes`
 *   4. not built from the e-mail address     `auth.password.containsEmail`
 *
 * plus one hygiene rule — no leading or trailing whitespace
 * (`auth.password.whitespace`), because it is invisible, it survives a copy and
 * paste, and it makes a password impossible to retype.
 *
 * `auth.password.common` and `auth.password.weak` are decided server-side and
 * by the dynamically-imported meter; they are declared here so every key of the
 * `auth.password.*` family lives in one union.
 */

/** Minimum length, in characters (not bytes). */
export const PASSWORD_MIN_LENGTH = 12;

/** bcrypt reads at most 72 bytes of its input; anything longer is its own prefix. */
export const PASSWORD_MAX_BYTES = 72;

/** How many of the four character classes a password must use. */
export const PASSWORD_MIN_CLASSES = 3;

/** The zxcvbn score (0–4) below which a password is refused. */
export const PASSWORD_MIN_SCORE = 3;

export const PASSWORD_ISSUES = [
  "tooShort",
  "tooLong",
  "classes",
  "whitespace",
  "containsEmail",
  "common",
  "weak",
] as const;

export type PasswordIssue = (typeof PASSWORD_ISSUES)[number];

/** The message key a `PasswordIssue` renders as. */
export type PasswordIssueKey = `auth.password.${PasswordIssue}`;

export function passwordIssueKey(issue: PasswordIssue): PasswordIssueKey {
  return `auth.password.${issue}`;
}

export const CHARACTER_CLASSES = ["lower", "upper", "digit", "symbol"] as const;

export type CharacterClass = (typeof CHARACTER_CLASSES)[number];

/**
 * Which classes a password uses.
 *
 * "Symbol" is *anything that is not a letter or a digit* — a space, an accent
 * placed alone, an emoji. Restricting it to a fixed punctuation list would
 * punish `mot de passe très sûr`, which is a perfectly good passphrase.
 */
export function characterClassesOf(password: string): CharacterClass[] {
  const classes: CharacterClass[] = [];
  if (/\p{Ll}/u.test(password)) classes.push("lower");
  if (/\p{Lu}/u.test(password)) classes.push("upper");
  if (/\p{Nd}/u.test(password)) classes.push("digit");
  if (/[^\p{L}\p{Nd}]/u.test(password)) classes.push("symbol");
  return classes;
}

/** Length as bcrypt counts it. */
export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

/**
 * Does the password reuse the e-mail address?
 *
 * The local part (`camille.demo` of `camille.demo@example.test`) and the
 * address itself are both checked, case-insensitively, as a substring — a
 * password that *contains* the account name is as guessable as one that equals
 * it. Local parts shorter than four characters are ignored: refusing every
 * password containing `bob` would be noise, not security.
 */
export function containsEmail(password: string, email: string | undefined): boolean {
  if (!email) return false;
  const lowered = password.toLowerCase();
  const address = email.trim().toLowerCase();
  if (address.length >= 4 && lowered.includes(address)) return true;
  const local = address.split("@")[0] ?? "";
  return local.length >= 4 && lowered.includes(local);
}

export interface PasswordContext {
  /** The address being signed up / the account's address, for rule 4. */
  email?: string;
}

/**
 * Every syntactic rule the password breaks, in display order.
 *
 * Returns `[]` for an acceptable password. `common` and `weak` are never
 * produced here — they need data this module deliberately does not carry.
 */
export function syntacticIssues(
  password: string,
  { email }: PasswordContext = {},
): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) issues.push("tooShort");
  if (passwordByteLength(password) > PASSWORD_MAX_BYTES) issues.push("tooLong");
  if (characterClassesOf(password).length < PASSWORD_MIN_CLASSES) issues.push("classes");
  // eslint-disable-next-line security/detect-possible-timing-attacks -- comparing a value with its own trimmed form; there is no secret on either side
  if (password !== password.trim()) issues.push("whitespace");
  if (containsEmail(password, email)) issues.push("containsEmail");
  return issues;
}

/** The four rules as a checklist, for the live meter. */
export interface PasswordRuleState {
  id: "length" | "classes" | "whitespace" | "email";
  satisfied: boolean;
}

export function passwordRuleStates(
  password: string,
  { email }: PasswordContext = {},
): PasswordRuleState[] {
  const bytes = passwordByteLength(password);
  return [
    {
      id: "length",
      satisfied: password.length >= PASSWORD_MIN_LENGTH && bytes <= PASSWORD_MAX_BYTES,
    },
    { id: "classes", satisfied: characterClassesOf(password).length >= PASSWORD_MIN_CLASSES },
    { id: "whitespace", satisfied: password.length > 0 && password === password.trim() },
    { id: "email", satisfied: !containsEmail(password, email) },
  ];
}
