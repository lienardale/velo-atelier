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
 */

import { describe, expect, it, vi } from "vitest";

import { isExpectedNotFoundLog, PRISMA_LOG_PREFIX, reportPrismaError } from "@/lib/db/log";

/** The wording Prisma's P2025 carries; the event itself has no error code. */
const NOT_FOUND =
  "\nInvalid `prisma.authAttempt.update()` invocation:\n\n" +
  "An operation failed because it depends on one or more records that were required but not found. " +
  "No record was found for an update.";

describe("isExpectedNotFoundLog", () => {
  it("drops the rate limiter's conditional-update miss", () => {
    // `createPrismaRateLimiter` counts with a single conditional UPDATE and
    // reads "no row" as its answer (`orNull`). Both statements — the increment
    // and the reopen — report the same client method, so one entry covers the
    // first attempt of every fresh key.
    expect(isExpectedNotFoundLog({ target: "authAttempt.update", message: NOT_FOUND })).toBe(true);
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
