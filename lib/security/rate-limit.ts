/**
 * Rate limiting on the `AuthAttempt` table (§4.3).
 *
 * Why a table and not a map: a Vercel function shares no memory with the next
 * invocation, so an in-process counter limits nothing. Upstash was considered
 * and rejected for the MVP — a row in the database we already have works
 * everywhere, including `docker compose up`, and costs one statement per
 * attempt on a path that is by definition rare.
 *
 * Window shape: **fixed window with a reset**, not a leaky bucket. A key's
 * first attempt stamps `windowStart`; attempts inside `windowMs` increment
 * `count`; the first attempt after the window resets the row. The refusal
 * therefore lasts at most `windowMs` from the *first* attempt, which is what
 * `retryAfterMs` reports. `lockedUntil` records the same instant so an operator
 * reading the table can see at a glance which keys are shut.
 *
 * No address and no e-mail is stored: `key` is a salted SHA-256 digest
 * (`lib/auth/tokens.ts`).
 *
 * Everything is behind `RateLimiter`, so `lib/auth/authorize.ts` and the server
 * actions take it as a dependency and the tests drive a deterministic fake
 * instead of a clock.
 */

import type { PrismaClient } from "@/lib/generated/prisma/client";

export interface RateLimitOptions {
  /** Attempts allowed inside one window. The `max`-th is allowed; the next is not. */
  max: number;
  windowMs: number;
}

export interface RateLimitVerdict {
  ok: boolean;
  /** How long until this key is accepted again. `0` when `ok`. */
  retryAfterMs: number;
  /** Attempts recorded in the current window, this one included. */
  count: number;
}

export interface RateLimiter {
  consume(key: string, options: RateLimitOptions): Promise<RateLimitVerdict>;
  /** Forget a key — called after a successful sign-in so one good login clears the bucket. */
  reset(key: string): Promise<void>;
}

/** Just enough of the Prisma client to run the limiter; keeps the fake small. */
export type AuthAttemptStore = Pick<PrismaClient, "authAttempt">;

const ALLOWED: RateLimitVerdict = { ok: true, retryAfterMs: 0, count: 0 };

/**
 * The limiter used in production.
 *
 * `now` is injectable so a test can move time without sleeping.
 *
 * Concurrency: two simultaneous attempts on the same key can both read the same
 * `count` and write `count + 1` — the counter under-counts by one under a race.
 * That is acceptable here (the attacker gains at most one attempt per window and
 * still hits the ceiling), and the alternative — a serialisable transaction per
 * login attempt — is a much better denial-of-service target than the thing it
 * protects.
 */
export function createPrismaRateLimiter(
  db: AuthAttemptStore,
  now: () => number = Date.now,
): RateLimiter {
  return {
    async consume(key, { max, windowMs }) {
      const at = new Date(now());
      const existing = await db.authAttempt.findUnique({ where: { key } });

      const inWindow =
        existing !== null && at.getTime() - existing.windowStart.getTime() < windowMs;

      if (!inWindow) {
        // First attempt, or the previous window has expired: start a new one.
        await db.authAttempt.upsert({
          where: { key },
          create: { key, count: 1, windowStart: at, lockedUntil: null },
          update: { count: 1, windowStart: at, lockedUntil: null },
        });
        return { ok: true, retryAfterMs: 0, count: 1 };
      }

      const count = existing.count + 1;
      const windowEnds = existing.windowStart.getTime() + windowMs;
      const retryAfterMs = Math.max(0, windowEnds - at.getTime());
      const refused = count > max;

      await db.authAttempt.update({
        where: { key },
        data: { count, lockedUntil: refused ? new Date(windowEnds) : null },
      });

      return { ok: !refused, retryAfterMs: refused ? retryAfterMs : 0, count };
    },

    async reset(key) {
      await db.authAttempt.deleteMany({ where: { key } });
    },
  };
}

/**
 * A limiter that allows everything.
 *
 * Used where a bucket would be meaningless rather than absent — the per-IP
 * login bucket when the address is the `'local'` sentinel outside production
 * (see `lib/auth/authorize.ts`). Naming it makes that decision visible in a
 * stack trace instead of hiding behind an `if`.
 */
export const allowAllRateLimiter: RateLimiter = {
  consume: async () => ALLOWED,
  reset: async () => undefined,
};

/** The buckets the auth surface uses, in one place so the tests can assert them. */
export const RATE_LIMITS = {
  /** Per address: a scripted credential-stuffing run is stopped here. */
  loginPerIp: { max: 10, windowMs: 15 * 60_000 },
  /** Per address *and* account: a targeted guessing run is stopped sooner. */
  loginPerIpEmail: { max: 5, windowMs: 15 * 60_000 },
  /**
   * Per account, across addresses. Deliberately high and deliberately SOFT
   * (see `SOFT_DELAY_MS`): a hard limit here would let anyone lock a victim out
   * of their own account by failing to log in as them fifty times.
   */
  loginPerEmail: { max: 50, windowMs: 60 * 60_000 },
  signupPerIp: { max: 5, windowMs: 60 * 60_000 },
  passwordChangePerUser: { max: 5, windowMs: 60 * 60_000 },
  guestImportPerUser: { max: 3, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitOptions>;

/** How long a request that tripped a soft bucket is held before it answers. */
export const SOFT_DELAY_MS = 2_000;
