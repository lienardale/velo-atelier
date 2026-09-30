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

import { describe, expect, it } from "vitest";

import { isExpectedNotFoundLog } from "@/lib/db/log";

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
