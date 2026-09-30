/**
 * Which Prisma `error` log events are noise, and which are failures.
 *
 * Prisma logs an error where it THROWS, not where the throw is handled: the
 * client emits the event inside `handleAndLogRequestError` before the promise
 * rejects (verified in `@prisma/client/runtime/client.js`), so a `try/catch`
 * downstream cannot prevent the line. With `log: ["error"]` (emit: stdout)
 * that line is written by the client itself and there is no seam at all — the
 * only way to filter is to take the events (`{ emit: "event", level: "error" }`)
 * and decide here.
 *
 * What was being printed: `lib/security/rate-limit.ts` counts an attempt with a
 * single conditional `UPDATE` — "increment inside the window" then "reopen an
 * expired one" — and takes the verdict on the row that statement returned. A
 * key with no row yet, or a key whose window is still open, makes one of those
 * two match nothing, which is a P2025. That is the limiter DECIDING, not
 * failing (`orNull` reads it as "no row"), and it happens on the first login
 * attempt of every fresh key: one "records that were required but not found"
 * per sign-in in the server log, on the exact path an operator most needs to be
 * able to read. `.debug/` has the W5 ruling: drop the known miss, print
 * everything else.
 *
 * Deliberately NOT a general "ignore P2025" rule. The event carries no error
 * code (`{ timestamp, message, target }`), so the match is the pair: the
 * `<model>.<method>` that is allowed to miss, and the P2025 wording. Anything
 * else — a P2025 from another model, any other error on `authAttempt.update` —
 * is a real failure and still reaches the log.
 */

/** The shape Prisma emits for `level: "error"`. Structural: no import from the generated client. */
export interface PrismaErrorLogEvent {
  readonly message: string;
  /** `<model>.<method>`, e.g. `authAttempt.update`. Prisma's `clientMethod`. */
  readonly target: string;
}

/**
 * Client methods whose "record not found" is a decision the caller makes.
 *
 * Both of `createPrismaRateLimiter`'s conditional updates report this target,
 * so one entry covers `bump()` and `reopen()`. Adding to this set means
 * claiming that EVERY P2025 from that call site is expected — check the call
 * site handles it (`isNotFoundError`, `lib/db/errors.ts`) before you do.
 */
const EXPECTED_NOT_FOUND: ReadonlySet<string> = new Set(["authAttempt.update"]);

/** P2025's wording. The event has no `code` field, so the message is the only marker. */
const NOT_FOUND_MESSAGE = /required but not found/;

/** True when this error line is an expected conditional-update miss, not a failure. */
export function isExpectedNotFoundLog(event: PrismaErrorLogEvent): boolean {
  return EXPECTED_NOT_FOUND.has(event.target) && NOT_FOUND_MESSAGE.test(event.message);
}

/**
 * How a Prisma error line is recognisable in the server log.
 *
 * Exported because the tests grep for it. An assertion that matched on the
 * message alone would also pass against a line Prisma printed itself — which
 * is precisely the arrangement this change replaced.
 */
export const PRISMA_LOG_PREFIX = "[prisma]";

/**
 * Print one Prisma error line, unless it is the expected miss above.
 *
 * This is the entire body of the singleton's `error` listener, extracted so
 * the half of the rule that SPEAKS has a subject a test can hold.
 *
 * It matters more than an extracted callback usually would. Under
 * `emit: "stdout"` Prisma printed its own errors and nothing we wrote could
 * lose one. Under `emit: "event"` this function is the only thing that prints
 * a Prisma error at all: short-circuit it, or drop the `$on` in
 * `lib/db/prisma.ts`, and a genuine failure leaves no trace in the server log
 * — silently, on the surface an operator reads when the site is down, on the
 * change whose whole purpose is that those logs stay readable.
 *
 * Both directions are pinned here (`tests/unit/db/log.test.ts`), and that
 * `lib/db/prisma.ts` is actually WIRED to it is pinned separately against the
 * real driver (`tests/integration/prisma-error-log.test.ts`): a unit test of
 * this function alone stays green with the listener silenced, which is the
 * regression that matters.
 *
 * @param log seam for the test. A default parameter is evaluated per call, so
 *   a `vi.spyOn(console, "error")` installed long after this module loaded is
 *   still the function that runs.
 */
export function reportPrismaError(
  event: PrismaErrorLogEvent,
  log: (line: string) => void = console.error,
): void {
  if (isExpectedNotFoundLog(event)) return;
  log(`${PRISMA_LOG_PREFIX} ${event.target}: ${event.message}`);
}
