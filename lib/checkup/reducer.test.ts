/**
 * The reducer (§5.4), event by event.
 *
 * The property test (1 000 random sequences, §5.8 AC3) lives in
 * `tests/unit/checkup/reducer-properties.test.ts`; this file pins the
 * individual rules, including every "changes nothing" path — those are the ones
 * a refactor breaks silently, and they are asserted by object identity.
 */
import { describe, expect, it } from "vitest";

import { makeState, makeStep, threeStepPlan } from "@/tests/_helpers/checkup";

import {
  allAnswered,
  createCheckupState,
  indexOfStep,
  MAX_NOTE_LENGTH,
  MAX_SYMPTOMS,
  missingToolSet,
  reduce,
  reduceAll,
} from "./reducer";
import type { CheckupEvent } from "./types";

const PLAN = threeStepPlan();
const [PADS, CALIPER, CHAIN] = PLAN;
const AT = () => new Date("2026-09-19T09:30:00.000Z");

describe("createCheckupState", () => {
  it("starts on the first question with nothing answered", () => {
    const state = makeState(PLAN);
    expect(state).toMatchObject({
      cursor: 0,
      answers: {},
      symptoms: {},
      notes: {},
      toolsMissing: [],
      version: 1,
    });
  });

  it("defaults startedAt to now", () => {
    const before = Date.now();
    const state = createCheckupState({
      id: "11111111-1111-4111-8111-111111111111",
      bikeRef: { kind: "local" },
      scope: { kind: "full" },
      locale: "en",
      steps: PLAN,
      contentVersion: "v",
    });
    expect(new Date(state.startedAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("indexOfStep / allAnswered", () => {
  it("finds a step and reports a missing one as -1", () => {
    expect(indexOfStep(PLAN, CHAIN.key)).toBe(2);
    expect(indexOfStep(PLAN, "check-nothing#at-all")).toBe(-1);
  });

  it("is answered only once every question has a verdict", () => {
    const state = makeState(PLAN, { answers: { [PADS.key]: "ok" } });
    expect(allAnswered(state)).toBe(false);
    expect(
      allAnswered(
        makeState(PLAN, {
          answers: { [PADS.key]: "ok", [CALIPER.key]: "skipped", [CHAIN.key]: "ko" },
        }),
      ),
    ).toBe(true);
  });
});

describe("ANSWER", () => {
  it("records OK and moves on", () => {
    const next = reduce(makeState(PLAN), { type: "ANSWER", key: PADS.key, result: "ok" });
    expect(next.answers).toEqual({ [PADS.key]: "ok" });
    expect(next.cursor).toBe(1);
  });

  it("records KO but STAYS until a symptom is picked", () => {
    const ko = reduce(makeState(PLAN), { type: "ANSWER", key: PADS.key, result: "ko" });
    expect(ko.answers[PADS.key]).toBe("ko");
    expect(ko.symptoms).toEqual({});
    expect(ko.cursor).toBe(0);

    const picked = reduce(ko, {
      type: "ANSWER",
      key: PADS.key,
      result: "ko",
      symptoms: ["pad-worn"],
    });
    expect(picked.symptoms).toEqual({ [PADS.key]: ["pad-worn"] });
    expect(picked.cursor).toBe(1);
  });

  it("keeps only the symptoms the step offers, deduplicated and capped", () => {
    const next = reduce(makeState(PLAN), {
      type: "ANSWER",
      key: CHAIN.key,
      result: "ko",
      symptoms: ["chain-dirty", "chain-dirty", "made-up", "chain-elongation"],
    });
    expect(next.symptoms[CHAIN.key]).toEqual(["chain-dirty", "chain-elongation"]);
  });

  it("stops at MAX_SYMPTOMS", () => {
    const reasons = Array.from({ length: MAX_SYMPTOMS + 3 }, (_, index) => `reason-${index}`);
    const step = makeStep({
      stepId: "many",
      ko: reasons.map((reasonKey) => ({
        action: "replace" as const,
        partId: "chain",
        reasonKey,
        guideSlug: "replace-chain",
      })),
    });
    const next = reduce(makeState([step]), {
      type: "ANSWER",
      key: step.key,
      result: "ko",
      symptoms: reasons,
    });
    expect(next.symptoms[step.key]).toHaveLength(MAX_SYMPTOMS);
  });

  it("clears the symptoms when the verdict flips back to OK", () => {
    const ko = reduce(makeState(PLAN), {
      type: "ANSWER",
      key: PADS.key,
      result: "ko",
      symptoms: ["pad-worn"],
    });
    const ok = reduce(ko, { type: "ANSWER", key: PADS.key, result: "ok" });
    expect(ok.symptoms).toEqual({});
  });

  it("trims and caps a note, and an emptied note is removed", () => {
    const withNote = reduce(makeState(PLAN), {
      type: "ANSWER",
      key: PADS.key,
      result: "ok",
      notes: `  ${"x".repeat(MAX_NOTE_LENGTH + 50)}  `,
    });
    expect(withNote.notes[PADS.key]).toHaveLength(MAX_NOTE_LENGTH);

    const cleared = reduce(withNote, {
      type: "ANSWER",
      key: PADS.key,
      result: "ok",
      notes: "   ",
    });
    expect(cleared.notes).toEqual({});
  });

  it("leaves the notes untouched when the event carries none", () => {
    const withNote = reduce(makeState(PLAN), {
      type: "ANSWER",
      key: PADS.key,
      result: "ok",
      notes: "ça siffle",
    });
    const again = reduce(withNote, { type: "ANSWER", key: PADS.key, result: "ko" });
    expect(again.notes).toEqual({ [PADS.key]: "ça siffle" });
  });

  it("does not move the cursor when the answered step is not the current one", () => {
    const state = makeState(PLAN, { cursor: 2 });
    expect(reduce(state, { type: "ANSWER", key: PADS.key, result: "ok" }).cursor).toBe(2);
  });

  it("re-opens a finished checkup", () => {
    const finished = makeState(PLAN, {
      answers: { [PADS.key]: "ok", [CALIPER.key]: "ok", [CHAIN.key]: "ok" },
      cursor: 3,
      completedAt: "2026-09-19T09:00:00.000Z",
    });
    expect(
      reduce(finished, { type: "ANSWER", key: PADS.key, result: "ok" }).completedAt,
    ).toBeUndefined();
  });

  it("ignores a key that is not in the plan", () => {
    const state = makeState(PLAN);
    expect(reduce(state, { type: "ANSWER", key: "check-nothing#at-all", result: "ok" })).toBe(
      state,
    );
  });
});

describe("SKIP", () => {
  it("records a skip and moves on", () => {
    const next = reduce(makeState(PLAN), { type: "SKIP", key: PADS.key });
    expect(next.answers).toEqual({ [PADS.key]: "skipped" });
    expect(next.cursor).toBe(1);
  });

  it("refuses a step the author marked unskippable", () => {
    const state = makeState(PLAN, { cursor: 2 });
    expect(reduce(state, { type: "SKIP", key: CHAIN.key })).toBe(state);
  });

  it("ignores a key that is not in the plan", () => {
    const state = makeState(PLAN);
    expect(reduce(state, { type: "SKIP", key: "check-nothing#at-all" })).toBe(state);
  });

  it("drops the symptoms of a step that is skipped after a KO", () => {
    const ko = reduce(makeState(PLAN), {
      type: "ANSWER",
      key: PADS.key,
      result: "ko",
      symptoms: ["pad-worn"],
    });
    expect(reduce(ko, { type: "SKIP", key: PADS.key }).symptoms).toEqual({});
  });
});

describe("BACK and JUMP", () => {
  it("steps back, and does nothing on the first question", () => {
    const state = makeState(PLAN, { cursor: 2 });
    expect(reduce(state, { type: "BACK" }).cursor).toBe(1);
    const first = makeState(PLAN);
    expect(reduce(first, { type: "BACK" })).toBe(first);
  });

  it("jumps to a step, and ignores an unknown one or the current one", () => {
    const state = makeState(PLAN);
    expect(reduce(state, { type: "JUMP", key: CHAIN.key }).cursor).toBe(2);
    expect(reduce(state, { type: "JUMP", key: "check-nothing#at-all" })).toBe(state);
    expect(reduce(state, { type: "JUMP", key: PADS.key })).toBe(state);
  });
});

describe("FINISH", () => {
  it("refuses while a question is still open", () => {
    const state = makeState(PLAN, { answers: { [PADS.key]: "ok" } });
    expect(reduce(state, { type: "FINISH" })).toBe(state);
  });

  it("closes the checkup once everything has a verdict", () => {
    const state = makeState(PLAN, {
      answers: { [PADS.key]: "ok", [CALIPER.key]: "skipped", [CHAIN.key]: "ko" },
    });
    const done = reduce(state, { type: "FINISH" }, AT);
    expect(done.completedAt).toBe("2026-09-19T09:30:00.000Z");
    expect(done.cursor).toBe(PLAN.length);
  });

  it("uses the clock when none is injected", () => {
    const state = makeState([], {});
    // An empty plan is trivially answered, which is also the guard `canFinish`
    // adds on top for the button.
    const done = reduce(state, { type: "FINISH" });
    expect(Number.isNaN(Date.parse(done.completedAt ?? ""))).toBe(false);
  });
});

describe("TOOL_MISSING", () => {
  it("adds and removes a tool, in catalogue order", () => {
    const state = makeState(PLAN);
    const one = reduce(state, { type: "TOOL_MISSING", toolId: "steel-ruler", missing: true });
    const two = reduce(one, { type: "TOOL_MISSING", toolId: "chain-checker", missing: true });
    expect(two.toolsMissing).toEqual(["chain-checker", "steel-ruler"]);
    expect(missingToolSet(two).has("chain-checker")).toBe(true);

    const back = reduce(two, { type: "TOOL_MISSING", toolId: "chain-checker", missing: false });
    expect(back.toolsMissing).toEqual(["steel-ruler"]);
  });

  it("does nothing when the flag already says that", () => {
    const state = makeState(PLAN);
    expect(reduce(state, { type: "TOOL_MISSING", toolId: "chain-checker", missing: false })).toBe(
      state,
    );
  });

  it("ignores a tool id the catalogue does not know", () => {
    const state = makeState(PLAN);
    expect(
      reduce(state, {
        type: "TOOL_MISSING",
        toolId: "sonic-screwdriver" as never,
        missing: true,
      }),
    ).toBe(state);
  });
});

describe("an event that is not one", () => {
  it("is ignored — storage and stale bundles are untrusted input", () => {
    const state = makeState(PLAN);
    expect(reduce(state, { type: "NOPE" } as unknown as CheckupEvent)).toBe(state);
  });
});

describe("reduceAll", () => {
  it("replays a sequence", () => {
    const state = reduceAll(
      makeState(PLAN),
      [
        { type: "ANSWER", key: PADS.key, result: "ok" },
        { type: "SKIP", key: CALIPER.key },
        { type: "ANSWER", key: CHAIN.key, result: "ko", symptoms: ["chain-elongation"] },
        { type: "FINISH" },
      ] satisfies CheckupEvent[],
      AT,
    );
    expect(state.cursor).toBe(3);
    expect(state.completedAt).toBe("2026-09-19T09:30:00.000Z");
  });
});
