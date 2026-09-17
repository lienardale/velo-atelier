/**
 * The limiter against real PostgreSQL row locking — the property the fake database
 * cannot prove: a burst of simultaneous attempts is counted exactly.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { createPrismaRateLimiter } from "@/lib/security/rate-limit";

beforeEach(async () => {
  await prisma.authAttempt.deleteMany({});
});

describe("createPrismaRateLimiter on PostgreSQL", () => {
  it("lets exactly `max` of a 25-request burst through, and records all 25", async () => {
    const bucket = createPrismaRateLimiter(prisma);
    const verdicts = await Promise.all(
      Array.from({ length: 25 }, () => bucket.consume("pg-burst", { max: 5, windowMs: 60_000 })),
    );
    expect(verdicts.filter((verdict) => verdict.ok)).toHaveLength(5);
    const row = await prisma.authAttempt.findUnique({ where: { key: "pg-burst" } });
    expect(row?.count).toBe(25);
  });

  it("reopens an expired window exactly once under a burst", async () => {
    let clock = Date.UTC(2026, 8, 17, 12, 0, 0);
    const bucket = createPrismaRateLimiter(prisma, () => clock);
    await bucket.consume("pg-boundary", { max: 5, windowMs: 60_000 });
    clock += 61_000;
    const verdicts = await Promise.all(
      Array.from({ length: 15 }, () => bucket.consume("pg-boundary", { max: 5, windowMs: 60_000 })),
    );
    expect(verdicts.filter((verdict) => verdict.ok)).toHaveLength(5);
  });
});
