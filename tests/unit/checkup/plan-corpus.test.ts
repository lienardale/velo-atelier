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

import { deriveBuildList } from "@/lib/checkup/build-list";
import { hostOf, planCheckup, toolsFor } from "@/lib/checkup/plan";
import { partsInScope } from "@/lib/checkup/scope";
import { deriveBike } from "@/lib/bike/rules";
import { makeState } from "@/tests/_helpers/checkup";
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
  it("turns a pad — which has no mesh — into its caliper's questions, about the REAR side only", () => {
    const plan = planCheckup(EMTB, { kind: "parts", partIds: ["brake-pads-rear"] as PartId[] }, FR);
    // `hose-leak` names the calipers too, and was asked here until 2026-10-22;
    // its only finding is about the brake LINES, outside this scope, so a KO
    // could have put nothing on the list (`lib/checkup/plan.ts`, §5.11).
    expect(plan.map((step) => step.key)).toEqual([
      "check-brakes-disc#pad-wear",
      "check-brakes-disc#caliper-alignment",
    ]);
    expect(plan.map((step) => step.partIds)).toEqual([
      ["brake-caliper-rear"],
      ["brake-caliper-rear"],
    ]);
    expect(plan.map((step) => step.coveredParts)).toEqual([
      ["brake-pads-rear"],
      ["brake-caliper-rear"],
    ]);
    expect(plan.flatMap((step) => step.ko.map((consequence) => consequence.partId))).toEqual([
      "brake-pads-rear",
      "brake-pads-rear",
      "brake-caliper-rear",
    ]);
  });

  it("asks a question about both tyres, for the front one only, with the front tyre's findings", () => {
    const plan = planCheckup(GRAVEL, { kind: "parts", partIds: ["tire-front"] as PartId[] }, FR);
    for (const step of plan) {
      expect(step.partIds, step.key).toEqual(["tire-front"]);
      for (const consequence of step.ko) {
        expect(["tire-front", "tube-front"], step.key).toContain(consequence.partId);
      }
    }
    expect(plan.length).toBeGreaterThan(0);
  });

  it("asks one question when one chain is picked", () => {
    const plan = planCheckup(GRAVEL, { kind: "parts", partIds: ["chain"] as PartId[] }, FR);
    expect(plan.map((step) => step.key)).toEqual(["check-drivetrain#chain-wear"]);
    expect(plan[0].ko.map((consequence) => consequence.reasonKey)).toEqual([
      "chain-elongation",
      "chain-dirty",
    ]);
  });

  it("plans NOTHING for a parts scope that names no part — which no caller hands it any more", () => {
    // Kept on purpose (`.debug/017` §5.10): a planner that turned it into the
    // full checkup would widen silently, and a stale empty scope would then
    // ask — and, on the server, write — 34 questions' worth. The callers
    // decide before: `?parts=` naming nothing is the full checkup
    // (`scopeFromPartIds`), the actions refuse an empty one, and
    // `effectiveScope` reads one as naming nothing without planning it. A
    // caller that DID plan it is how a resumed run lost every answer.
    expect(planCheckup(GRAVEL, { kind: "parts", partIds: [] }, FR).map((s) => s.key)).toEqual([]);
    expect(GRAVEL_FULL.length).toBeGreaterThan(20);
  });
});

/**
 * The scope rule over every preset and every part it carries (§5.11): a
 * checkup limited to one part reports on nothing outside it — what an item is
 * stored against (`partIds[0]`), what is tinted (`partIds`), what is closed
 * and derived (`ko`) — and a full checkup is exactly what it was before the
 * rule existed, field for field.
 */
describe.each(Object.keys(BIKE_PRESETS) as PresetId[])("%s: the scope rule", (preset) => {
  const build = buildOf(preset);
  const full = planCheckup(build, { kind: "full" }, FR);
  const fitted = new Set(build.parts.map((part) => part.partId));

  it("plans a FULL checkup as it always did: every fitted part, every fitted finding", () => {
    // The rule before 2026-10-22, written out: hosts of the fitted parts a
    // step names, in the guide's order; its findings about fitted parts.
    for (const step of full) {
      const guide = FR.find((candidate) => candidate.slug === step.guideSlug);
      const source = guide?.steps.find((candidate) => candidate.id === step.stepId);
      const named = (source?.partIds ?? guide?.partIds ?? []).filter((id) => fitted.has(id));
      const hosts = [...new Set(named.map((id) => hostOf(id)))];
      expect(step.partIds, step.key).toEqual(hosts);
      expect(step.ko, step.key).toEqual(
        (source?.checkQuestion?.ko ?? []).filter((consequence) => fitted.has(consequence.partId)),
      );
      expect(step.coveredParts, step.key).toBeUndefined();
    }
  });

  it("never reports a one-part checkup on a part outside its scope", () => {
    for (const partId of fitted) {
      const scope = { kind: "parts" as const, partIds: [partId] as PartId[] };
      const inside = partsInScope(scope) ?? new Set<string>();
      const hosts = new Set([...inside].map((id) => hostOf(id)));
      for (const step of planCheckup(build, scope, FR)) {
        const where = `${partId}: ${step.key}`;
        expect(step.partIds.length, where).toBeGreaterThan(0);
        for (const host of step.partIds) expect(hosts.has(host), where).toBe(true);
        for (const consequence of step.ko) expect(inside.has(consequence.partId), where).toBe(true);
        // A question is asked only when it can find something inside the scope.
        expect(step.ko.length, where).toBeGreaterThan(0);
        // And it is one the full checkup asks.
        expect(
          full.some((other) => other.key === step.key),
          where,
        ).toBe(true);
      }
    }
  });
});

describe("a finding survives the rest of the checkup", () => {
  it("never derives a line that is already done, whatever else was answered OK", () => {
    // The corpus is full of steps that share an `(action, partId)` without
    // being the same question — `check-brakes-disc#lever-feel` and
    // `#hose-leak` both send `brake-line-front` to a shop, as do
    // `check-wheels-tires#wheel-true` and `#hub-play`. A full demo checkup has
    // 22 such pairs, and closing across them handed the visitor their one
    // finding back already ticked done. One KO, everything else OK: the line
    // stays open, every time.
    const closed: string[] = [];
    for (const step of GRAVEL_FULL) {
      if (step.ko.length === 0) continue;
      const answers = Object.fromEntries(
        GRAVEL_FULL.map((other) => [other.key, other.key === step.key ? "ko" : "ok"]),
      ) as Record<string, "ok" | "ko">;
      const state = makeState(GRAVEL_FULL, {
        answers,
        symptoms: { [step.key]: [step.ko[0].reasonKey] },
      });
      for (const item of deriveBuildList(state)) {
        if (item.done) closed.push(`${step.key} -> ${item.id}`);
      }
    }
    expect(closed).toEqual([]);
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
