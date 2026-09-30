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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabaseUrls } from "@/lib/db/env";
import { isExpectedNotFoundLog, PRISMA_LOG_PREFIX, type PrismaErrorLogEvent } from "@/lib/db/log";
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

/**
 * The SHARED singleton still reports. This is the wiring, not the rule.
 *
 * Everything above uses a client of its own, on purpose — it is asking what
 * Prisma emits, and the singleton's filter would hide the answer. That leaves
 * the singleton itself unexamined, and it is the half with the regression in
 * it: moving from `emit: "stdout"` to `emit: "event"` made our own listener
 * the only thing that prints a Prisma error, so deleting the `$on` — or
 * letting it return early — silences every database failure in production
 * while every test in the repository stays green. (Measured: with the body
 * replaced by `() => {}`, 43 real `[prisma]` lines disappeared from a CI run
 * and all 389 integration tests still passed.)
 *
 * So this drives the real singleton, both ways, through the log it actually
 * writes. It is deliberately the crudest possible assertion — spy on
 * `console.error`, count the lines — because anything cleverer would be
 * testing a seam rather than the wiring.
 */
describe("the shared prisma singleton's error listener", () => {
  /** A bike that does not exist. `Bike.id` is a uuid, so this is well-typed and unmatched. */
  const ABSENT_BIKE = "00000000-0000-4000-8000-0000000000ff";

  /** Lines the singleton's listener wrote, in order. */
  async function prismaLinesDuring(act: () => Promise<void>): Promise<string[]> {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act();
      // The event is emitted synchronously at the throw site, so it has
      // already run by the time the rejection is caught; a tick costs nothing
      // and removes the ordering question entirely.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return spy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith(PRISMA_LOG_PREFIX));
    } finally {
      spy.mockRestore();
    }
  }

  it("prints a real failure, with the target that caused it", async () => {
    const lines = await prismaLinesDuring(async () => {
      // P2025 from a model that is NOT allowed to miss: a real failure as far
      // as the filter is concerned, and nothing is written either way.
      await expect(
        prisma.bike.update({ where: { id: ABSENT_BIKE }, data: { name: "never written" } }),
      ).rejects.toThrow();
    });

    expect(
      lines,
      "the singleton no longer reports Prisma errors — lib/db/prisma.ts's $on is gone or silent, " +
        "and a database failure in production would now be invisible",
    ).toHaveLength(1);
    expect(lines[0]).toContain("bike.update");
    expect(lines[0]).toContain("required but not found");
  });

  it("stays silent for the rate limiter's expected miss", async () => {
    // Ruling 3's own subject, measured on the singleton rather than on the
    // predicate: this is the line that used to appear on every first sign-in.
    const lines = await prismaLinesDuring(async () => {
      await expect(
        prisma.authAttempt.update({ where: { key: KEY }, data: { count: 1 } }),
      ).rejects.toThrow();
    });

    expect(lines).toEqual([]);
  });
});
