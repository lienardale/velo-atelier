/**
 * The read-side views the wizard renders (§6.5).
 */
import { describe, expect, it } from "vitest";

import { makeState, makeStep, threeStepPlan } from "@/tests/_helpers/checkup";

import {
  canFinish,
  currentStep,
  isOnSummary,
  noteOf,
  openSteps,
  progressOf,
  stepIndexOf,
  summarySections,
  symptomOptions,
  symptomsOf,
  toolSubstitutions,
  verdictOf,
} from "./selectors";

const PLAN = threeStepPlan();
const [PADS, CALIPER, CHAIN] = PLAN;

describe("currentStep / isOnSummary", () => {
  it("is the step at the cursor", () => {
    expect(currentStep(makeState(PLAN))?.key).toBe(PADS.key);
    expect(isOnSummary(makeState(PLAN))).toBe(false);
  });

  it("is null past the last question", () => {
    const summary = makeState(PLAN, { cursor: 3 });
    expect(currentStep(summary)).toBeNull();
    expect(isOnSummary(summary)).toBe(true);
  });

  it("is null for a negative cursor (a stale stored position)", () => {
    expect(currentStep(makeState(PLAN, { cursor: -1 }))).toBeNull();
  });
});

describe("verdictOf / symptomsOf / noteOf", () => {
  it("read what is there, and a sensible empty otherwise", () => {
    const state = makeState(PLAN, {
      answers: { [PADS.key]: "ko" },
      symptoms: { [PADS.key]: ["pad-worn"] },
      notes: { [PADS.key]: "ça siffle" },
    });
    expect(verdictOf(state, PADS.key)).toBe("ko");
    expect(symptomsOf(state, PADS.key)).toEqual(["pad-worn"]);
    expect(noteOf(state, PADS.key)).toBe("ça siffle");

    expect(verdictOf(state, CHAIN.key)).toBeUndefined();
    expect(symptomsOf(state, CHAIN.key)).toEqual([]);
    expect(noteOf(state, CHAIN.key)).toBe("");
  });
});

describe("progressOf / canFinish", () => {
  it("counts each verdict", () => {
    const state = makeState(PLAN, {
      answers: { [PADS.key]: "ok", [CALIPER.key]: "ko", [CHAIN.key]: "skipped" },
    });
    expect(progressOf(state)).toEqual({ answered: 3, total: 3, ok: 1, ko: 1, skipped: 1 });
    expect(canFinish(state)).toBe(true);
  });

  it("refuses to finish with a question still open, or with no questions at all", () => {
    expect(canFinish(makeState(PLAN, { answers: { [PADS.key]: "ok" } }))).toBe(false);
    expect(canFinish(makeState([]))).toBe(false);
  });
});

describe("symptomOptions", () => {
  it("groups the consequences by reason, in the author's order", () => {
    expect(symptomOptions(CHAIN)).toEqual([
      {
        reasonKey: "chain-elongation",
        actions: ["replace"],
        partIds: ["chain"],
        guideSlugs: ["replace-chain"],
      },
      {
        reasonKey: "chain-dirty",
        actions: ["clean"],
        partIds: ["chain"],
        guideSlugs: ["clean-chain"],
      },
    ]);
  });

  it("collects the parts, actions and guides a reason spans, once each", () => {
    const step = makeStep({
      stepId: "pad-wear",
      ko: [
        {
          action: "replace",
          partId: "brake-pads-front",
          reasonKey: "pad-worn",
          guideSlug: "replace-brake-pads-disc",
        },
        {
          action: "replace",
          partId: "brake-pads-rear",
          reasonKey: "pad-worn",
          guideSlug: "replace-brake-pads-disc",
        },
        { action: "inspect-shop", partId: "brake-pads-front", reasonKey: "pad-worn" },
      ],
    });
    expect(symptomOptions(step)).toEqual([
      {
        reasonKey: "pad-worn",
        actions: ["replace", "inspect-shop"],
        partIds: ["brake-pads-front", "brake-pads-rear"],
        guideSlugs: ["replace-brake-pads-disc"],
      },
    ]);
  });

  it("offers a reason that only a shop can fix, with no guide", () => {
    const step = makeStep({
      stepId: "hose-leak",
      ko: [
        { action: "inspect-shop", partId: "brake-line-front", reasonKey: "hose-leak" },
        { action: "inspect-shop", partId: "brake-line-rear", reasonKey: "hose-leak" },
      ],
    });
    expect(symptomOptions(step)).toEqual([
      {
        reasonKey: "hose-leak",
        actions: ["inspect-shop"],
        partIds: ["brake-line-front", "brake-line-rear"],
        guideSlugs: [],
      },
    ]);
  });

  it("keeps every distinct guide a reason can be fixed by", () => {
    const step = makeStep({
      stepId: "rim-track",
      ko: [
        {
          action: "replace",
          partId: "tire-front",
          reasonKey: "tire-worn",
          guideSlug: "replace-tube-tire",
        },
        {
          action: "replace",
          partId: "tire-front",
          reasonKey: "tire-worn",
          guideSlug: "replace-tire-tubeless",
        },
      ],
    });
    expect(symptomOptions(step)[0].guideSlugs).toEqual([
      "replace-tube-tire",
      "replace-tire-tubeless",
    ]);
  });
});

describe("toolSubstitutions", () => {
  const step = makeStep({
    tools: [
      { toolId: "chain-checker", alternatives: ["steel-ruler"] },
      { toolId: "chain-whip", alternatives: [] },
      { toolId: "rags", alternatives: [] },
    ],
  });

  it("returns the step's tools the visitor said they do not have", () => {
    expect(toolSubstitutions(step, ["chain-checker", "allen-keys"])).toEqual([
      { toolId: "chain-checker", alternatives: ["steel-ruler"] },
    ]);
  });

  it("still returns a missing tool that has no stand-in", () => {
    expect(toolSubstitutions(step, ["chain-whip"])).toEqual([
      { toolId: "chain-whip", alternatives: [] },
    ]);
  });

  it("is empty when nothing is missing", () => {
    expect(toolSubstitutions(step, [])).toEqual([]);
  });
});

describe("summarySections / openSteps", () => {
  it("groups the answered steps by verdict and leaves the open ones out", () => {
    const state = makeState(PLAN, { answers: { [PADS.key]: "ko", [CALIPER.key]: "ok" } });
    expect(summarySections(state).map((section) => [section.group, section.steps.length])).toEqual([
      ["ko", 1],
      ["ok", 1],
      ["skipped", 0],
    ]);
    expect(openSteps(state).map((step) => step.key)).toEqual([CHAIN.key]);
  });
});

describe("stepIndexOf", () => {
  it("finds the step `?step=` names", () => {
    expect(stepIndexOf(makeState(PLAN), CALIPER.key)).toBe(1);
  });

  it("is -1 for nothing, for null and for a key the plan does not have", () => {
    expect(stepIndexOf(makeState(PLAN), undefined)).toBe(-1);
    expect(stepIndexOf(makeState(PLAN), null)).toBe(-1);
    expect(stepIndexOf(makeState(PLAN), "check-nothing#at-all")).toBe(-1);
  });
});
