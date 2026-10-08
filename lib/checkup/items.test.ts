/**
 * `answeredItems` — a checkup's answers as `CheckupItem` rows.
 *
 * Two writers share it (`writeItems` for a saved bike, the guest import for a
 * checkup answered in a browser), so what a row holds is pinned here once
 * rather than in each of their test files.
 */
import { describe, expect, it } from "vitest";

import { makeState, makeStep, threeStepPlan } from "@/tests/_helpers/checkup";
import type { PartId } from "@/lib/domain/data/parts";

import { answeredItems } from "./items";

const PLAN = threeStepPlan();
const [PADS, ALIGNMENT, CHAIN] = PLAN;

describe("answeredItems", () => {
  it("is empty for a checkup nobody answered", () => {
    expect(answeredItems(makeState(PLAN))).toEqual([]);
  });

  it("has one row per answered step, in PLAN order whatever order they were answered in", () => {
    const state = makeState(PLAN, {
      // Answered last question first.
      answers: { [CHAIN.key]: "ko", [PADS.key]: "ok" },
    });
    expect(answeredItems(state).map((item) => item.stepKey)).toEqual([PADS.key, CHAIN.key]);
  });

  it("names the step's guide and its FIRST reported part", () => {
    const both = makeStep({
      guideSlug: "check-brakes-disc",
      stepId: "pad-wear",
      partIds: ["brake-caliper-front", "brake-caliper-rear"] as PartId[],
    });
    const [item] = answeredItems(makeState([both], { answers: { [both.key]: "ok" } }));
    expect(item).toEqual({
      stepKey: "check-brakes-disc#pad-wear",
      partId: "brake-caliper-front",
      guideSlug: "check-brakes-disc",
      result: "ok",
      notes: null,
      reasonKeys: [],
    });
  });

  it("carries the note, and null rather than an empty string when there is none", () => {
    const state = makeState(PLAN, {
      answers: { [PADS.key]: "ok", [CHAIN.key]: "ko" },
      notes: { [CHAIN.key]: "elle saute" },
    });
    const byKey = new Map(answeredItems(state).map((item) => [item.stepKey, item]));
    expect(byKey.get(CHAIN.key)?.notes).toBe("elle saute");
    expect(byKey.get(PADS.key)?.notes).toBeNull();
  });

  it("does not store a note left on a step that has no verdict", () => {
    const state = makeState(PLAN, {
      answers: { [PADS.key]: "ok" },
      notes: { [ALIGNMENT.key]: "à revoir" },
    });
    expect(answeredItems(state).map((item) => item.stepKey)).toEqual([PADS.key]);
  });

  it("keeps the symptoms of a KO, as a copy", () => {
    const symptoms = ["chain-elongation"];
    const state = makeState(PLAN, {
      answers: { [CHAIN.key]: "ko" },
      symptoms: { [CHAIN.key]: symptoms },
    });
    const [item] = answeredItems(state);
    expect(item.reasonKeys).toEqual(["chain-elongation"]);
    expect(item.reasonKeys).not.toBe(symptoms);
  });

  it("gives a KO with no symptom an empty list", () => {
    const [item] = answeredItems(makeState(PLAN, { answers: { [CHAIN.key]: "ko" } }));
    expect(item.reasonKeys).toEqual([]);
  });

  it("drops a symptom the state still remembers on a step that is no longer KO", () => {
    for (const result of ["ok", "skipped"] as const) {
      const state = makeState(PLAN, {
        answers: { [CHAIN.key]: result },
        symptoms: { [CHAIN.key]: ["chain-elongation"] },
      });
      expect(answeredItems(state)[0]).toMatchObject({ result, reasonKeys: [] });
    }
  });

  it("reads own keys only — an answer named like an Object.prototype member is not a verdict", () => {
    const odd = makeStep({ guideSlug: "constructor", stepId: "toString", key: "constructor" });
    expect(answeredItems(makeState([odd]))).toEqual([]);
  });
});
