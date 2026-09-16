/**
 * The Credentials provider's `authorize` (§4.3).
 *
 * Pure in the sense that matters: everything it touches — the database, the
 * rate limiter, bcrypt, the clock, `sleep` — arrives as a dependency, so
 * `tests/unit/auth/authorize.test.ts` drives every path (unknown e-mail, wrong
 * password, Google-only account, each of the three buckets, the rehash) with
 * fakes and no I/O.
 *
 * The three buckets, and why there are three:
 *
 *   `login:<ip>`            10 / 15 min   stops a scripted run from one address
 *   `login:<ip>:<email>`     5 / 15 min   stops a targeted guess from one address
 *   `login:<email>`         50 / h SOFT   sees a distributed run — but only
 *                                         *delays* it, because a hard limit here
 *                                         would let anyone lock a victim out of
 *                                         their own account by failing to log in
 *                                         as them fifty times. `tests/security/
 *                                         rate-limit.test.ts` asserts exactly that.
 *
 * The per-IP bucket is skipped when `clientIp()` returned its `'local'`
 * sentinel outside production: with no proxy header every request in the
 * Playwright suite would share one bucket and the tenth test would fail.
 *
 * Timing: an unknown e-mail and an account with no password (Google-only) both
 * run a real bcrypt compare against a dummy hash (`verifyPassword` in
 * `lib/auth/password.ts`), so the three failure modes cost the same wall-clock
 * time and the response leaks nothing about which one it was.
 */

import {
  allowAllRateLimiter,
  RATE_LIMITS,
  SOFT_DELAY_MS,
  type RateLimiter,
} from "@/lib/security/rate-limit";

import { RateLimitedSignin } from "./errors";
import { needsRehash, hashPassword, verifyPassword } from "./password";
import { normalizeEmail, rateLimitKey } from "./tokens";

/** The subset of the session user that `authorize` hands to the `jwt` callback. */
export interface AuthorizedUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  locale: "fr" | "en";
  sessionVersion: number;
}

/** The row `authorize` reads — the session fields plus the hash it compares. */
export interface CredentialsUserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  locale: "fr" | "en";
  sessionVersion: number;
  passwordHash: string | null;
}

/**
 * The two statements this module makes, as a port rather than
 * `Pick<PrismaClient, 'user'>` — same reasoning as `SessionUserStore` in
 * `lib/auth/jwt.ts`: the real client satisfies it structurally, and a test does
 * not have to fake a twenty-method delegate to stub one lookup.
 */
export interface CredentialsUserStore {
  user: {
    findUnique(args: {
      where: { email: string };
      select: {
        id: true;
        email: true;
        name: true;
        image: true;
        locale: true;
        sessionVersion: true;
        passwordHash: true;
      };
    }): PromiseLike<CredentialsUserRow | null>;
    update(args: { where: { id: string }; data: { passwordHash: string } }): PromiseLike<unknown>;
  };
}

export interface AuthorizeDeps {
  prisma: CredentialsUserStore;
  rateLimiter: RateLimiter;
  /** `clientIp(request.headers)` in production; a fixture in tests. */
  ip: string;
  /** Whether the per-IP bucket applies to the `'local'` sentinel. */
  isProduction: boolean;
  /** Held request for a soft-bucket overflow; a spy in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Compare + rehash seams, so a test never pays bcrypt's cost. */
  verify?: typeof verifyPassword;
  hash?: typeof hashPassword;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Narrow the `Partial<Record<string, unknown>>` Auth.js hands to `authorize`. */
function readCredentials(credentials: unknown): { email: string; password: string } | null {
  if (typeof credentials !== "object" || credentials === null) return null;
  const { email, password } = credentials as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || typeof password !== "string") return null;
  if (email.length === 0 || email.length > 254 || password.length === 0) return null;
  return { email, password };
}

/**
 * Verify an e-mail + password pair.
 *
 * Returns the user on success and `null` on any failure Auth.js should report
 * as `CredentialsSignin`. It **throws** `RateLimitedSignin` for a full bucket —
 * the one failure the visitor is told something specific about.
 */
export async function authorizeCredentials(
  credentials: unknown,
  deps: AuthorizeDeps,
): Promise<AuthorizedUser | null> {
  const parsed = readCredentials(credentials);
  if (!parsed) return null;

  const email = normalizeEmail(parsed.email);
  const {
    prisma,
    rateLimiter,
    ip,
    isProduction,
    sleep = defaultSleep,
    verify = verifyPassword,
    hash = hashPassword,
  } = deps;

  // A loopback request with no proxy header is a developer on `next dev`. It does
  // NOT cover the e2e suite: that runs `next start`, where NODE_ENV is production,
  // so e2e gives each test its own `x-real-ip` instead (tests/e2e/_fixtures.ts).
  const ipLimiter = ip === "local" && !isProduction ? allowAllRateLimiter : rateLimiter;

  const ipKey = rateLimitKey("login", ip);
  const ipEmailKey = rateLimitKey("login", ip, email);
  const emailKey = rateLimitKey("login-email", email);

  const [byIp, byIpEmail] = await Promise.all([
    ipLimiter.consume(ipKey, RATE_LIMITS.loginPerIp),
    ipLimiter.consume(ipEmailKey, RATE_LIMITS.loginPerIpEmail),
  ]);
  if (!byIp.ok || !byIpEmail.ok) {
    throw new RateLimitedSignin(Math.max(byIp.retryAfterMs, byIpEmail.retryAfterMs));
  }

  // Soft: never refuses, only slows. See the header comment.
  const byEmail = await rateLimiter.consume(emailKey, RATE_LIMITS.loginPerEmail);
  if (!byEmail.ok) await sleep(SOFT_DELAY_MS);

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      locale: true,
      sessionVersion: true,
      passwordHash: true,
    },
  });

  // `verifyPassword(pw, null)` still runs a real compare against a dummy hash.
  const valid = await verify(parsed.password, user?.passwordHash ?? null);
  if (!user || !valid) return null;

  // One good sign-in clears the buckets that could have locked this visitor out.
  await Promise.all([rateLimiter.reset(ipKey), rateLimiter.reset(ipEmailKey)]);

  // An imported `$2a$` hash, or one written at a lower cost than today's, is
  // upgraded while we legitimately hold the plaintext.
  if (user.passwordHash && needsRehash(user.passwordHash)) {
    const passwordHash = await hash(parsed.password);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    locale: user.locale,
    sessionVersion: user.sessionVersion,
  };
}
