/**
 * The plan against the real corpus (§5.8 AC3).
 *
 * `lib/checkup/plan.test.ts` pins the rules on hand-shaped guides; this file
 * asks the only question the rules cannot answer — do the 13 check guides and
 * the seven presets actually produce sensible checkups? A guide that grows a
 * step, loses an `appliesTo` or renames a tool changes these numbers, which is
 * the point: the corpus and the engine are one product.
 *
 * The corpus is read ONCE, at module scope. Import time is not charged to a
 * test's 5 s timeout, and CI is ~2.9× slower than this machine under v8
 * coverage (`.debug/009`).
 */
import { describe, expect, it } from "vitest";

import { planCheckup, toolsFor } from "@/lib/checkup/plan";
import { deriveBike } from "@/lib/bike/rules";
import { BIKE_PRESETS, type PresetId } from "@/lib/domain/data/presets";
import type { PartId } from "@/lib/domain/data/parts";
import type { BikeBuild } from "@/lib/domain/schema/part";
import { diskGuides } from "@/tests/_helpers/guides";

const FR = diskGuides().filter((guide) => guide.locale === "fr");

function buildOf(preset: PresetId): BikeBuild {
  // eslint-disable-next-line security/detect-object-injection -- `preset` is a PresetId literal
  const derived = deriveBike(BIKE_PRESETS[preset]);
  return { spec: derived.spec, parts: derived.parts };
}

const GRAVEL = buildOf("gravel-1x11");
const ROAD_RIM = buildOf("road-rim-2x11");
const EMTB = buildOf("emtb-mid-1x12");

const ROAD_RIM_FULL = planCheckup(ROAD_RIM, { kind: "full" }, FR);
const GRAVEL_FULL = planCheckup(GRAVEL, { kind: "full" }, FR);

describe("a full checkup asks only what this bike can answer", () => {
  it("never asks a rim-brake bike about discs or an e-system", () => {
    const slugs = new Set(ROAD_RIM_FULL.map((step) => step.guideSlug));
    expect(slugs.has("check-brakes-rim")).toBe(true);
    expect(slugs.has("check-brakes-disc")).toBe(false);
    expect(slugs.has("check-e-system")).toBe(false);
    expect(slugs.has("check-suspension")).toBe(false);
  });

  it("asks an e-MTB about its battery and its suspension", () => {
    const slugs = new Set(planCheckup(EMTB, { kind: "full" }, FR).map((step) => step.guideSlug));
    expect(slugs.has("check-e-system")).toBe(true);
    expect(slugs.has("check-suspension")).toBe(true);
  });

  it("puts the brakes first and the frame bolts last on the demo bike", () => {
    expect(GRAVEL_FULL[0].guideSlug).toBe("check-brakes-disc");
    expect(GRAVEL_FULL.at(-1)?.key).toBe("check-frame-bolts#frame-inspect");
  });

  it("names a key, a guide, a part, a prompt and at least one consequence for every step", () => {
    const broken = GRAVEL_FULL.filter(
      (step) =>
        step.key !== `${step.guideSlug}#${step.stepId}` ||
        step.partIds.length === 0 ||
        step.prompt.length === 0 ||
        step.title.length === 0 ||
        step.ko.length === 0,
    );
    expect(broken.map((step) => step.key)).toEqual([]);
  });

  it("plans the same checkup whichever locale of the corpus it is given", () => {
    const both = planCheckup(GRAVEL, { kind: "full" }, diskGuides());
    expect(both.map((step) => step.key)).toEqual(GRAVEL_FULL.map((step) => step.key));
  });
});

describe("a partial checkup asks about the parts that were picked", () => {
  it("turns a pad — which has no mesh — into its caliper's questions", () => {
    const plan = planCheckup(EMTB, { kind: "parts", partIds: ["brake-pads-rear"] as PartId[] }, FR);
    expect(plan.map((step) => step.key)).toEqual([
      "check-brakes-disc#pad-wear",
      "check-brakes-disc#caliper-alignment",
      "check-brakes-disc#hose-leak",
    ]);
  });

  it("asks one question when one chain is picked", () => {
    const plan = planCheckup(GRAVEL, { kind: "parts", partIds: ["chain"] as PartId[] }, FR);
    expect(plan.map((step) => step.key)).toEqual(["check-drivetrain#chain-wear"]);
    expect(plan[0].ko.map((consequence) => consequence.reasonKey)).toEqual([
      "chain-elongation",
      "chain-dirty",
    ]);
  });

  it("is the full checkup again when nothing was picked", () => {
    expect(planCheckup(GRAVEL, { kind: "parts", partIds: [] }, FR).map((s) => s.key)).toEqual([]);
    expect(GRAVEL_FULL.length).toBeGreaterThan(20);
  });
});

describe("toolsFor", () => {
  it("lists the demo bike's tools with the stand-ins its guides declare", () => {
    expect(toolsFor(GRAVEL_FULL)).toEqual([
      { toolId: "allen-keys", alternatives: ["multi-tool"] },
      { toolId: "torque-wrench", alternatives: [] },
      { toolId: "pedal-wrench", alternatives: ["allen-keys", "adjustable-wrench"] },
      { toolId: "phillips-screwdriver", alternatives: ["multi-tool"] },
      { toolId: "floor-pump", alternatives: ["mini-pump"] },
      { toolId: "pressure-gauge", alternatives: ["floor-pump"] },
      { toolId: "chain-checker", alternatives: ["steel-ruler"] },
      { toolId: "zip-tie", alternatives: [] },
      { toolId: "work-stand", alternatives: [] },
      { toolId: "rags", alternatives: [] },
    ]);
  });
});
