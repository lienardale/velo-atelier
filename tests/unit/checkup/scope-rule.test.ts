/**
 * A checkup limited to some parts says nothing about the others — the GUEST
 * path, over the real corpus (`.debug/017` §5.11).
 *
 * What was seen on the launch walk, and read in the source: a checkup limited
 * to the rear caliper and answered OK closes an open line about the FRONT pads
 * and tints the front caliper; one limited to the front tyre and answered KO
 * puts BOTH tyres on the list. Each case below is the walk's, through the
 * functions a guest's "Créer ma liste" calls (`deriveBuildList`,
 * `mergeGuestBuildList`, `markRechecked`) and the one the account's tint is
 * written from (`statusByPart`); the same checkups run FULL produce both sides
 * exactly as before. The account's path is `tests/integration/checkups.test.ts`
 * on PostgreSQL, and the two paths are held to one list by
 * `tests/unit/checkup/line-identity.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { deriveBike } from "@/lib/bike/rules";
import {
  deriveBuildList,
  mergeGuestBuildList,
  recheckedLines,
  statusByPart,
} from "@/lib/checkup/build-list";
import { answeredItems } from "@/lib/checkup/items";
import { planCheckup } from "@/lib/checkup/plan";
import type { CheckStepRef, CheckupScope, CheckupState } from "@/lib/checkup/types";
import type { PartId } from "@/lib/domain/data/parts";
import { BIKE_PRESETS, type PresetId } from "@/lib/domain/data/presets";
import type { BikeBuild } from "@/lib/domain/schema/part";
import { makeState } from "@/tests/_helpers/checkup";
import { diskGuides } from "@/tests/_helpers/guides";

const FR = diskGuides().filter((guide) => guide.locale === "fr");

function buildOf(preset: PresetId): BikeBuild {
  // eslint-disable-next-line security/detect-object-injection -- a PresetId literal
  const derived = deriveBike(BIKE_PRESETS[preset]);
  return { spec: derived.spec, parts: derived.parts };
}

const GRAVEL = buildOf("gravel-1x11");
/** A clincher bike: tubes, hosted by their tyre. */
const CITY = buildOf("city-igh-8-hub-motor");

const parts = (...partIds: string[]): CheckupScope => ({
  kind: "parts",
  partIds: partIds as PartId[],
});

/** Every question of `steps` answered `verdict`, a KO with the step's first reason. */
function answered(
  steps: readonly CheckStepRef[],
  verdict: "ok" | "ko",
  only?: string,
): CheckupState {
  const keys = steps.filter((step) => only === undefined || step.key === only);
  return makeState(steps, {
    answers: Object.fromEntries(keys.map((step) => [step.key, verdict])),
    symptoms:
      verdict === "ko"
        ? Object.fromEntries(keys.map((step) => [step.key, [step.ko[0].reasonKey]]))
        : {},
  });
}

const pairsOf = (lines: readonly { action: string; partId: string }[]) =>
  lines.map((line) => `${line.action} ${line.partId}`).sort();

const PAD_WEAR = "check-brakes-disc#pad-wear";

describe("the rear caliper only, all OK", () => {
  const fullPlan = planCheckup(GRAVEL, { kind: "full" }, FR);
  const rearPlan = planCheckup(GRAVEL, parts("brake-caliper-rear"), FR);
  // An earlier FULL checkup found both sides' pads worn.
  const earlier = deriveBuildList(answered(fullPlan, "ko", PAD_WEAR));
  const later = answered(rearPlan, "ok");

  it("starts from a list that holds both sides' pads", () => {
    expect(pairsOf(earlier)).toEqual(["replace brake-pads-front", "replace brake-pads-rear"]);
  });

  it("closes the rear pads' line and leaves the front one open", () => {
    const merged = mergeGuestBuildList(earlier, deriveBuildList(later), later, false);
    expect(merged.map((line) => [line.partId, line.done, line.doneReason ?? null]).sort()).toEqual([
      ["brake-pads-front", false, null],
      ["brake-pads-rear", true, "recheck-ok"],
    ]);
    // Until 2026-10-22 the front line was closed too: `recheckedLines` read
    // the step whole, both sides' findings in it.
    expect(pairsOf(recheckedLines(later)).some((pair) => pair.includes("front"))).toBe(false);
  });

  it("tints the rear caliper only — never the front caliper or the front lever", () => {
    expect(statusByPart(later)).toEqual({ "brake-caliper-rear": "ok" });
  });

  it("stores every answer against the rear caliper", () => {
    expect(answeredItems(later).map((item) => item.partId)).toEqual(
      rearPlan.map(() => "brake-caliper-rear"),
    );
  });

  it("is the control: the same answers run FULL close and tint both sides", () => {
    const full = answered(fullPlan, "ok", PAD_WEAR);
    const merged = mergeGuestBuildList(earlier, deriveBuildList(full), full, false);
    expect(merged.every((line) => line.done && line.doneReason === "recheck-ok")).toBe(true);
    expect(statusByPart(full)).toMatchObject({
      "brake-caliper-front": "ok",
      "brake-caliper-rear": "ok",
    });
  });
});

describe("the front tyre only, KO", () => {
  it("puts one line on the list, for the front tyre", () => {
    const plan = planCheckup(GRAVEL, parts("tire-front"), FR);
    expect(plan.length).toBeGreaterThan(0);
    const lines = deriveBuildList(answered(plan, "ko"));
    expect(pairsOf(lines)).toEqual(["replace tire-front"]);
    expect(statusByPart(answered(plan, "ko"))).toEqual({ "tire-front": "ko" });
  });

  it("is the control: the same question in a FULL checkup lists both tyres", () => {
    const full = planCheckup(GRAVEL, { kind: "full" }, FR);
    const tread = full.find((step) => step.key.startsWith("check-wheels-tires#tread-sidewalls"));
    expect(tread).toBeDefined();
    const lines = deriveBuildList(answered(full, "ko", tread?.key));
    expect(pairsOf(lines)).toEqual(["replace tire-front", "replace tire-rear"]);
  });
});

describe("parts reached through their host", () => {
  it("the pads through their caliper: a front caliper's KO lists the front pads", () => {
    const plan = planCheckup(GRAVEL, parts("brake-caliper-front"), FR);
    const lines = deriveBuildList(answered(plan, "ko", PAD_WEAR));
    expect(pairsOf(lines)).toEqual(["replace brake-pads-front"]);
  });

  it("a tube through its tyre: a front tyre's KO on the tubes lists the front tube", () => {
    const plan = planCheckup(CITY, parts("tire-front"), FR);
    const tubes = plan.find((step) =>
      step.ko.some((consequence) => consequence.partId === "tube-front"),
    );
    expect(tubes).toBeDefined();
    const lines = deriveBuildList(answered(plan, "ko", tubes?.key));
    expect(pairsOf(lines)).toEqual(["replace tube-front"]);
  });
});
