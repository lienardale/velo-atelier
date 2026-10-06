/**
 * Which Prisma error lines are dropped, and — the half that matters — which
 * are not.
 *
 * `lib/db/prisma.ts` takes Prisma's error log as EVENTS and prints them
 * itself, so every line the server writes now passes through
 * `isExpectedNotFoundLog`. A filter on the path where real failures are
 * reported has to be narrow, and has to be pinned as narrow: a rule that
 * swallowed "P2025 anywhere", or "anything from authAttempt", would hide a
 * broken write on the auth surface exactly when someone is reading the log to
 * find it.
 *
 * The three message constants below are not invented. Each is what Prisma
 * 7.10.0 emitted against PostgreSQL (or, for the unreachable database, against
 * a refused port), with the absolute path shortened — in the two formats the
 * client has without an `errorFormat` option: `minimal` when `NODE_ENV` is
 * `production`, `colorless` otherwise, which adds the call site and the source
 * above it.
 */

import { describe, expect, it, vi } from "vitest";

import { isExpectedNotFoundLog, PRISMA_LOG_PREFIX, reportPrismaError } from "@/lib/db/log";

/** The wording Prisma's P2025 carries for an update; the event itself has no error code. */
const NOT_FOUND_SENTENCE =
  "An operation failed because it depends on one or more records that were required but not found. " +
  "No record was found for an update.";

/** The limiter's miss as production prints it (`minimal`): the sentence and nothing of ours. */
const NOT_FOUND = "\nInvalid `prisma.authAttempt.update()` invocation:\n\n\n" + NOT_FOUND_SENTENCE;

/** The same miss everywhere else (`colorless`): the sentence comes after the caller's source. */
const NOT_FOUND_WITH_FRAME =
  "\nInvalid `db.authAttempt.update()` invocation in\n" +
  "/app/lib/security/rate-limit.ts:91:26\n\n" +
  "  88 };\n" +
  "  89 const bump = () =>\n" +
  "  90   orNull(\n" +
  "→ 91     db.authAttempt.update(\n" +
  NOT_FOUND_SENTENCE;

/**
 * NOT a miss: the database is unreachable (P1001), and the call sits under a
 * comment that quotes P2025's wording — recorded from a probe written that
 * way. The wording is in the message, on the caller's line 23; the engine's
 * sentence, the last line, is a different error altogether.
 */
const UNREACHABLE_UNDER_A_COMMENT =
  "\nInvalid `client.authAttempt.update()` invocation in\n" +
  "/scratch/probe-frame.ts:24:30\n\n" +
  "  21 let code: unknown;\n" +
  "  22 try {\n" +
  '  23   // a P2025 ("required but not found") here is the limiter\'s verdict, not a failure\n' +
  "→ 24   await client.authAttempt.update(\n" +
  "Can't reach database server at 127.0.0.1:1";

