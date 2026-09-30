/**
 * The shape of Prisma's `error` event, against the real driver.
 *
 * `lib/db/log.ts` drops one line from the server log, and it identifies it by
 * two literals: the client method `authAttempt.update` and P2025's wording
 * "required but not found". The event carries no error code, so those two ARE
 * the match — and neither is our string. A Prisma upgrade that renames the
 * target, or rewords the message, would silently turn the filter into a no-op
 * (noise comes back: survivable) or, worse, leave it matching something else.
 *
 * Nothing below the integration tier can catch that: the fake database raises
 * the errors we tell it to. So this file drives the real limiter against real
 * PostgreSQL through a client of its own — one that keeps the events instead
 * of filtering them — and checks that what arrives is exactly what
 * `isExpectedNotFoundLog` claims to recognise.
 *
 * It also pins the premise the whole change rests on: Prisma logs the error at
 * the THROW site, so the line appears even though `createPrismaRateLimiter`
 * catches it and answers normally. If `events` ever comes back empty, the
 * filter has become unnecessary — delete it rather than keep a dead rule.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDatabaseUrls } from "@/lib/db/env";
import { isExpectedNotFoundLog, type PrismaErrorLogEvent } from "@/lib/db/log";
import { prisma } from "@/lib/db/prisma";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { createPrismaRateLimiter } from "@/lib/security/rate-limit";

const KEY = "prisma-error-log-shape";

beforeEach(async () => {
  await prisma.authAttempt.deleteMany({ where: { key: KEY } });
});

afterEach(async () => {
  await prisma.authAttempt.deleteMany({ where: { key: KEY } });
});

describe("the Prisma error event lib/db/log.ts filters", () => {
  it("is emitted by the limiter's first attempt, and is the one we recognise", async () => {
    const events: PrismaErrorLogEvent[] = [];
    const { pooled } = getDatabaseUrls();
    // A client of this file's own, so the shared singleton's listener (which
    // drops these) cannot hide what Prisma actually emitted.
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: pooled, max: 1 }),
      log: [{ emit: "event", level: "error" }],
    });
    client.$on("error", (event) => events.push(event));

    try {
      // No row for this key yet: the increment misses, the reopen misses, and
      // the limiter creates the row and answers `ok`. Two decisions, no
      // failure — and, as it stands, two lines in the log.
      const verdict = await createPrismaRateLimiter(client).consume(KEY, {
        max: 5,
        windowMs: 60_000,
      });
      expect(verdict).toEqual({ ok: true, retryAfterMs: 0, count: 1 });
    } finally {
      await client.$disconnect();
    }

    expect(
      events.length,
      "Prisma no longer logs the conditional-update miss — lib/db/log.ts's filter is dead code",
    ).toBeGreaterThan(0);
    expect(events.map((event) => event.target)).toEqual(events.map(() => "authAttempt.update"));
    expect(events[0].message).toMatch(/required but not found/);
    expect(events.every(isExpectedNotFoundLog)).toBe(true);
  });
});
