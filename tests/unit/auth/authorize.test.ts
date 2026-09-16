/**
 * `authorizeCredentials()` — the Credentials provider's decision (§4.3, §4.8 AC4).
 *
 * Everything it touches is injected, so this file covers the whole table with no
 * database, no bcrypt cost and no clock:
 *
 *   valid pair                   → the user, buckets cleared
 *   unknown address              → null
 *   wrong password               → null
 *   Google-only account (no hash)→ null, and a REAL dummy compare still ran
 *   malformed credentials        → null, no query at all
 *   per-IP bucket full           → throws RateLimitedSignin
 *   per-IP+email bucket full     → throws RateLimitedSignin
 *   per-email soft bucket full   → 2 s delay, then the normal answer
 *   `local` IP outside prod      → per-IP buckets skipped
 *   legacy `$2a$` / low-cost hash→ rehashed on the way through
 *
 * The three buckets get DIFFERENT keys, and that is asserted too: sharing one
 * would make the tight per-address-per-account limit unreachable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizeCredentials } from "@/lib/auth/authorize";
import { RateLimitedSignin } from "@/lib/auth/errors";
import { rateLimitKey } from "@/lib/auth/tokens";
import { RATE_LIMITS, type RateLimiter } from "@/lib/security/rate-limit";

const USER = {
  id: "00000000-0000-4000-8000-0000000000aa",
  email: "camille@velo-atelier.test",
  name: "Camille",
  image: null,
  locale: "fr" as const,
  sessionVersion: 3,
  passwordHash: "$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQ",
};

/** A limiter that allows everything and records what it was asked. */
function allowingLimiter() {
  const consumed: string[] = [];
  const reset: string[] = [];
  const limiter: RateLimiter = {
    consume: vi.fn(async (key: string) => {
      consumed.push(key);
      return { ok: true, retryAfterMs: 0, count: 1 };
    }),
    reset: vi.fn(async (key: string) => {
      reset.push(key);
    }),
  };
  return { limiter, consumed, reset };
}

/** A limiter that refuses exactly the keys it is given. */
function refusingLimiter(refusedKeys: readonly string[], retryAfterMs = 90_000): RateLimiter {
  return {
    consume: vi.fn(async (key: string) =>
      refusedKeys.includes(key)
        ? { ok: false, retryAfterMs, count: 99 }
        : { ok: true, retryAfterMs: 0, count: 1 },
    ),
    reset: vi.fn(async () => undefined),
  };
}

function prismaWith(user: typeof USER | null) {
  const findUnique = vi.fn(async () => user);
  const update = vi.fn(async () => user);
  return { prisma: { user: { findUnique, update } }, findUnique, update };
}

function deps(overrides: Partial<Parameters<typeof authorizeCredentials>[1]> = {}) {
  const { limiter } = allowingLimiter();
  return {
    prisma: prismaWith(USER).prisma,
    rateLimiter: limiter,
    ip: "203.0.113.9",
    isProduction: false,
    sleep: vi.fn(async () => undefined),
    verify: vi.fn(async () => true),
    hash: vi.fn(async () => "$2b$12$rehashed"),
    ...overrides,
  } as Parameters<typeof authorizeCredentials>[1];
}

const CREDENTIALS = { email: "Camille@Velo-Atelier.test", password: "Guidon-Tandem-47!" };

