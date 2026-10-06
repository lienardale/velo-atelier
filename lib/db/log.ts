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
 * key with no row yet makes BOTH statements match nothing, which is two
 * P2025s; a key whose window has expired makes the first one miss, which is
 * one; a key whose window is still open misses nothing (measured on PostgreSQL
 * with Prisma 7.10.0: 2, 1 and 0 `error` events for one `consume()`). That is
 * the limiter DECIDING, not failing (`orNull` reads it as "no row"), and it
 * happens on the first attempt of every rate-limit window. A first sign-in
 * consumes three fresh buckets (`lib/auth/authorize.ts`), so it wrote up to six
 * "records that were required but not found" to the server log (six events
 * measured for three fresh keys), on the exact path an operator most needs to
 * be able to read. The rule — drop the known miss, print everything else — is
 * recorded in CLAUDE.md, under "Contracts to respect": the **Prisma** entry's
 * "**Errors are EVENTS, not stdout**" paragraph.
 *
 * Deliberately NOT a general "ignore P2025" rule. The event carries no error
 * code (`{ timestamp, message, target }`), so the match is the pair: the
 * `<model>.<method>` that is allowed to miss, and the P2025 wording. Anything
 * else — a P2025 from another model, any other error on `authAttempt.update` —
 * is a real failure and still reaches the log.
 *
 * `event.message` is Prisma's own text, printed verbatim, and for a
 * `PrismaClientValidationError` it includes the call's arguments, so the line
 * must not be forwarded unredacted to a third-party sink — unchanged from
 * `log: ["error"]`, which printed the same message.
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

/**
 * The sentence the ENGINE wrote: the last non-empty line of the message.
 *
 * The marker is tested against this line, never against the whole message,
 * because the rest of the message is not always Prisma's. In production the
 * error format is `minimal` and there is nothing else in it:
 *
 *     Invalid `prisma.authAttempt.update()` invocation:
 *
 *
 *     An operation failed because … required but not found. No record was found for an update.
 *
 * Everywhere else (`next dev`, the test tiers) it is `colorless`, which opens
 * with the call site and the source lines above it:
 *
 *     Invalid `db.authAttempt.update()` invocation in
 *     …/lib/security/rate-limit.ts:91:26
 *
 *       88 };
 *       89 const bump = () =>
 *       90   orNull(
 *     → 91     db.authAttempt.update(
 *     An operation failed because … required but not found. No record was found for an update.
 *
 * Those lines are OUR source, and the ones directly above the limiter's
 * `update(` are exactly where someone would write the wording in a comment —
 * `rate-limit.ts` has none today. Matched against the whole message, such a
 * comment made a P1001 on `authAttempt.update` — the database unreachable —
 * read as the expected miss under `NODE_ENV=development` and `test`, which
 * drops the line (measured on Prisma 7.10.0 from a probe written that way,
 * against a refused port; `production` was not affected, its format has no
 * frame). Both shapes above are recorded from 7.10.0 against PostgreSQL, and
 * in both the engine's sentence is the last line.
 *
 * `trimEnd` is what makes it the last NON-EMPTY line: no trailing newline was
 * observed on 7.10.0, and one appearing must not turn the filter into a no-op.
 */
function engineSentence(message: string): string {
  const text = message.trimEnd();
  return text.slice(text.lastIndexOf("\n") + 1);
}

/** True when this error line is an expected conditional-update miss, not a failure. */
export function isExpectedNotFoundLog(event: PrismaErrorLogEvent): boolean {
  return (
    EXPECTED_NOT_FOUND.has(event.target) && NOT_FOUND_MESSAGE.test(engineSentence(event.message))
  );
}

/**
 * How a Prisma error line is recognisable in the server log.
 *
 * Exported because the tests grep for it. An assertion that matched on the
 * message alone would also pass against a line Prisma printed itself — which
 * is precisely the arrangement this change replaced. That is the SPEAKING
 * direction; for the silent one the prefix is the wrong filter for the same
 * reason turned around — Prisma's own line (`prisma:error`, on `console.log`)
 * does not carry it — so that test matches the wording alone, on every console
 * channel.
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
