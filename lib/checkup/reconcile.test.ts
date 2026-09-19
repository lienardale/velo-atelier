/**
 * `reconcile` (§5.4): the stored answers, married to today's plan.
 */
import { describe, expect, it } from "vitest";

import { makeState, makeStep, threeStepPlan } from "@/tests/_helpers/checkup";

import { firstUnanswered, reconcile } from "./reconcile";

const PLAN = threeStepPlan();
const [PADS, CALIPER, CHAIN] = PLAN;

describe("firstUnanswered", () => {
  it("is the first step with no verdict", () => {
    expect(firstUnanswered(PLAN, { [PADS.key]: "ok" })).toBe(1);
  });

  it("is the summary when everything is answered", () => {
    expect(
      firstUnanswered(PLAN, { [PADS.key]: "ok", [CALIPER.key]: "ko", [CHAIN.key]: "skipped" }),
    ).toBe(3);
  });
});

describe("reconcile", () => {
  it("keeps the answers whose step is still planned and drops the rest", () => {
    const state = makeState(PLAN, {
      answers: { [PADS.key]: "ok", [CALIPER.key]: "ko", "check-gone#step": "ko" },
      notes: { [PADS.key]: "ok mais bruyant", "check-gone#step": "perdu" },
      symptoms: { [CALIPER.key]: ["caliper-rub"], "check-gone#step": ["frame-crack"] },
    });
    const next = reconcile(state, [PADS, CALIPER]);

    expect(next.answers).toEqual({ [PADS.key]: "ok", [CALIPER.key]: "ko" });
    expect(next.notes).toEqual({ [PADS.key]: "ok mais bruyant" });
    expect(next.symptoms).toEqual({ [CALIPER.key]: ["caliper-rub"] });
    expect(next.steps).toEqual([PADS, CALIPER]);
  });

  it("drops a symptom whose reason the step no longer offers", () => {
    const state = makeState(PLAN, {
      answers: { [CHAIN.key]: "ko" },
      symptoms: { [CHAIN.key]: ["chain-elongation", "retired-reason"] },
    });
    expect(reconcile(state, PLAN).symptoms[CHAIN.key]).toEqual(["chain-elongation"]);
  });

  it("drops the whole entry when no reason survives", () => {
    const state = makeState(PLAN, {
      answers: { [CHAIN.key]: "ko" },
      symptoms: { [CHAIN.key]: ["retired-reason"] },
    });
    expect(reconcile(state, PLAN).symptoms).toEqual({});
  });

  it("appends new steps and parks the cursor on the first one still open", () => {
    const extra = makeStep({ guideSlug: "check-headset", stepId: "headset-play" });
    const state = makeState(PLAN, {
      answers: { [PADS.key]: "ok", [CALIPER.key]: "ok", [CHAIN.key]: "ok" },
      cursor: 3,
      completedAt: "2026-09-19T09:00:00.000Z",
    });
    const next = reconcile(state, [...PLAN, extra]);

    expect(next.steps).toHaveLength(4);
    expect(next.cursor).toBe(3);
    // A finished checkup that has grown a question is in progress again.
    expect(next.completedAt).toBeUndefined();
  });

  it("keeps completedAt when the fresh plan is still fully answered", () => {
    const state = makeState(PLAN, {
      answers: { [PADS.key]: "ok", [CALIPER.key]: "ok", [CHAIN.key]: "ok" },
      cursor: 3,
      completedAt: "2026-09-19T09:00:00.000Z",
    });
    expect(reconcile(state, PLAN).completedAt).toBe("2026-09-19T09:00:00.000Z");
  });

  it("treats an empty plan as unfinished, not as finished", () => {
    const state = makeState(PLAN, { completedAt: "2026-09-19T09:00:00.000Z" });
    const next = reconcile(state, []);
    expect(next.completedAt).toBeUndefined();
    expect(next.cursor).toBe(0);
  });

  it("keeps the state's own content version unless a fresh one is given", () => {
    const state = makeState(PLAN);
    expect(reconcile(state, PLAN).contentVersion).toBe("content-v1");
    expect(reconcile(state, PLAN, "content-v2").contentVersion).toBe("content-v2");
  });
});
