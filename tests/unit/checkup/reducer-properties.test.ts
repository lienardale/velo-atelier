/**
 * The reducer's invariants over 1 000 random event sequences (§5.8 AC3).
 *
 * A checkup is a small state machine that a visitor drives with their thumbs,
 * out of order, on a flaky connection, with a browser that restores a tab from
 * three days ago. The example tests say what each event does; this says what is
 * true however they arrive:
 *
 *   - the cursor is always a position in the plan, or the summary — never
 *     `-1`, never past the end, never `NaN`;
 *   - every stored answer, symptom and note belongs to a planned step, and
 *     every symptom is one the step offers;
 *   - `completedAt` is set only when every question has a verdict.
 *
 * `fast-check` generates the events from the plan itself (plus keys that are
 * NOT in it), so the shrinker reports the shortest sequence that breaks one.
 *
 * Everything heavy is built at module scope: the arbitraries and the plan are
 * import-time work, not test-body work (`.debug/009`).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { reduce } from "@/lib/checkup/reducer";
import type { CheckupEvent, CheckupState } from "@/lib/checkup/types";
import { makeState, threeStepPlan } from "@/tests/_helpers/checkup";

const PLAN = threeStepPlan();
const KEYS = PLAN.map((step) => step.key);
const REASONS = [...new Set(PLAN.flatMap((step) => step.ko.map((k) => k.reasonKey)))];
const UNKNOWN_KEYS = ["check-nothing#at-all", "", "../../etc/passwd"];

const anyKey = fc.constantFrom(...KEYS, ...UNKNOWN_KEYS);

const anyEvent: fc.Arbitrary<CheckupEvent> = fc.oneof(
  fc.record({
    type: fc.constant("ANSWER" as const),
    key: anyKey,
    result: fc.constantFrom("ok" as const, "ko" as const),
    symptoms: fc.array(fc.constantFrom(...REASONS, "made-up-reason"), { maxLength: 4 }),
    notes: fc.string({ maxLength: 40 }),
  }),
  fc.record({ type: fc.constant("SKIP" as const), key: anyKey }),
  fc.record({ type: fc.constant("BACK" as const) }),
  fc.record({ type: fc.constant("JUMP" as const), key: anyKey }),
  fc.record({ type: fc.constant("FINISH" as const) }),
  fc.record({
    type: fc.constant("TOOL_MISSING" as const),
    toolId: fc.constantFrom("chain-checker" as const, "steel-ruler" as const),
    missing: fc.boolean(),
  }),
);

const sequences = fc.array(anyEvent, { maxLength: 24 });

/** Every invariant, as a list of what is wrong — so a failure names it. */
function violations(state: CheckupState): string[] {
  const problems: string[] = [];
  const planned = new Set(state.steps.map((step) => step.key));

  if (!Number.isInteger(state.cursor) || state.cursor < 0 || state.cursor > state.steps.length) {
    problems.push(`cursor ${state.cursor} is outside [0, ${state.steps.length}]`);
  }
  for (const key of Object.keys(state.answers)) {
    if (!planned.has(key)) problems.push(`answer for unplanned step ${key}`);
  }
  for (const [key, reasons] of Object.entries(state.symptoms)) {
    const step = state.steps.find((candidate) => candidate.key === key);
    if (step === undefined) {
      problems.push(`symptoms for unplanned step ${key}`);
      continue;
    }
    const offered = new Set(step.ko.map((consequence) => consequence.reasonKey));
    for (const reason of reasons) {
      if (!offered.has(reason)) problems.push(`${key} kept a symptom it never offered: ${reason}`);
    }
  }
  for (const key of Object.keys(state.notes)) {
    if (!planned.has(key)) problems.push(`note for unplanned step ${key}`);
  }
  const answered = state.steps.every((step) => Object.hasOwn(state.answers, step.key));
  if (state.completedAt !== undefined && !answered) {
    problems.push("completedAt is set with a question still open");
  }
  return problems;
}

describe("the reducer over random sequences", () => {
  it("keeps the cursor in [0, n] and every answer on a planned step", () => {
    const found = new Set<string>();
    fc.assert(
      fc.property(sequences, (events) => {
        const state = events.reduce<CheckupState>(
          (current, event) => reduce(current, event),
          makeState(PLAN),
        );
        // One `expect` per 1 000 runs, not one per event: `expect` is expensive
        // under v8 coverage and CI is ~2.9× this machine (`.debug/009`).
        for (const problem of violations(state)) found.add(problem);
        return found.size === 0;
      }),
      { numRuns: 1000 },
    );
    expect([...found]).toEqual([]);
  });

  it("never loses a verdict that was not overwritten", () => {
    const lost: string[] = [];
    fc.assert(
      fc.property(sequences, (events) => {
        let state = makeState(PLAN);
        const expected = new Map<string, string>();
        for (const event of events) {
          const before = state;
          state = reduce(state, event);
          if (state === before) continue;
          if (event.type === "ANSWER" && KEYS.includes(event.key)) {
            expected.set(event.key, event.result);
          } else if (event.type === "SKIP" && KEYS.includes(event.key)) {
            const step = PLAN.find((candidate) => candidate.key === event.key);
            if (step?.skippable === true) expected.set(event.key, "skipped");
          }
        }
        for (const [key, verdict] of expected) {
          // eslint-disable-next-line security/detect-object-injection -- `key` comes from the plan
          if (state.answers[key] !== verdict) lost.push(`${key}: ${verdict}`);
        }
        return lost.length === 0;
      }),
      { numRuns: 1000 },
    );
    expect(lost).toEqual([]);
  });
});
