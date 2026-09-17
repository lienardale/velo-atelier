/**
 * THREAT — Credential stuffing and password guessing, and the denial-of-service
 * hiding inside the obvious fix for them.
 *
 * Three buckets, because three different attacks exist (§4.3):
 *
 *   `login:<ip>`            10 / 15 min   a scripted run from one address
 *   `login:<ip>:<email>`     5 / 15 min   a targeted run at one account
 *   `login-email:<email>`   50 / h SOFT   a distributed run at one account
 *
 * The third one is soft **on purpose**, and that is the subtle control here: a
 * hard per-account limit would let anybody lock a victim out of their own
 * account by failing to sign in as them fifty times. So it only delays.
 *
 * Related THREAT — the rate-limit table as an address book. `AuthAttempt.key`
 * is a salted SHA-256 digest, so a dump of the table holds no address and no
 * e-mail, and the digest cannot be reversed by hashing a candidate offline
 * without `AUTH_SECRET`.
 *
 * CONTROLS PINNED
 *
 *   1. the `max`-th attempt is allowed and the next is refused, with a
 *      `retryAfterMs` that is strictly positive;
 *   2. the window is fixed: it expires, and the next attempt starts a new one;
 *   3. one successful sign-in clears the (address, account) bucket, so a
 *      legitimate visitor who mistyped four times is not punished afterwards —
 *      but never the per-address bucket, or one address could credential-stuff
 *      forever by signing in to its own account every few guesses;
 *   4. the soft bucket delays and never refuses — the victim can always still
 *      sign in;
 *   5. `Camille@VELO-ATELIER.test` and `camille@velo-atelier.test` share a
 *      bucket: normalisation happens before the key is derived, or the limit is
 *      bypassed by changing the case;
 *   6. no address, e-mail or plaintext is stored in the table;
 *   7. sign-up and password change carry their own buckets.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizeCredentials } from "@/lib/auth/authorize";
import { RateLimitedSignin } from "@/lib/auth/errors";
import { hashPassword } from "@/lib/auth/password";
import { rateLimitKey } from "@/lib/auth/tokens";
import {
  createPrismaRateLimiter,
  RATE_LIMITS,
  SOFT_DELAY_MS,
  type RateLimiter,
} from "@/lib/security/rate-limit";
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

const EMAIL = "camille@velo-atelier.test";
const PASSWORD = "Guidon-Tandem-47!";
const IP = "203.0.113.7";

let clock = Date.UTC(2026, 8, 12, 10, 0, 0);
const now = () => clock;

function limiter(): RateLimiter {
  return createPrismaRateLimiter(fakeDb.client, now);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  fakeDb.reset();
  clock = Date.UTC(2026, 8, 12, 10, 0, 0);
  setRequestHeaders({ ...sameOriginHeaders(), "x-forwarded-for": IP });
  setSession(null);
});

describe("the bucket itself", () => {
  const options = { max: 5, windowMs: 60_000 };

  it("allows exactly `max` attempts and refuses the next", async () => {
    const bucket = limiter();
    const key = rateLimitKey("test", IP);

    for (let attempt = 1; attempt <= options.max; attempt += 1) {
      const verdict = await bucket.consume(key, options);
      expect(verdict).toMatchObject({ ok: true, count: attempt, retryAfterMs: 0 });
    }

    const refused = await bucket.consume(key, options);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
    expect(refused.count).toBe(options.max + 1);
  });

  it("records when the key reopens, so an operator can read the table", async () => {
    const bucket = limiter();
    const key = rateLimitKey("test", IP);
    for (let attempt = 0; attempt <= options.max; attempt += 1) {
      await bucket.consume(key, options);
    }

    const row = fakeDb.rows("AuthAttempt")[0];
    expect(row.lockedUntil).toBeInstanceOf(Date);
    expect((row.lockedUntil as Date).getTime()).toBe(clock + options.windowMs);
  });

  it("opens a fresh window once the old one has expired", async () => {
    const bucket = limiter();
    const key = rateLimitKey("test", IP);
    for (let attempt = 0; attempt <= options.max; attempt += 1) {
      await bucket.consume(key, options);
    }
    expect((await bucket.consume(key, options)).ok).toBe(false);

    clock += options.windowMs + 1;

    expect(await bucket.consume(key, options)).toMatchObject({ ok: true, count: 1 });
  });

  it("forgets a key on reset — one good sign-in clears the bucket", async () => {
    const bucket = limiter();
    const key = rateLimitKey("test", IP);
    for (let attempt = 0; attempt <= options.max; attempt += 1) {
      await bucket.consume(key, options);
    }

    await bucket.reset(key);

    expect(fakeDb.rows("AuthAttempt")).toHaveLength(0);
    expect(await bucket.consume(key, options)).toMatchObject({ ok: true, count: 1 });
  });

  it("stores no address, e-mail or plaintext — only a salted digest", async () => {
    await limiter().consume(rateLimitKey("login", IP, EMAIL), options);

    const serialized = JSON.stringify(fakeDb.rows("AuthAttempt"));
    expect(serialized).not.toContain(IP);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain("camille");
    expect(fakeDb.rows("AuthAttempt")[0].key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keys different scopes, addresses and accounts apart", () => {
    const a = rateLimitKey("login", IP, EMAIL);
    expect(a).not.toBe(rateLimitKey("signup", IP, EMAIL));
    expect(a).not.toBe(rateLimitKey("login", "198.51.100.9", EMAIL));
    expect(a).not.toBe(rateLimitKey("login", IP, "autre@velo-atelier.test"));
  });

  it("cannot be bypassed by changing the case of the address", () => {
    expect(rateLimitKey("login", IP, "Camille@VELO-ATELIER.test")).toBe(
      rateLimitKey("login", IP, EMAIL),
    );
  });
});

describe("sign-in", () => {
  async function seedUser(): Promise<void> {
    await fakeDb.seed("User", {
      email: EMAIL,
      locale: "fr",
      passwordHash: await hashPassword(PASSWORD, 4),
    });
  }

  const deps = () => ({
    prisma: fakeDb.client,
    rateLimiter: limiter(),
    ip: IP,
    isProduction: true,
    sleep: vi.fn(async () => undefined),
  });

  it("refuses the 6th wrong password from one address for one account", async () => {
    await seedUser();
    const shared = deps();

    for (let attempt = 0; attempt < RATE_LIMITS.loginPerIpEmail.max; attempt += 1) {
      await expect(
        authorizeCredentials({ email: EMAIL, password: "wrong-password-1!" }, shared),
      ).resolves.toBeNull();
    }

    await expect(
      authorizeCredentials({ email: EMAIL, password: "wrong-password-1!" }, shared),
    ).rejects.toBeInstanceOf(RateLimitedSignin);
  });

  it("reports a positive wait the visitor can act on", async () => {
    await seedUser();
    const shared = deps();
    for (let attempt = 0; attempt <= RATE_LIMITS.loginPerIpEmail.max; attempt += 1) {
      await authorizeCredentials({ email: EMAIL, password: "wrong" }, shared).catch(
        (error: unknown) => {
          expect((error as RateLimitedSignin).retryAfterSec).toBeGreaterThan(0);
        },
      );
    }
  });

  it("clears the (address, account) bucket after one successful sign-in", async () => {
    await seedUser();
    const shared = deps();

    for (let attempt = 0; attempt < RATE_LIMITS.loginPerIpEmail.max - 1; attempt += 1) {
      await authorizeCredentials({ email: EMAIL, password: "wrong" }, shared);
    }
    await expect(
      authorizeCredentials({ email: EMAIL, password: PASSWORD }, shared),
    ).resolves.toMatchObject({ email: EMAIL });

    // Back to a full allowance: the visitor who mistyped is not half-locked.
    for (let attempt = 0; attempt < RATE_LIMITS.loginPerIpEmail.max; attempt += 1) {
      await expect(
        authorizeCredentials({ email: EMAIL, password: "wrong" }, shared),
      ).resolves.toBeNull();
    }
  });

  it("keeps counting per address across the attacker's own successful sign-ins (credential stuffing)", async () => {
    // One address tries one password per victim — so no (address, account) bucket
    // ever fills — and signs in to its OWN account every few guesses. If a success
    // reset the per-address bucket, this ran forever (reproduced: 100 guesses, 0
    // refused). The per-address bucket must still stop it at its max.
    await seedUser(); // EMAIL / PASSWORD is the attacker's own account
    const shared = deps();
    let evaluated = 0;
    let refused = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const ownLogin = attempt % 5 === 4;
      const credentials = ownLogin
        ? { email: EMAIL, password: PASSWORD }
        : { email: `victim-${attempt}@velo-atelier.test`, password: "Guess-Password-1!" };
      try {
        await authorizeCredentials(credentials, shared);
        evaluated += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitedSignin);
        refused += 1;
      }
    }
    expect(evaluated).toBe(RATE_LIMITS.loginPerIp.max);
    expect(refused).toBe(20 - RATE_LIMITS.loginPerIp.max);
  });

  it("cannot be used to lock a victim out: the per-account bucket only delays", async () => {
    await seedUser();
    const sleep = vi.fn(async () => undefined);
    const bucket = limiter();

    // The attacker burns the victim's per-account allowance from many addresses.
    for (let attempt = 0; attempt <= RATE_LIMITS.loginPerEmail.max; attempt += 1) {
      await bucket.consume(rateLimitKey("login-email", EMAIL), RATE_LIMITS.loginPerEmail);
    }

    // The victim, from their own address, still gets in — slowly.
    const victim = await authorizeCredentials(
      { email: EMAIL, password: PASSWORD },
      { prisma: fakeDb.client, rateLimiter: bucket, ip: "198.51.100.9", isProduction: true, sleep },
    );

    expect(victim).toMatchObject({ email: EMAIL });
    expect(sleep).toHaveBeenCalledWith(SOFT_DELAY_MS);
  });

  it("shares one bucket across the casing of the address", async () => {
    await seedUser();
    const shared = deps();

    for (let attempt = 0; attempt < RATE_LIMITS.loginPerIpEmail.max; attempt += 1) {
      await authorizeCredentials({ email: "CAMILLE@Velo-Atelier.TEST", password: "x" }, shared);
    }

    await expect(
      authorizeCredentials({ email: EMAIL, password: "x" }, shared),
    ).rejects.toBeInstanceOf(RateLimitedSignin);
  });
});

describe("the other buckets", () => {
  it("caps sign-ups per address at the documented rate", async () => {
    for (let attempt = 0; attempt < RATE_LIMITS.signupPerIp.max; attempt += 1) {
      await signUpAction(
        IDLE,
        form({ email: `nouveau${attempt}@velo-atelier.test`, password: PASSWORD, locale: "fr" }),
      ).catch(() => undefined);
    }

    const refused = await signUpAction(
      IDLE,
      form({ email: "encore@velo-atelier.test", password: PASSWORD, locale: "fr" }),
    );

    expect(refused).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(refused.ok === false && refused.retryAfterSec).toBeGreaterThan(0);
  }, 20_000);

  it("caps password changes per user, so a stolen session cannot guess the old one", async () => {
    const user = await fakeDb.seed("User", {
      email: EMAIL,
      locale: "fr",
      passwordHash: await hashPassword(PASSWORD, 4),
    });
    setSession(sessionFor(user as unknown as { id: string; email: string }));

    for (let attempt = 0; attempt < RATE_LIMITS.passwordChangePerUser.max; attempt += 1) {
      await changePasswordAction(IDLE, form({ current: "wrong", next: "Chaine-Cassette-58?" }));
    }

    const refused = await changePasswordAction(
      IDLE,
      form({ current: "wrong", next: "Chaine-Cassette-58?" }),
    );
    expect(refused).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("uses the bucket sizes §4.3 documents", () => {
    expect(RATE_LIMITS).toMatchObject({
      loginPerIp: { max: 10, windowMs: 15 * 60_000 },
      loginPerIpEmail: { max: 5, windowMs: 15 * 60_000 },
      loginPerEmail: { max: 50, windowMs: 60 * 60_000 },
      signupPerIp: { max: 5, windowMs: 60 * 60_000 },
      passwordChangePerUser: { max: 5, windowMs: 60 * 60_000 },
      guestImportPerUser: { max: 3, windowMs: 60 * 60_000 },
    });
  });
});
