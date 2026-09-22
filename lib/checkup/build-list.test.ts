/**
 * `deriveBuildList` (§5.4, §5.8 AC3): verdicts in, one line per thing to do out.
 */
import { describe, expect, it } from "vitest";

import { makeState, makeStep, threeStepPlan } from "@/tests/_helpers/checkup";

import {
  deriveBuildList,
  markRechecked,
  mergeGuestBuildList,
  recheckedLines,
  statusByPart,
} from "./build-list";
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

  it("leaves a line open when another question about the same part says OK", () => {
    // The real shape of the bug this pins: `(action, partId)` is the identity
    // of a LINE, not of a question. On the demo bike
    // `check-brakes-disc#lever-feel` ("levier spongieux") and
    // `check-brakes-disc#hose-leak` both name `inspect-shop brake-line-front`,
    // so closing across them handed the visitor their one finding already
    // ticked done. A KO in THIS state stays open; `recheck-ok` is for a line
    // that was already on the list (§6.7, {@link markRechecked}).
    const leverFeel = makeStep({
      guideSlug: "check-brakes-disc",
      stepId: "lever-feel",
      ko: [{ action: "inspect-shop", partId: "brake-line-front", reasonKey: "lever-spongy" }],
    });
    const hoseLeak = makeStep({
      guideSlug: "check-brakes-disc",
      stepId: "hose-leak",
      ko: [{ action: "inspect-shop", partId: "brake-line-front", reasonKey: "hose-leak" }],
    });
    const items = deriveBuildList(
      makeState([leverFeel, hoseLeak], {
        answers: { [leverFeel.key]: "ko", [hoseLeak.key]: "ok" },
        symptoms: { [leverFeel.key]: ["lever-spongy"] },
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      partId: "brake-line-front",
      reasonKey: "lever-spongy",
      done: false,
    });
    expect(items[0].doneReason).toBeUndefined();
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

describe("mergeGuestBuildList", () => {
  const stored: BuildListItem = {
    id: "check-drivetrain#chain-wear|chain|replace",
    stepKey: CHAIN.key,
    sourceKeys: [CHAIN.key],
    partId: "chain" as PartId,
    action: "replace",
    reasonKey: "chain-elongation",
    guideSlug: "replace-chain",
    done: true,
    doneReason: "manual",
    refinement: { speeds: "11" },
    chosenProduct: {
      brand: "Shimano",
      model: "CN-HG601",
      size: "11v",
      vendor: "alltricks",
      url: "https://www.alltricks.fr/C-40598-toutes-les-chaines",
    },
    sortOrder: 7,
  };

  /** A state that derives the same (replace, chain) line, from a KO. */
  const koOnChain = () =>
    makeState(PLAN, {
      answers: { [CHAIN.key]: "ko" },
      symptoms: { [CHAIN.key]: ["chain-elongation"] },
    });

  it("keeps what the visitor typed on a line the checkup found again", () => {
    const state = koOnChain();
    const [merged] = mergeGuestBuildList([stored], deriveBuildList(state), state, true);
    expect(merged).toMatchObject({
      done: true,
      doneReason: "manual",
      refinement: { speeds: "11" },
      chosenProduct: stored.chosenProduct,
      sortOrder: 7,
    });
    // …and takes what the checkup found from the new derivation.
    expect(merged.sourceKeys).toEqual([CHAIN.key]);
  });

  it("re-runs the same checkup over an untouched line without inventing fields", () => {
    // The commonest case: a line from last month's checkup that the visitor
    // never ticked, refined or shopped for. None of the three optional fields
    // exists, and the merge must not put `undefined` ones on the item — the
    // guest list is JSON, and `{ refinement: undefined }` round-trips as a key.
    const untouched: BuildListItem = {
      ...stored,
      done: false,
      doneReason: undefined,
      refinement: undefined,
      chosenProduct: undefined,
      sortOrder: 3,
    };
    const state = koOnChain();
    const [merged] = mergeGuestBuildList([untouched], deriveBuildList(state), state, true);

    expect(merged).toMatchObject({ done: false, sortOrder: 3, partId: "chain" });
    expect(Object.hasOwn(merged, "doneReason")).toBe(false);
    expect(Object.hasOwn(merged, "refinement")).toBe(false);
    expect(Object.hasOwn(merged, "chosenProduct")).toBe(false);
  });

  it("drops a stored line the checkup no longer produces", () => {
    const state = makeState(PLAN, {
      answers: { [PADS.key]: "ko" },
      symptoms: { [PADS.key]: ["pad-worn"] },
    });
    const merged = mergeGuestBuildList([stored], deriveBuildList(state), state, true);
    expect(merged.some((item) => item.partId === "chain")).toBe(false);
    expect(merged).toHaveLength(1);
  });

  it("numbers a line the visitor has never seen from its place in the new list", () => {
    const state = koOnChain();
    const [fresh] = mergeGuestBuildList([], deriveBuildList(state), state, true);
    expect(fresh).toMatchObject({ done: false, sortOrder: 0 });
    expect(fresh.refinement).toBeUndefined();
    expect(fresh.chosenProduct).toBeUndefined();
  });

  it("closes an open stored line a LATER checkup answered OK (§6.7)", () => {
    // The chain is fine now, and the KO that keeps the line alive is elsewhere.
    const state = makeState(PLAN, {
      answers: { [CHAIN.key]: "ok", [PADS.key]: "ko" },
      symptoms: { [PADS.key]: ["pad-worn"] },
    });
    const open = { ...stored, done: false, doneReason: undefined };
    const merged = mergeGuestBuildList([open], deriveBuildList(state), state, false);
    const chain = merged.find((item) => item.partId === "chain");
    expect(chain).toMatchObject({ done: true, doneReason: "recheck-ok" });
    // …and the pads line the same checkup found is open next to it.
    expect(merged.find((item) => item.partId === "brake-pads-front")?.done).toBe(false);
  });

  /** Two questions of one checkup naming the same line, and disagreeing. */
  const leverFeel = makeStep({
    guideSlug: "check-brakes-disc",
    stepId: "lever-feel",
    ko: [{ action: "inspect-shop", partId: "brake-line-front", reasonKey: "lever-spongy" }],
  });
  const hoseLeak = makeStep({
    guideSlug: "check-brakes-disc",
    stepId: "hose-leak",
    ko: [{ action: "inspect-shop", partId: "brake-line-front", reasonKey: "hose-leak" }],
  });
  const spongyButDry = () =>
    makeState([leverFeel, hoseLeak], {
      answers: { [leverFeel.key]: "ko", [hoseLeak.key]: "ok" },
      symptoms: { [leverFeel.key]: ["lever-spongy"] },
    });
  const brakeLine = (overrides: Partial<BuildListItem>): BuildListItem => ({
    id: `${hoseLeak.key}|brake-line-front|inspect-shop`,
    stepKey: hoseLeak.key,
    sourceKeys: [hoseLeak.key],
    partId: "brake-line-front" as PartId,
    action: "inspect-shop",
    reasonKey: "hose-leak",
    done: false,
    sortOrder: 0,
    ...overrides,
  });

  it.each([true, false])(
    "never closes a line a KO of the same checkup derives, whatever another question says (same checkup: %s)",
    (sameCheckup) => {
      // The survey's reproduction: the stored line is open, this checkup's KO
      // derives it again and another OK names the same pair. Before W4 the
      // OK closed the stored copy and the merge carried `done` onto the KO's line.
      const state = spongyButDry();
      const [line] = mergeGuestBuildList(
        [brakeLine({})],
        deriveBuildList(state),
        state,
        sameCheckup,
      );
      expect(line).toMatchObject({ partId: "brake-line-front", done: false });
      expect(Object.hasOwn(line, "doneReason")).toBe(false);
    },
  );

  it("reopens a line a later checkup's KO derives again, even one closed by a recheck", () => {
    const state = spongyButDry();
    for (const closed of [
      brakeLine({ done: true, doneReason: "recheck-ok" }),
      brakeLine({ done: true, doneReason: "manual", refinement: { note: "kept" } }),
    ]) {
      const [line] = mergeGuestBuildList([closed], deriveBuildList(state), state, false);
      expect(line.done, closed.doneReason).toBe(false);
      expect(Object.hasOwn(line, "doneReason"), closed.doneReason).toBe(false);
      // What the visitor TYPED about the part still survives.
      expect(line.refinement).toEqual(closed.refinement);
    }
  });

  it("keeps a hand-ticked line ticked across a re-run of the same checkup, but not a recheck", () => {
    const state = spongyButDry();
    const manual = mergeGuestBuildList(
      [brakeLine({ done: true, doneReason: "manual" })],
      deriveBuildList(state),
      state,
      true,
    );
    expect(manual[0]).toMatchObject({ done: true, doneReason: "manual" });

    const rechecked = mergeGuestBuildList(
      [brakeLine({ done: true, doneReason: "recheck-ok" })],
      deriveBuildList(state),
      state,
      true,
    );
    expect(rechecked[0].done).toBe(false);
  });

  it("keeps a tick that carries no reason ticked across a re-run, and invents no reason", () => {
    // A guest list written before lines carried a `doneReason`: `done` alone
    // is the visitor's tick (only a checkup writes `recheck-ok`, and it always
    // says so). It survives a re-run of the same checkup like a `manual` one —
    // and, like the untouched line above, the merge does not put a
    // `doneReason: undefined` key into a list that is stored as JSON.
    const state = spongyButDry();
    const legacy = brakeLine({ done: true });
    expect(Object.hasOwn(legacy, "doneReason")).toBe(false);

    const [line] = mergeGuestBuildList([legacy], deriveBuildList(state), state, true);

    expect(line.done).toBe(true);
    expect(Object.hasOwn(line, "doneReason")).toBe(false);
  });
});

describe("recheckedLines", () => {
  it("is every pair an OK step's ko[] names, in plan order, once", () => {
    const again = makeStep({ guideSlug: "check-drivetrain", stepId: "chain-again", ko: CHAIN.ko });
    const state = makeState([...PLAN, again], {
      answers: { [PADS.key]: "ok", [CHAIN.key]: "ok", [again.key]: "ok", [CALIPER.key]: "skipped" },
    });
    expect(recheckedLines(state)).toEqual([
      { action: "replace", partId: "brake-pads-front" },
      ...CHAIN.ko.map((consequence) => ({
        action: consequence.action,
        partId: consequence.partId,
      })),
    ]);
  });

  it("leaves out a pair a KO of the same state derives", () => {
    const leverFeel = makeStep({
      guideSlug: "check-brakes-disc",
      stepId: "lever-feel",
      ko: [{ action: "inspect-shop", partId: "brake-line-front", reasonKey: "lever-spongy" }],
    });
    const hoseLeak = makeStep({
      guideSlug: "check-brakes-disc",
      stepId: "hose-leak",
      ko: [
        { action: "inspect-shop", partId: "brake-line-front", reasonKey: "hose-leak" },
        { action: "replace", partId: "brake-line-front", reasonKey: "hose-leak", guideSlug: "x" },
      ],
    });
    const state = makeState([leverFeel, hoseLeak], {
      answers: { [leverFeel.key]: "ko", [hoseLeak.key]: "ok" },
    });
    // The replace line is not derived by the KO, so the OK still closes it.
    expect(recheckedLines(state)).toEqual([{ action: "replace", partId: "brake-line-front" }]);
  });

  it("closes nothing when nothing was answered OK", () => {
    expect(recheckedLines(makeState(PLAN, { answers: { [PADS.key]: "skipped" } }))).toEqual([]);
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
