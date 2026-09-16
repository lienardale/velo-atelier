/**
 * The authentication surface against the real `_test` database (§4.8 AC6).
 *
 * The unit and security tiers run on the in-memory fake, which is driven by
 * `prisma/schema.prisma` and therefore agrees with it by construction. What it
 * CANNOT prove is that PostgreSQL agrees: that `email` really is `citext` and
 * compares case-insensitively, that the unique index really raises P2002, that
 * `passwordHash` really fits in `VARCHAR(72)`, and that the `@auth/prisma-adapter`
 * really round-trips a user through our generated client (§4.3 asks for exactly
 * that assertion).
 *
 * Those are the claims this file checks. Everything else about sign-in — the
 * three buckets, the timing, the message keys — is already pinned with fakes,
 * and repeating it here would only make the suite slower.
 */
import { PrismaAdapter } from "@auth/prisma-adapter";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizeCredentials } from "@/lib/auth/authorize";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { rateLimitKey } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db/prisma";
import { isUniqueViolation } from "@/lib/db/errors";
import { createPrismaRateLimiter, RATE_LIMITS } from "@/lib/security/rate-limit";
import { sameOriginHeaders, setRequestHeaders, setSession } from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { signUpAction } = await import("@/app/[locale]/(auth)/inscription/actions");
const { IDLE } = await import("@/lib/actions/result");

const PASSWORD = "Guidon-Tandem-47!";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function createUser(email: string, withPassword = true) {
  return prisma.user.create({
    data: {
      email,
      name: email.split("@")[0],
      locale: "fr",
      passwordHash: withPassword ? await hashPassword(PASSWORD, 4) : null,
    },
  });
}

beforeEach(async () => {
  await prisma.authAttempt.deleteMany({});
  await prisma.user.deleteMany({});
  setSession(null);
  setRequestHeaders(sameOriginHeaders());
});

describe("the User table", () => {
  it("compares e-mail addresses case-insensitively (citext)", async () => {
    await createUser("camille@velo-atelier.test");

    const found = await prisma.user.findUnique({ where: { email: "CAMILLE@Velo-Atelier.TEST" } });

    expect(found?.email).toBe("camille@velo-atelier.test");
  });

  it("refuses a second account with the same address, in any case", async () => {
    await createUser("camille@velo-atelier.test");

    const duplicate = createUser("Camille@Velo-Atelier.test");

    await expect(duplicate).rejects.toSatisfy((error: unknown) =>
      isUniqueViolation(error, "email"),
    );
  });

  it("stores a full-cost bcrypt hash within VARCHAR(72)", async () => {
    const hash = await hashPassword(PASSWORD, 12);
    const user = await prisma.user.create({
      data: { email: "cout@velo-atelier.test", locale: "fr", passwordHash: hash },
    });

    expect(hash).toHaveLength(60);
    expect(user.passwordHash).toBe(hash);
    expect(await verifyPassword(PASSWORD, user.passwordHash)).toBe(true);
  }, 20_000);

  it("defaults sessionVersion to 0 and leaves emailVerified null", async () => {
    const user = await createUser("defauts@velo-atelier.test");

    expect(user.sessionVersion).toBe(0);
    expect(user.emailVerified).toBeNull();
    expect(user.locale).toBe("fr");
  });
});