describe("authorizeCredentials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the user for a valid pair, without the password hash", async () => {
    const user = await authorizeCredentials(CREDENTIALS, deps());
    expect(user).toEqual({
      id: USER.id,
      email: USER.email,
      name: USER.name,
      image: USER.image,
      locale: "fr",
      sessionVersion: 3,
    });
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("normalises the address before looking it up", async () => {
    const { prisma, findUnique } = prismaWith(USER);
    await authorizeCredentials(
      { email: "  CAMILLE@Velo-Atelier.TEST ", password: "x" },
      deps({ prisma }),
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "camille@velo-atelier.test" } }),
    );
  });

  it("uses three different buckets, keyed by ip, ip+email and email", async () => {
    const { limiter, consumed } = allowingLimiter();
    await authorizeCredentials(CREDENTIALS, deps({ rateLimiter: limiter }));
    expect(consumed).toEqual([
      rateLimitKey("login", "203.0.113.9"),
      rateLimitKey("login", "203.0.113.9", "camille@velo-atelier.test"),
      rateLimitKey("login-email", "camille@velo-atelier.test"),
    ]);
    expect(new Set(consumed).size).toBe(3);
  });

  it("clears the two hard buckets after a successful sign-in", async () => {
    const { limiter, reset } = allowingLimiter();
    await authorizeCredentials(CREDENTIALS, deps({ rateLimiter: limiter }));
    expect(reset).toEqual([
      rateLimitKey("login", "203.0.113.9"),
      rateLimitKey("login", "203.0.113.9", "camille@velo-atelier.test"),
    ]);
  });

  describe("failures all look the same from outside", () => {
    it("returns null for an unknown address — and still runs a compare", async () => {
      const verify = vi.fn(async () => false);
      const { prisma } = prismaWith(null);
      await expect(authorizeCredentials(CREDENTIALS, deps({ prisma, verify }))).resolves.toBeNull();
      // The dummy compare is the timing defence: skipping it for an unknown
      // address is exactly the side channel it exists to close.
      expect(verify).toHaveBeenCalledWith(CREDENTIALS.password, null);
    });

    it("returns null for a wrong password", async () => {
      const verify = vi.fn(async () => false);
      await expect(authorizeCredentials(CREDENTIALS, deps({ verify }))).resolves.toBeNull();
    });

    it("returns null for a Google-only account, comparing against nothing", async () => {
      const verify = vi.fn(async () => false);
      const { prisma } = prismaWith({ ...USER, passwordHash: null as unknown as string });
      await expect(authorizeCredentials(CREDENTIALS, deps({ prisma, verify }))).resolves.toBeNull();
      expect(verify).toHaveBeenCalledWith(CREDENTIALS.password, null);
    });
  });

  describe("malformed credentials never reach the database", () => {
    it.each([
      ["nothing", undefined],
      ["null", null],
      ["a string", "camille@velo.test"],
      ["no password", { email: "camille@velo.test" }],
      ["no email", { password: "x" }],
      ["an empty email", { email: "", password: "x" }],
      ["an empty password", { email: "camille@velo.test", password: "" }],
      ["an over-long email", { email: `${"a".repeat(250)}@velo.test`, password: "x" }],
      ["non-strings", { email: 42, password: true }],
    ])("%s", async (_label, credentials) => {
      const { prisma, findUnique } = prismaWith(USER);
      const { limiter, consumed } = allowingLimiter();
      await expect(
        authorizeCredentials(credentials, deps({ prisma, rateLimiter: limiter })),
      ).resolves.toBeNull();
      expect(findUnique).not.toHaveBeenCalled();
      expect(consumed).toEqual([]);
    });
  });

  describe("rate limits", () => {
    it("throws RateLimitedSignin when the per-address bucket is full", async () => {
      const limiter = refusingLimiter([rateLimitKey("login", "203.0.113.9")], 120_000);
      await expect(
        authorizeCredentials(CREDENTIALS, deps({ rateLimiter: limiter })),
      ).rejects.toBeInstanceOf(RateLimitedSignin);
    });

    it("throws when the tight per-address-per-account bucket is full", async () => {
      const limiter = refusingLimiter([
        rateLimitKey("login", "203.0.113.9", "camille@velo-atelier.test"),
      ]);
      const error = await authorizeCredentials(CREDENTIALS, deps({ rateLimiter: limiter })).catch(
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(RateLimitedSignin);
      expect((error as RateLimitedSignin).retryAfterSec).toBe(90);
      expect((error as RateLimitedSignin).code).toBe("rate_limited");
    });

    it("reports the LONGER of the two waits", async () => {
      const limiter: RateLimiter = {
        consume: vi.fn(async (key: string) => ({
          ok: false,
          retryAfterMs: key === rateLimitKey("login", "203.0.113.9") ? 30_000 : 300_000,
          count: 99,
        })),
        reset: vi.fn(async () => undefined),
      };
      const error = await authorizeCredentials(CREDENTIALS, deps({ rateLimiter: limiter })).catch(
        (thrown: unknown) => thrown,
      );
      expect((error as RateLimitedSignin).retryAfterSec).toBe(300);
    });

    it("only DELAYS when the per-account soft bucket is full — never refuses", async () => {
      const limiter = refusingLimiter([rateLimitKey("login-email", "camille@velo-atelier.test")]);
      const sleep = vi.fn(async () => undefined);
      // The whole point: a third party cannot lock this account by failing to
      // sign in as its owner fifty times.
      await expect(
        authorizeCredentials(CREDENTIALS, deps({ rateLimiter: limiter, sleep })),
      ).resolves.toMatchObject({ id: USER.id });
      expect(sleep).toHaveBeenCalledWith(2000);
    });

    it("does not delay when the soft bucket has room", async () => {
      const sleep = vi.fn(async () => undefined);
      await authorizeCredentials(CREDENTIALS, deps({ sleep }));
      expect(sleep).not.toHaveBeenCalled();
    });

    it("skips the per-address buckets for the `local` sentinel outside production", async () => {
      const { limiter, consumed } = allowingLimiter();
      await authorizeCredentials(
        CREDENTIALS,
        deps({ rateLimiter: limiter, ip: "local", isProduction: false }),
      );
      // Only the soft per-account bucket was consumed: the whole e2e suite runs
      // from one loopback address and must not lock itself out.
      expect(consumed).toEqual([rateLimitKey("login-email", "camille@velo-atelier.test")]);
    });

    it("still applies them in production, even for `local`", async () => {
      const { limiter, consumed } = allowingLimiter();
      await authorizeCredentials(
        CREDENTIALS,
        deps({ rateLimiter: limiter, ip: "local", isProduction: true }),
      );
      expect(consumed).toHaveLength(3);
    });

    it("uses the documented bucket sizes", () => {
      expect(RATE_LIMITS.loginPerIp).toEqual({ max: 10, windowMs: 900_000 });
      expect(RATE_LIMITS.loginPerIpEmail).toEqual({ max: 5, windowMs: 900_000 });
      expect(RATE_LIMITS.loginPerEmail).toEqual({ max: 50, windowMs: 3_600_000 });
    });
  });

  describe("rehashing", () => {
    it("upgrades a legacy $2a$ hash while the plaintext is in hand", async () => {
      const { prisma, update } = prismaWith({
        ...USER,
        passwordHash: `$2a$12$${"a".repeat(53)}`,
      });
      const hash = vi.fn(async () => "$2b$12$fresh");
      await authorizeCredentials(CREDENTIALS, deps({ prisma, hash }));
      expect(hash).toHaveBeenCalledWith(CREDENTIALS.password);
      expect(update).toHaveBeenCalledWith({
        where: { id: USER.id },
        data: { passwordHash: "$2b$12$fresh" },
      });
    });

    it("leaves a current hash alone", async () => {
      const { prisma, update } = prismaWith(USER);
      const hash = vi.fn(async () => "never");
      await authorizeCredentials(CREDENTIALS, deps({ prisma, hash }));
      expect(hash).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it("does not rehash after a FAILED sign-in", async () => {
      const { prisma, update } = prismaWith({
        ...USER,
        passwordHash: `$2a$12$${"a".repeat(53)}`,
      });
      const hash = vi.fn(async () => "never");
      await authorizeCredentials(
        CREDENTIALS,
        deps({ prisma, hash, verify: vi.fn(async () => false) }),
      );
      expect(hash).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });
});
