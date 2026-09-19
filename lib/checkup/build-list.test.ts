/**
 * `deriveBuildList` (§5.4, §5.8 AC3): verdicts in, one line per thing to do out.
 */
import { describe, expect, it } from "vitest";

import { makeState, makeStep, threeStepPlan } from "@/tests/_helpers/checkup";

import { deriveBuildList, markRechecked, statusByPart } from "./build-list";
import type { BuildListItem } from "./types";
import type { PartId } from "@/lib/domain/data/parts";

const PLAN = threeStepPlan();
const [PADS, CALIPER, CHAIN] = PLAN;

describe("deriveBuildList", () => {
  it("emits nothing for a checkup with no KO", () => {
    expect(
      deriveBuildList(makeState(PLAN, { answers: { [PADS.key]: "ok", [CALIPER.key]: "skipped" } })),
    ).toEqual([]);
  });

  it("keeps only the consequences of the symptom the visitor ticked", () => {
    const items = deriveBuildList(
      makeState(PLAN, {
        answers: { [CHAIN.key]: "ko" },
        symptoms: { [CHAIN.key]: ["chain-elongation"] },
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "check-drivetrain#chain-wear|chain|replace",
      partId: "chain",
      action: "replace",
      reasonKey: "chain-elongation",
      guideSlug: "replace-chain",
      done: false,
      sortOrder: 0,
      sourceKeys: [CHAIN.key],
    });
  });

  it("falls back to every consequence when the visitor gave no symptom", () => {
    const items = deriveBuildList(makeState(PLAN, { answers: { [CHAIN.key]: "ko" } }));
    expect(items.map((item) => item.action)).toEqual(["replace", "clean"]);
  });

  it("emits nothing when the ticked symptom names no consequence of the step", () => {
    const items = deriveBuildList(
      makeState(PLAN, {
        answers: { [CHAIN.key]: "ko" },
        symptoms: { [CHAIN.key]: ["frame-crack"] },
      }),
    );
    expect(items).toEqual([]);
  });

  it("merges two steps that name the same (action, part) and keeps both sources", () => {
    const second = makeStep({
      guideSlug: "check-wheels-tires",
      stepId: "wheel-true",
      partIds: ["wheel-front"] as PartId[],
      ko: [
        {
          action: "replace",
          partId: "chain",
          reasonKey: "chain-stiff-link",
          guideSlug: "replace-chain",
        },
      ],
    });
    const plan = [CHAIN, second];
    const items = deriveBuildList(
      makeState(plan, { answers: { [CHAIN.key]: "ko", [second.key]: "ko" } }),
    );
    const replace = items.filter((item) => item.action === "replace");

    expect(replace).toHaveLength(1);
    // The id and the reason come from the FIRST step that produced the pair.
    expect(replace[0].id).toBe("check-drivetrain#chain-wear|chain|replace");
    expect(replace[0].reasonKey).toBe("chain-elongation");
    expect(replace[0].sourceKeys).toEqual([CHAIN.key, second.key]);
  });

  it("does not list the same source twice", () => {
    const twice = makeStep({
      guideSlug: "check-drivetrain",
      stepId: "chain-twice",
      ko: [
        {
          action: "replace",
          partId: "chain",
          reasonKey: "chain-elongation",
          guideSlug: "replace-chain",
        },
        {
          action: "replace",
          partId: "chain",
          reasonKey: "chain-stiff-link",
          guideSlug: "replace-chain",
        },
      ],
    });
    const items = deriveBuildList(makeState([twice], { answers: { [twice.key]: "ko" } }));
    expect(items).toHaveLength(1);
    expect(items[0].sourceKeys).toEqual([twice.key]);
  });

  it("omits guideSlug for an inspect-shop consequence", () => {
    const shop = makeStep({
      guideSlug: "check-brakes-disc",
      stepId: "hose-leak",
      ko: [{ action: "inspect-shop", partId: "brake-line-front", reasonKey: "hose-leak" }],
    });
    const items = deriveBuildList(makeState([shop], { answers: { [shop.key]: "ko" } }));
    expect(items[0].guideSlug).toBeUndefined();
    expect(items[0].action).toBe("inspect-shop");
  });

  it("numbers the lines in plan order", () => {
    const items = deriveBuildList(
      makeState(PLAN, {
        answers: { [PADS.key]: "ko", [CHAIN.key]: "ko" },
        symptoms: { [PADS.key]: ["pad-worn"], [CHAIN.key]: ["chain-elongation"] },
      }),
    );
    expect(items.map((item) => [item.partId, item.sortOrder])).toEqual([
      ["brake-pads-front", 0],
      ["chain", 1],
    ]);
  });

  it("closes a line a later OK contradicts", () => {
    // Two questions about the same pads: the wear one says KO, a second one
    // that could produce exactly that line says OK.
    const recheck = makeStep({
      guideSlug: "check-brakes-disc",
      stepId: "pad-recheck",
      ko: [
        {
          action: "replace",
          partId: "brake-pads-front",
          reasonKey: "pad-worn",
          guideSlug: "replace-brake-pads-disc",
        },
      ],
    });
    const items = deriveBuildList(
      makeState([PADS, recheck], {
        answers: { [PADS.key]: "ko", [recheck.key]: "ok" },
        symptoms: { [PADS.key]: ["pad-worn"] },
      }),
    );
    expect(items[0]).toMatchObject({ done: true, doneReason: "recheck-ok" });
  });

  it("does not close a line an unrelated OK sits next to", () => {
    const items = deriveBuildList(
      makeState(PLAN, {
        answers: { [PADS.key]: "ko", [CALIPER.key]: "ok" },
        symptoms: { [PADS.key]: ["pad-worn"] },
      }),
    );
    // The alignment question reports on the SAME caliper but is about a
    // different problem; the pads are still worn.
    expect(items[0].done).toBe(false);
  });
});

describe("markRechecked", () => {
  const item: BuildListItem = {
    id: "check-drivetrain#chain-wear|chain|replace",
    stepKey: CHAIN.key,
    sourceKeys: [CHAIN.key],
    partId: "chain" as PartId,
    action: "replace",
    reasonKey: "chain-elongation",
    guideSlug: "replace-chain",
    done: false,
    sortOrder: 0,
  };

  it("returns a copy when nothing was answered OK", () => {
    const items = markRechecked([item], makeState(PLAN));
    expect(items).toEqual([item]);
    expect(items).not.toBe(item);
  });

  it("closes a persisted line when a later checkup says the part is fine", () => {
    const [closed] = markRechecked([item], makeState(PLAN, { answers: { [CHAIN.key]: "ok" } }));
    expect(closed).toMatchObject({ done: true, doneReason: "recheck-ok" });
  });

  it("leaves a line the visitor already ticked alone", () => {
    const manual = { ...item, done: true, doneReason: "manual" as const };
    const [kept] = markRechecked([manual], makeState(PLAN, { answers: { [CHAIN.key]: "ok" } }));
    expect(kept.doneReason).toBe("manual");
  });
});

describe("statusByPart", () => {
  it("tints a part OK, KO or todo, KO winning", () => {
    const status = statusByPart(
      makeState(PLAN, { answers: { [PADS.key]: "ko", [CALIPER.key]: "ok" } }),
    );
    // Both steps report on the same caliper: worn pads beat a good alignment.
    expect(status["brake-caliper-front"]).toBe("ko");
    expect(status["chain"]).toBe("todo");
  });

  it("does not let a later unanswered step erase an OK", () => {
    const second = makeStep({ guideSlug: "check-brakes-disc", stepId: "second" });
    const status = statusByPart(makeState([PADS, second], { answers: { [PADS.key]: "ok" } }));
    expect(status["brake-caliper-front"]).toBe("ok");
  });

  it("lets a KO override an OK recorded earlier", () => {
    const second = makeStep({ guideSlug: "check-brakes-disc", stepId: "second" });
    const status = statusByPart(
      makeState([PADS, second], { answers: { [PADS.key]: "ok", [second.key]: "ko" } }),
    );
    expect(status["brake-caliper-front"]).toBe("ko");
  });
});
