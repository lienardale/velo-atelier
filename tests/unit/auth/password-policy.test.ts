/**
 * The password policy (§4.3, §4.8 AC4).
 *
 * Two layers are tested separately because they fail differently:
 *
 *   `lib/auth/password-strength.ts`  the four syntactic rules — pure, isomorphic,
 *                                    and the module the sign-up meter shares;
 *   `lib/auth/password-policy.ts`    those rules plus the vendored common list
 *                                    and zxcvbn, behind `server-only`.
 *
 * The ORDER of the rules is asserted, not just their outcome: a six-character
 * password must be reported "too short", never "too common", or the visitor
 * lengthens it and is told something unrelated.
 *
 * zxcvbn is exercised for real once (it is the whole point of the `weak` rule)
 * and injected for the rest, because building its four dictionaries costs more
 * than every other test in this file put together.
 */
import { afterEach, describe, expect, it } from "vitest";

import { isCommonPassword } from "@/lib/auth/common-passwords";
import {
  checkPasswordPolicy,
  commonBaseWord,
  resetPasswordChecker,
} from "@/lib/auth/password-policy";
import {
  characterClassesOf,
  containsEmail,
  PASSWORD_MAX_BYTES,
  passwordByteLength,
  passwordIssueKey,
  passwordRuleStates,
  syntacticIssues,
} from "@/lib/auth/password-strength";

afterEach(() => resetPasswordChecker());

/** A password that passes every rule, so a test can vary exactly one thing. */
const STRONG = "Guidon-Tandem-47!";

describe("characterClassesOf", () => {
  it.each([
    ["abcdef", ["lower"]],
    ["ABCDEF", ["upper"]],
    ["123456", ["digit"]],
    ["!!!###", ["symbol"]],
    ["Abc123", ["lower", "upper", "digit"]],
    ["Abc-123", ["lower", "upper", "digit", "symbol"]],
    // A space and an accented capital are a symbol and an upper-case letter.
    ["Été ensoleillé", ["lower", "upper", "symbol"]],
  ])("%s uses %j", (password, expected) => {
    expect(characterClassesOf(password)).toEqual(expected);
  });
});

describe("passwordByteLength", () => {
  it("counts bytes, not characters — bcrypt's limit is in bytes", () => {
    expect(passwordByteLength("abc")).toBe(3);
    // Each `é` is two bytes in UTF-8.
    expect(passwordByteLength("ééé")).toBe(6);
    expect(passwordByteLength("🚲")).toBe(4);
  });
});

describe("containsEmail", () => {
  it("catches the address and its local part, case-insensitively", () => {
    expect(containsEmail("Camille2026!!", "camille@velo.test")).toBe(true);
    expect(containsEmail("xCAMILLE@VELO.TESTx", "camille@velo.test")).toBe(true);
    expect(containsEmail("Guidon-Tandem-47!", "camille@velo.test")).toBe(false);
  });

  it("ignores a local part too short to mean anything", () => {
    // Refusing every password containing "bob" would be noise, not security.
    expect(containsEmail("bobsleigh-Tandem-47!", "bob@velo.test")).toBe(false);
  });

  it("is false when there is no address to compare against", () => {
    expect(containsEmail("anything", undefined)).toBe(false);
  });
});

describe("syntacticIssues", () => {
  it("accepts a password that satisfies every rule", () => {
    expect(syntacticIssues(STRONG, { email: "camille@velo.test" })).toEqual([]);
  });

  it.each([
    ["Court-1!", "tooShort"],
    ["a".repeat(PASSWORD_MAX_BYTES + 1), "tooLong"],
    ["motdepassesecret", "classes"],
    [" Guidon-Tandem-47! ", "whitespace"],
  ] as const)("%s → %s", (password, issue) => {
    expect(syntacticIssues(password)).toContain(issue);
  });

  it("counts bytes for the upper bound, so 72 accented characters are too long", () => {
    // 40 `é` = 80 bytes but only 40 characters: a character count would pass it,
    // and bcrypt would silently truncate.
    const accented = `Aa1-${"é".repeat(40)}`;
    expect(passwordByteLength(accented)).toBeGreaterThan(PASSWORD_MAX_BYTES);
    expect(syntacticIssues(accented)).toContain("tooLong");
  });

  it("reports the email rule only when an address is supplied", () => {
    expect(syntacticIssues("Camille-Demo-2026!", { email: "camille@velo.test" })).toEqual([
      "containsEmail",
    ]);
    expect(syntacticIssues("Camille-Demo-2026!")).toEqual([]);
  });
});

describe("passwordRuleStates", () => {
  it("is all-satisfied for a good password", () => {
    expect(passwordRuleStates(STRONG, { email: "camille@velo.test" })).toEqual([
      { id: "length", satisfied: true },
      { id: "classes", satisfied: true },
      { id: "whitespace", satisfied: true },
      { id: "email", satisfied: true },
    ]);
  });

  it("does not claim the whitespace rule is met by an empty field", () => {
    const empty = passwordRuleStates("");
    expect(empty.find((rule) => rule.id === "whitespace")?.satisfied).toBe(false);
    expect(empty.find((rule) => rule.id === "length")?.satisfied).toBe(false);
  });
});

