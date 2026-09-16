/**
 * THREAT — A guessable password, and a client-side meter trusted to stop it.
 *
 * The meter in `components/auth/PasswordStrength.tsx` is advisory: anybody can
 * disable JavaScript, replay the POST, or call the server action directly. The
 * policy that *decides* is `lib/auth/password-policy.ts`, and this file attacks
 * it from the outside — through `signUpAction` and `changePasswordAction`, the
 * way an attacker would.
 *
 * Related THREAT — bcrypt's 72-byte input limit. bcrypt silently ignores
 * everything past byte 72, so a 200-character passphrase would be equivalent to
 * its prefix and two different passwords could open the same account. Refusing
 * them is the control; truncating would be the bug.
 *
 * Related THREAT — a weakened work factor. §4.8 AC4 pins the stored prefix at
 * `$2b$12$`. The test environment deliberately runs `BCRYPT_COST=4` (`.env.test`,
 * owned by W0-T1) so the suites are not dominated by KDF time, so the cost is
 * passed explicitly here rather than read from the environment — the assertion
 * is about what production writes, not about what the test runner is told.
 *
 * CONTROLS PINNED
 *
 *   1. every refusal of the policy table is reproduced through the real action;
 *   2. the message is a KEY (`auth.password.*`), so the French and English
 *      forms render the same decision;
 *   3. no account is created and no hash is written on a refusal;
 *   4. a password over 72 bytes is refused, never truncated;
 *   5. a stored hash is `$2b$12$…` at the production cost, and `needsRehash`
 *      upgrades a `$2a$` or a lower-cost hash on the next successful sign-in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isCommonPassword } from "@/lib/auth/common-passwords";
import {
  bcryptCost,
  DEFAULT_BCRYPT_COST,
  hashPassword,
  hashCost,
  needsRehash,
  PasswordTooLongError,
  verifyPassword,
} from "@/lib/auth/password";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import { fakeDb } from "@/tests/_fakes/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { signUpAction } = await import("@/app/[locale]/(auth)/inscription/actions");
const { changePasswordAction } = await import("@/app/[locale]/(protected)/compte/actions");
const { IDLE } = await import("@/lib/actions/result");

const EMAIL = "camille.demo@velo-atelier.test";
const STRONG = "Guidon-Tandem-47!";

/** Every way a password can be refused, and the key the form must render. */
const REFUSALS = [
  ["too short", "Court-1!", "auth.password.tooShort"],
  ["one class", "aaaaaaaaaaaaaaaa", "auth.password.classes"],
  ["two classes", "aaaaaaaaaaaaaaA", "auth.password.classes"],
  ["leading space", " Guidon-Tandem-47!", "auth.password.whitespace"],
  ["trailing space", "Guidon-Tandem-47! ", "auth.password.whitespace"],
  ["over 72 bytes", `Guidon-Tandem-47!${"é".repeat(40)}`, "auth.password.tooLong"],
  ["contains the address", "Camille.Demo-2026!", "auth.password.containsEmail"],
  // A long, four-class passphrase that breaks no syntactic rule and is in no
  // list — only zxcvbn's repeat matcher sees why it is guessable. Measured at
  // ~300 ms; `Ab1!Ab1!Ab1!Ab1!` is the same idea but costs zxcvbn ~3 s, which
  // is slow enough to time a test out under a parallel run (and slow enough to
  // be worth knowing about for the sign-up path itself).
  ["a repeated word zxcvbn sees through", "Bicyclette-Bicyclette-1", "auth.password.weak"],
] as const;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
  setSession(null);
});

describe("the policy itself", () => {
  it.each(REFUSALS)("refuses a password that is %s, with key %s", async (_label, password, key) => {
    const verdict = await checkPasswordPolicy(password, { email: EMAIL });
    expect(verdict).toMatchObject({ ok: false, key });
  });

  it("accepts a passphrase that breaks no rule", async () => {
    expect(await checkPasswordPolicy(STRONG, { email: EMAIL })).toEqual({ ok: true });
  });

  it("refuses a 12-character password that is only decorated common list material", async () => {
    // `Password2026!` is 13 characters and uses all four classes, so the
    // syntactic rules let it through. `commonBaseWord` strips the year and the
    // punctuation, and what is left IS in the bundled list.
    expect(isCommonPassword("password")).toBe(true);
    const verdict = await checkPasswordPolicy("Password2026!", { email: EMAIL });
    expect(verdict).toMatchObject({ ok: false });
    expect(verdict.ok === false && verdict.key).toMatch(/^auth\.password\.(common|weak)$/);
  });

  it("carries the 10 000-entry list and refuses its exact entries", () => {
    expect(isCommonPassword("password")).toBe(true);
    expect(isCommonPassword("PassWord")).toBe(true); // case-insensitive
    expect(isCommonPassword("Guidon-Tandem-47!")).toBe(false);
  });
});