describe("isExpectedNotFoundLog", () => {
  it("drops the rate limiter's conditional-update miss, in both of Prisma's formats", () => {
    // `createPrismaRateLimiter` counts with a single conditional UPDATE and
    // reads "no row" as its answer (`orNull`). Both statements — the increment
    // and the reopen — report the same client method, so one entry covers the
    // first attempt of every fresh key.
    expect(isExpectedNotFoundLog({ target: "authAttempt.update", message: NOT_FOUND })).toBe(true);
    expect(
      isExpectedNotFoundLog({ target: "authAttempt.update", message: NOT_FOUND_WITH_FRAME }),
    ).toBe(true);
  });

  it("keeps any other error from the same model", () => {
    expect(
      isExpectedNotFoundLog({
        target: "authAttempt.update",
        message: "Timed out fetching a new connection from the connection pool.",
      }),
    ).toBe(false);
  });

  it("keeps a P2025 from a different call site", () => {
    // Nothing else in the codebase treats a missing row as a decision, so a
    // "required but not found" anywhere else is a real failure.
    for (const target of ["bike.update", "checkup.update", "authAttempt.delete"]) {
      expect(isExpectedNotFoundLog({ target, message: NOT_FOUND })).toBe(false);
      expect(isExpectedNotFoundLog({ target, message: NOT_FOUND_WITH_FRAME })).toBe(false);
    }
  });

  it("reads the engine's sentence, not the caller's source above it", () => {
    // Outside production the message embeds the lines above the call, and the
    // lines above the limiter's `update(` are where a comment about P2025
    // belongs. A marker tested against the whole message took this for the
    // expected miss (measured under `NODE_ENV=development` and `test`): the
    // auth surface with no database, and nothing in the log. No such comment
    // sits above the limiter's calls today — this is what keeps one harmless.
    expect(UNREACHABLE_UNDER_A_COMMENT).toMatch(/required but not found/);
    expect(
      isExpectedNotFoundLog({
        target: "authAttempt.update",
        message: UNREACHABLE_UNDER_A_COMMENT,
      }),
    ).toBe(false);
  });

  it("means the last NON-EMPTY line", () => {
    // Not observed from Prisma 7.10.0, whose message ends on the sentence. It
    // is what keeps a trailing newline from turning the filter into a no-op —
    // and it must not become a way back to the whole message either.
    for (const tail of ["\n", "\n\n", "\n  \n"]) {
      expect(
        isExpectedNotFoundLog({ target: "authAttempt.update", message: NOT_FOUND + tail }),
      ).toBe(true);
      expect(
        isExpectedNotFoundLog({
          target: "authAttempt.update",
          message: UNREACHABLE_UNDER_A_COMMENT + tail,
        }),
      ).toBe(false);
    }
  });
});

/**
 * The half of the rule that SPEAKS.
 *
 * The predicate above decides; this decides nothing and is the only reason a
 * Prisma error appears in the log at all, now that the client emits events
 * instead of writing stdout itself. A test suite that only exercised
 * `isExpectedNotFoundLog` would stay green with every real error swallowed,
 * so the printing is asserted here, and the WIRING — that
 * `lib/db/prisma.ts`'s singleton still calls this — in
 * `tests/integration/prisma-error-log.test.ts` against the real driver.
 */
describe("reportPrismaError", () => {
  it("says nothing about the expected miss", () => {
    const log = vi.fn();
    reportPrismaError({ target: "authAttempt.update", message: NOT_FOUND }, log);
    reportPrismaError({ target: "authAttempt.update", message: NOT_FOUND_WITH_FRAME }, log);
    expect(log).not.toHaveBeenCalled();
  });

  it("prints every other error once, with its target and its message", () => {
    const log = vi.fn();
    reportPrismaError({ target: "bike.update", message: NOT_FOUND }, log);

    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0] as string;
    // The prefix is what makes the line greppable in a server log; the target
    // is what says WHERE it came from. A line missing either is unactionable
    // at 2 a.m., which is the only time anyone reads it.
    expect(line.startsWith(PRISMA_LOG_PREFIX)).toBe(true);
    expect(line).toContain("bike.update");
    expect(line).toContain("required but not found");
  });

  it("prints a non-P2025 failure on the model that is allowed to miss", () => {
    // The filter is a PAIR (target + wording). A pool timeout on
    // `authAttempt.update` is the auth surface breaking, and must be loud.
    const log = vi.fn();
    reportPrismaError(
      { target: "authAttempt.update", message: "Timed out fetching a new connection" },
      log,
    );
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("prints that failure even when the source frame quotes P2025's wording", () => {
    // The same case as "reads the engine's sentence" above, held on the half
    // that speaks: the line reaches the log whole, frame and all.
    const log = vi.fn();
    reportPrismaError({ target: "authAttempt.update", message: UNREACHABLE_UNDER_A_COMMENT }, log);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe(
      `${PRISMA_LOG_PREFIX} authAttempt.update: ${UNREACHABLE_UNDER_A_COMMENT}`,
    );
  });

  it("defaults to console.error, read at call time", () => {
    // `lib/db/prisma.ts` passes no second argument, so this default IS the
    // production behaviour — the one path where a mistake is invisible.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      reportPrismaError({ target: "bike.update", message: NOT_FOUND });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain(`${PRISMA_LOG_PREFIX} bike.update:`);
    } finally {
      spy.mockRestore();
    }
  });
});
