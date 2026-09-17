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

import { isNotFoundError, isUniqueViolation } from "@/lib/db/errors";
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
 * Concurrency: every count change is a single conditional `UPDATE` (increment
 * inside the window, or reopen an expired one), so concurrent attempts serialise on
 * the row lock instead of reading the same count. An earlier read-then-write version
 * let a burst of N guesses cost one unit — not "one extra attempt", as it claimed
 * (W1 security re-review, `.debug/003`). No transaction is needed, so a login attempt
 * still costs a few single-row statements, not a serialisable transaction.
 */
export function createPrismaRateLimiter(
  db: AuthAttemptStore,
  now: () => number = Date.now,
): RateLimiter {
  return {
    async consume(key, { max, windowMs }) {
      const at = new Date(now());
      const windowFloor = new Date(at.getTime() - windowMs);
      const returned = { count: true, windowStart: true, lockedUntil: true } as const;

      // Each count change is ONE conditional UPDATE that returns the row it wrote, and
      // the verdict is taken on THAT count. A read-then-write version let a concurrent
      // burst read the same count (N guesses cost one unit); a version that updated
      // atomically but decided on a separate read refused almost the whole burst. In
      // Postgres an UPDATE takes the row lock and re-checks its WHERE against the row it
      // then sees, so concurrent requests serialise and each gets its own position.
      const orNull = async <T>(statement: Promise<T>): Promise<T | null> => {
        try {
          return await statement;
        } catch (error) {
          if (isNotFoundError(error)) return null;
          throw error;
        }
      };
      const bump = () =>
        orNull(
          db.authAttempt.update({
            where: { key, windowStart: { gt: windowFloor } },
            data: { count: { increment: 1 } },
            select: returned,
          }),
        );
      const reopen = () =>
        orNull(
          db.authAttempt.update({
            where: { key, windowStart: { lte: windowFloor } },
            data: { count: 1, windowStart: at, lockedUntil: null },
            select: returned,
          }),
        );

      let row = (await bump()) ?? (await reopen());
      if (!row) {
        try {
          row = await db.authAttempt.create({
            data: { key, count: 1, windowStart: at, lockedUntil: null },
            select: returned,
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          // Another request created the row between the statements: count inside it.
          row = (await bump()) ?? (await reopen());
        }
      }
      if (!row) return { ok: true, retryAfterMs: 0, count: 1 }; // reset() ran concurrently

      const windowEnds = row.windowStart.getTime() + windowMs;
      const refused = row.count > max;
      if (refused && row.lockedUntil?.getTime() !== windowEnds) {
        await db.authAttempt.updateMany({
          where: { key },
          data: { lockedUntil: new Date(windowEnds) },
        });
      }
      return {
        ok: !refused,
        retryAfterMs: refused ? Math.max(0, windowEnds - at.getTime()) : 0,
        count: row.count,
      };
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