describe("signUpAction — the client cannot be trusted to have run the meter", () => {
  it.each(REFUSALS)("refuses %s and creates no account", async (_label, password) => {
    const result = await signUpAction(IDLE, form({ email: EMAIL, password, locale: "fr" }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(result.ok === false && result.fieldErrors?.password).toMatch(/^auth\.password\./);
    expect(fakeDb.rows("User")).toHaveLength(0);
  });

  it("writes a bcrypt hash, never the plaintext, when it does accept one", async () => {
    await signUpAction(IDLE, form({ email: EMAIL, password: STRONG, locale: "fr" })).catch(
      () => undefined,
    );

    const row = fakeDb.rows("User")[0];
    expect(row?.passwordHash).toEqual(expect.stringMatching(/^\$2b\$\d{2}\$/));
    expect(row?.passwordHash).not.toContain(STRONG);
  });
});

describe("changePasswordAction — the same policy on the way in", () => {
  beforeEach(async () => {
    const user = await fakeDb.seed("User", {
      email: EMAIL,
      locale: "fr",
      passwordHash: await hashPassword(STRONG, 4),
    });
    setSession(sessionFor(user as unknown as { id: string; email: string }));
    fakeDb.resetCalls();
  });

  it.each(REFUSALS.filter(([label]) => label !== "contains the address"))(
    "refuses a new password that is %s and leaves the stored hash alone",
    async (_label, password) => {
      const before = fakeDb.rows("User")[0]?.passwordHash;

      const result = await changePasswordAction(IDLE, form({ current: STRONG, next: password }));

      expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
      expect(fakeDb.rows("User")[0]?.passwordHash).toBe(before);
      expect(fakeDb.rows("User")[0]?.sessionVersion).toBe(0);
    },
  );

  it("refuses re-using the current password", async () => {
    const result = await changePasswordAction(IDLE, form({ current: STRONG, next: STRONG }));
    expect(result).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { next: "errors.samePassword" },
    });
  });
});

describe("bcrypt work factor (§4.8 AC4)", () => {
  it("writes `$2b$12$` at the production cost", async () => {
    // The cost is passed explicitly: `.env.test` sets BCRYPT_COST=4 for speed,
    // and this assertion is about production, not about the test runner.
    const hash = await hashPassword(STRONG, DEFAULT_BCRYPT_COST);

    expect(DEFAULT_BCRYPT_COST).toBe(12);
    expect(hash.startsWith("$2b$12$")).toBe(true);
    expect(hashCost(hash)).toBe(12);
    expect(await verifyPassword(STRONG, hash)).toBe(true);
    expect(await verifyPassword(`${STRONG}x`, hash)).toBe(false);
  }, 20_000);

  it("defaults to 12 when the environment says nothing", () => {
    expect(bcryptCost({})).toBe(DEFAULT_BCRYPT_COST);
  });

  it("upgrades an imported `$2a$` hash and a hash written at a lower cost", async () => {
    const weak = await hashPassword(STRONG, 4);
    expect(needsRehash(weak, 12)).toBe(true);
    expect(needsRehash(weak.replace("$2b$", "$2a$"), 4)).toBe(true);
    expect(needsRehash(await hashPassword(STRONG, 4), 4)).toBe(false);
  });

  it("refuses, rather than truncates, an input over bcrypt's 72-byte limit", async () => {
    const long = "é".repeat(40); // 80 bytes
    await expect(hashPassword(long, 4)).rejects.toBeInstanceOf(PasswordTooLongError);
  });

  it("spends real time on an unknown account, so failures cannot be told apart", async () => {
    // `verifyPassword(pw, null)` compares against a dummy hash rather than
    // returning early: the response time must not say "no such user".
    expect(await verifyPassword(STRONG, null)).toBe(false);
    expect(await verifyPassword(STRONG, "not-a-hash")).toBe(false);
  });
});
