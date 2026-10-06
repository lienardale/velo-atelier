/**
 * The shape of Prisma's `error` event, against the real driver.
 *
 * `lib/db/log.ts` drops one line from the server log, and it identifies it by
 * two literals: the client method `authAttempt.update` and P2025's wording
 * "required but not found", read on the message's last line. The event carries
 * no error code, so those two ARE the match — and neither is our string. A
 * Prisma upgrade that renames the target, rewords the message or moves the
 * sentence would silently turn the filter into a no-op (noise comes back:
 * survivable) or, worse, leave it matching something else.
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
      // failure — and, before `lib/db/log.ts`, two lines in the log.
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
    // WHERE in the message matters as much as the wording. This tier runs with
    // NODE_ENV=test, so Prisma's format is `colorless` and each message opens
    // with the caller's source (observed here: `…/lib/security/rate-limit.ts:91:26`
    // and `:99:26`, with the three lines above each call). `lib/db/log.ts`
    // therefore reads the last non-empty line only, and that rests on the
    // engine's sentence still being that line.
    for (const event of events) {
      expect(
        event.message.trimEnd().split("\n").at(-1),
        "Prisma no longer ends its message on the engine's sentence — lib/db/log.ts reads " +
          "only the last non-empty line and would stop recognising the miss",
      ).toMatch(/required but not found/);
    }
    expect(events.every(isExpectedNotFoundLog)).toBe(true);
  });
});

/**
 * The SHARED singleton: it still reports, and nothing reports the miss. This
 * is the wiring, not the rule.
 *
 * Everything above uses a client of its own, on purpose — it is asking what
 * Prisma emits, and the singleton's filter would hide the answer. That leaves
 * the singleton itself unexamined, and it is the half with the regressions in
 * it. There are two, and they point in opposite directions.
 *
 * It can go QUIET. Moving from `emit: "stdout"` to `emit: "event"` made our
 * own listener the only thing that prints a Prisma error, so deleting the
 * `$on` — or letting it return early — silences every database failure in
 * production while every test in the repository stays green. (Measured: with
 * the body replaced by `() => {}`, 43 real `[prisma]` lines disappeared from a
 * local run and all 389 integration tests still passed — "a CI run" in the
 * commit that recorded it, on a branch that had never run on GitHub Actions.)
 *
 * And the NOISE can come back with the listener untouched: put `"error"` back
 * in the client's `log`, or a `{ emit: "stdout", level: "error" }` beside the
 * event definition, and Prisma prints the limiter's miss itself again. That
 * line is not ours — `console.log("prisma:error", message)`, two arguments, no
 * `[prisma]` prefix — so a test that listens to `console.error` for our prefix
 * cannot see it, and the first version of the silent test here was exactly
 * that: it passed with the line this whole change removes back in the log.
 *
 * So this drives the real singleton, both ways, through the log the process
 * actually writes, with one recorder per direction. Speaking is OUR line:
 * `console.error`, our prefix, counted. Silence is anybody's line: every
 * console channel, every argument, no prefix. Both stay as crude as they can
 * be — anything cleverer would be testing a seam rather than the wiring.
 */
describe("the shared prisma singleton's error listener", () => {
  /** A bike that does not exist. `Bike.id` is a uuid, so this is well-typed and unmatched. */
  const ABSENT_BIKE = "00000000-0000-4000-8000-0000000000ff";

  /**
   * Lines the singleton's LISTENER wrote, in order: `console.error`, our prefix.
   *
   * The prefix is the point of the speaking direction (`PRISMA_LOG_PREFIX`): a
   * match on the message alone would be satisfied by a line Prisma printed.
   */
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

  /**
   * Every line ANYTHING wrote to the console, whoever wrote it and wherever.
   *
   * Four channels and no filter, because the line this exists to catch is not
   * one of ours. Each call is recorded as ALL of its arguments joined: Prisma's
   * own print passes its tag first and the message second, so a recorder that
   * read `call[0]` — as the one above rightly does for our single-argument
   * line — would hold `prisma:error` and never the wording.
   */
  async function consoleLinesDuring(act: () => Promise<void>): Promise<string[]> {
    const lines: string[] = [];
    const record = (...parts: unknown[]): void => {
      lines.push(parts.map(String).join(" "));
    };
    const spies = [
      vi.spyOn(console, "log").mockImplementation(record),
      vi.spyOn(console, "info").mockImplementation(record),
      vi.spyOn(console, "warn").mockImplementation(record),
      vi.spyOn(console, "error").mockImplementation(record),
    ];
    try {
      await act();
      // Same tick as above, for the same reason.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return lines;
    } finally {
      for (const spy of spies) spy.mockRestore();
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

  it("writes nothing about the rate limiter's expected miss, on any console channel", async () => {
    // "Drop the known miss, print everything else" — the first half, on the
    // real path rather than on the predicate: the real limiter, through the
    // singleton, on a key with no row. Both statements miss — the first test
    // of this file holds, for this very call on a client that keeps its
    // events, that Prisma still emits them — and that is the pair of lines
    // every fresh key used to put in the server log.
    const lines = await consoleLinesDuring(async () => {
      const verdict = await createPrismaRateLimiter(prisma).consume(KEY, {
        max: 5,
        windowMs: 60_000,
      });
      // `beforeEach` left no row for KEY, and `count: 1` says nothing was
      // incremented: the limiter went through both misses and created the row.
      expect(verdict).toEqual({ ok: true, retryAfterMs: 0, count: 1 });
    });

    expect(
      lines.filter((line) => /required but not found/.test(line)),
      "the limiter's expected miss is in the server log again — either lib/db/log.ts no longer " +
        'drops it, or lib/db/prisma.ts lets Prisma print errors itself ("error" or an ' +
        'emit: "stdout" definition for the error level)',
    ).toEqual([]);
  });
});