describe("passwordIssueKey", () => {
  it("qualifies the issue into the auth namespace", () => {
    expect(passwordIssueKey("tooShort")).toBe("auth.password.tooShort");
    expect(passwordIssueKey("weak")).toBe("auth.password.weak");
  });
});

describe("the vendored common-password list", () => {
  it("contains the passwords everyone tries, case-insensitively", () => {
    expect(isCommonPassword("password")).toBe(true);
    expect(isCommonPassword("PASSWORD")).toBe(true);
    expect(isCommonPassword("qwerty")).toBe(true);
  });

  it("does not contain a password nobody has used", () => {
    expect(isCommonPassword(STRONG)).toBe(false);
  });
});

describe("checkPasswordPolicy", () => {
  it("refuses a password built from the site's own name (real zxcvbn)", async () => {
    // `velo`, `atelier` and `velo-atelier` are fed to zxcvbn as user inputs, so
    // the most obvious password anyone would try here scores 0.
    await expect(checkPasswordPolicy("Velo-Atelier1")).resolves.toMatchObject({ issue: "weak" });
  });

  it("accepts a strong password (real zxcvbn)", async () => {
    await expect(checkPasswordPolicy(STRONG, { email: "camille@velo.test" })).resolves.toEqual({
      ok: true,
    });
  }, 20_000); // real zxcvbn, same lazy dictionary load as below

  it("refuses a password zxcvbn can guess (real zxcvbn)", async () => {
    // 12 characters, three classes, base word absent from the list — the only
    // rule left to catch it is the score, and it must. (`Aa1!` three times over
    // scores 0: zxcvbn sees the repeat, the length rule does not.)
    const verdict = await checkPasswordPolicy("Aa1!Aa1!Aa1!");
    expect(verdict).toEqual({ ok: false, issue: "weak", key: "auth.password.weak" });
  }, 20_000); // real zxcvbn loads its dictionaries lazily: seconds under full-suite coverage load

  describe("rule order", () => {
    // The syntactic rules come first, so the injected scorer never runs for
    // these — which is exactly the property under test.
    const table = [
      ["too short before anything else", "Aa1-x", "tooShort"],
      ["too long before the score", `Aa1-${"é".repeat(40)}`, "tooLong"],
      ["not enough classes", "motdepassesecret", "classes"],
      ["surrounding whitespace", ` ${STRONG} `, "whitespace"],
      ["built from the address", "camille-velo-2026", "containsEmail"],
    ] as const;

    it.each(table)("%s", async (_label, password, issue) => {
      resetPasswordChecker(() => 4);
      const verdict = await checkPasswordPolicy(password, { email: "camille@velo.test" });
      expect(verdict).toEqual({ ok: false, issue, key: `auth.password.${issue}` });
    });

    it("reports a short common password as too short, never as too common", async () => {
      resetPasswordChecker(() => 4);
      expect(isCommonPassword("password")).toBe(true);
      const verdict = await checkPasswordPolicy("password");
      expect(verdict).toMatchObject({ issue: "tooShort" });
    });
  });

  describe("commonBaseWord", () => {
    it.each([
      ["Password2026!", "password"],
      ["Motdepasse-99", "motdepasse"],
      ["!!!qwerty!!!", "qwerty"],
      // An interior word is part of the phrase and is left alone.
      ["Guidon-Tandem-47!", "guidon-tandem"],
      ["Chaine-Velo-2026", "chaine-velo"],
      ["", ""],
    ])("%s → %s", (password, expected) => {
      expect(commonBaseWord(password)).toBe(expected);
    });
  });

  it("refuses a password whose base word is on the common list", async () => {
    resetPasswordChecker(() => 4);
    // Twelve characters, three classes, not on the list verbatim — and still
    // `password` with a year stuck on the end.
    expect(isCommonPassword("Password2026!")).toBe(false);
    expect(syntacticIssues("Password2026!")).toEqual([]);
    await expect(checkPasswordPolicy("Password2026!")).resolves.toEqual({
      ok: false,
      issue: "common",
      key: "auth.password.common",
    });
  });

  it("leaves a passphrase that merely contains a common word alone", async () => {
    resetPasswordChecker(() => 4);
    await expect(checkPasswordPolicy("Guidon-Tandem-47!")).resolves.toEqual({ ok: true });
  });

  it("refuses a password whose only flaw is a low score", async () => {
    resetPasswordChecker(() => 2);
    await expect(checkPasswordPolicy(STRONG)).resolves.toEqual({
      ok: false,
      issue: "weak",
      key: "auth.password.weak",
    });
  });

  it("feeds the address and the project name to the scorer as user inputs", async () => {
    const seen: string[][] = [];
    resetPasswordChecker((_password, inputs) => {
      seen.push(inputs);
      return 4;
    });

    await checkPasswordPolicy(STRONG, { email: "camille@velo.test" });
    expect(seen[0]).toEqual(["camille@velo.test", "camille", "velo", "atelier", "velo-atelier"]);

    await checkPasswordPolicy(STRONG);
    expect(seen[1]).toEqual(["velo", "atelier", "velo-atelier"]);
  });
});