describe("the Auth.js Prisma adapter", () => {
  // §4.3: "tests/integration/auth.test.ts proves adapter.createUser round-trips".
  const adapter = PrismaAdapter(prisma as unknown as Parameters<typeof PrismaAdapter>[0]);

  it("creates, reads and links a user the way Auth.js will", async () => {
    const created = await adapter.createUser?.({
      id: crypto.randomUUID(),
      email: "google@velo-atelier.test",
      emailVerified: null,
      name: "Camille",
      image: "https://lh3.googleusercontent.com/a",
    });

    expect(created?.email).toBe("google@velo-atelier.test");

    const byEmail = await adapter.getUserByEmail?.("google@velo-atelier.test");
    expect(byEmail?.id).toBe(created?.id);

    await adapter.linkAccount?.({
      userId: created!.id,
      type: "oidc",
      provider: "google",
      providerAccountId: "google-123",
    });

    const byAccount = await adapter.getUserByAccount?.({
      provider: "google",
      providerAccountId: "google-123",
    });
    expect(byAccount?.id).toBe(created?.id);
  });

  it("cascades the linked account away with the user", async () => {
    const user = await createUser("cascade@velo-atelier.test");
    await prisma.account.create({
      data: {
        userId: user.id,
        type: "oidc",
        provider: "google",
        providerAccountId: "google-cascade",
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("sign-up against the real database", () => {
  it("creates the account, hashed, and signs it in", async () => {
    // The session fake turns `signIn({ redirectTo })` into a thrown redirect —
    // which is exactly what the real one does on success.
    await expect(
      signUpAction(
        IDLE,
        form({ email: "nouveau@velo-atelier.test", password: PASSWORD, locale: "en" }),
      ),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });

    const created = await prisma.user.findUnique({ where: { email: "nouveau@velo-atelier.test" } });
    expect(created).not.toBeNull();
    expect(created?.locale).toBe("en");
    expect(created?.passwordHash).toEqual(expect.stringMatching(/^\$2b\$\d{2}\$/));
    expect(created?.passwordHash).not.toContain(PASSWORD);
  });

  it("turns the unique-index violation into errors.emailTaken", async () => {
    await createUser("existe@velo-atelier.test");

    const result = await signUpAction(
      IDLE,
      form({ email: "EXISTE@velo-atelier.test", password: PASSWORD, locale: "fr" }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "CONFLICT",
      fieldErrors: { email: "errors.emailTaken" },
    });
    expect(await prisma.user.count()).toBe(1);
  });
});

describe("credentials sign-in against the real database", () => {
  const deps = () => ({
    prisma,
    rateLimiter: createPrismaRateLimiter(prisma),
    ip: "203.0.113.7",
    isProduction: true,
  });

  it("returns the user for the right password and null for the wrong one", async () => {
    await createUser("camille@velo-atelier.test");

    await expect(
      authorizeCredentials({ email: "Camille@Velo-Atelier.test", password: PASSWORD }, deps()),
    ).resolves.toMatchObject({ email: "camille@velo-atelier.test", sessionVersion: 0 });

    await expect(
      authorizeCredentials({ email: "camille@velo-atelier.test", password: "nope" }, deps()),
    ).resolves.toBeNull();
  });

  it("returns null for a Google-only account without touching the hash", async () => {
    await createUser("google-only@velo-atelier.test", false);

    await expect(
      authorizeCredentials({ email: "google-only@velo-atelier.test", password: PASSWORD }, deps()),
    ).resolves.toBeNull();
  });

  it("upgrades a low-cost hash on a successful sign-in", async () => {
    const user = await createUser("rehash@velo-atelier.test");
    const before = user.passwordHash;
    process.env.BCRYPT_COST = "6";

    try {
      await authorizeCredentials({ email: user.email, password: PASSWORD }, deps());
    } finally {
      process.env.BCRYPT_COST = "4";
    }

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.passwordHash).not.toBe(before);
    expect(after?.passwordHash?.startsWith("$2b$06$")).toBe(true);
    expect(await verifyPassword(PASSWORD, after?.passwordHash ?? null)).toBe(true);
  });
});

describe("the AuthAttempt table", () => {
  it("counts, refuses and reopens on the real row", async () => {
    const limiter = createPrismaRateLimiter(prisma);
    const key = rateLimitKey("login", "203.0.113.7", "camille@velo-atelier.test");
    const options = RATE_LIMITS.loginPerIpEmail;

    for (let attempt = 1; attempt <= options.max; attempt += 1) {
      expect(await limiter.consume(key, options)).toMatchObject({ ok: true, count: attempt });
    }

    const refused = await limiter.consume(key, options);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);

    const row = await prisma.authAttempt.findUnique({ where: { key } });
    expect(row?.count).toBe(options.max + 1);
    expect(row?.lockedUntil).toBeInstanceOf(Date);

    await limiter.reset(key);
    expect(await prisma.authAttempt.findUnique({ where: { key } })).toBeNull();
  });

  it("holds no address and no e-mail — only a salted digest", async () => {
    await createPrismaRateLimiter(prisma).consume(
      rateLimitKey("login", "203.0.113.7", "camille@velo-atelier.test"),
      RATE_LIMITS.loginPerIp,
    );

    const rows = await prisma.authAttempt.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
    expect(JSON.stringify(rows)).not.toContain("camille");
  });
});
