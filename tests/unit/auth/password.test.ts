/**
 * `lib/auth/password.ts` — bcrypt hashing, verification and rehash policy.
 *
 * Cost 4 throughout (bcrypt's minimum) so the file runs in milliseconds; the
 * cost-dependent behaviour is tested through `bcryptCost()` and `needsRehash()`
 * rather than by paying for cost-12 hashes. The seeded `$2b$12$` prefix is
 * asserted end to end by §4.8 AC4 (W1-T3).
 */

import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_BCRYPT_COST,
  MAX_PASSWORD_BYTES,
  PasswordTooLongError,
  bcryptCost,
  hashCost,
  hashPassword,
  needsRehash,
  passwordByteLength,
  verifyPassword,
} from "@/lib/auth/password";

const PASSWORD = "Demo-Velo-Atelier-2026!";

/**
 * A `$2a$` hash, as written by older bcrypt implementations. `$2a$` and `$2b$`
 * compute the same digest for any password under 255 bytes (the `$2b$`
 * revision only fixed a length-wraparound bug), so relabelling a `$2b$` hash
 * yields a genuine, verifiable `$2a$` one.
 */
function legacyHash(): string {
  return bcrypt.hashSync(PASSWORD, 4).replace(/^\$2b\$/, "$2a$");
}

describe("hashPassword", () => {
  it("emits a $2b$ hash at the requested cost", async () => {
    const hash = await hashPassword(PASSWORD, 4);
    expect(hash).toMatch(/^\$2b\$04\$[./A-Za-z0-9]{53}$/);
    expect(hash).toHaveLength(60);
  });

  it("salts every hash", async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD, 4), hashPassword(PASSWORD, 4)]);
    expect(a).not.toBe(b);
  });

  it("accepts exactly 72 bytes", async () => {
    await expect(hashPassword("a".repeat(MAX_PASSWORD_BYTES), 4)).resolves.toMatch(/^\$2b\$/);
  });

  it("refuses more than 72 bytes instead of silently truncating", async () => {
    // bcrypt ignores everything past byte 72, so accepting a longer password
    // would make it equivalent to its own prefix.
    await expect(hashPassword("a".repeat(73), 4)).rejects.toBeInstanceOf(PasswordTooLongError);
  });

  it("counts bytes, not characters", async () => {
    // "é" is two UTF-8 bytes: 37 of them = 74 bytes, under 72 characters.
    const accented = "é".repeat(37);
    expect(accented.length).toBeLessThan(MAX_PASSWORD_BYTES);
    expect(passwordByteLength(accented)).toBe(74);
    await expect(hashPassword(accented, 4)).rejects.toThrow(/74 bytes/);
  });

  it("uses BCRYPT_COST from the environment by default", async () => {
    const previous = process.env.BCRYPT_COST;
    process.env.BCRYPT_COST = "4";
    try {
      expect(await hashPassword(PASSWORD)).toMatch(/^\$2b\$04\$/);
    } finally {
      if (previous === undefined) delete process.env.BCRYPT_COST;
      else process.env.BCRYPT_COST = previous;
    }
  });
});

describe("verifyPassword", () => {
  it("accepts the right password", async () => {
    const hash = await hashPassword(PASSWORD, 4);
    await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword(PASSWORD, 4);
    await expect(verifyPassword(`${PASSWORD}x`, hash)).resolves.toBe(false);
  });

  it("verifies hashes written by other bcrypt implementations ($2a$)", async () => {
    const legacy = legacyHash();
    expect(legacy.startsWith("$2a$")).toBe(true);
    await expect(verifyPassword(PASSWORD, legacy)).resolves.toBe(true);
  });

  it.each([
    ["null (Google-only account)", null],
    ["undefined (unknown e-mail)", undefined],
    ["an empty string", ""],
    ["something that is not a bcrypt hash", "plaintext-in-the-column"],
  ])("returns false for %s without throwing", async (_label, hash) => {
    await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(false);
  });
});

describe("needsRehash", () => {
  it("is false for a current $2b$ hash at the target cost", async () => {
    expect(needsRehash(await hashPassword(PASSWORD, 4), 4)).toBe(false);
  });

  it("is true when the target cost has gone up", async () => {
    expect(needsRehash(await hashPassword(PASSWORD, 4), 5)).toBe(true);
  });

  it("never downgrades a stronger hash", async () => {
    expect(needsRehash(await hashPassword(PASSWORD, 5), 4)).toBe(false);
  });

  it("is true for another bcrypt variant", () => {
    const legacy = legacyHash();
    expect(needsRehash(legacy, 4)).toBe(true);
  });

  it("is true for anything that is not a bcrypt hash", () => {
    expect(needsRehash("not-a-hash", 4)).toBe(true);
  });
});

describe("bcryptCost", () => {
  it("defaults to 12", () => {
    expect(DEFAULT_BCRYPT_COST).toBe(12);
    expect(bcryptCost({})).toBe(12);
    expect(bcryptCost({ BCRYPT_COST: "" })).toBe(12);
    expect(bcryptCost({ BCRYPT_COST: "twelve" })).toBe(12);
  });

  it("reads BCRYPT_COST", () => {
    expect(bcryptCost({ BCRYPT_COST: "4" })).toBe(4);
    expect(bcryptCost({ BCRYPT_COST: " 13 " })).toBe(13);
  });

  it("clamps to bcrypt's usable range", () => {
    expect(bcryptCost({ BCRYPT_COST: "1" })).toBe(4);
    expect(bcryptCost({ BCRYPT_COST: "31" })).toBe(15);
  });
});

describe("hashCost", () => {
  it("extracts the cost from a hash", async () => {
    expect(hashCost(await hashPassword(PASSWORD, 4))).toBe(4);
  });

  it("is undefined for a non-hash", () => {
    expect(hashCost("$2b$xx$nope")).toBeUndefined();
  });
});
