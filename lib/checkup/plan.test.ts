/**
 * `planCheckup` and `toolsFor` on hand-shaped guides (§5.4).
 *
 * The corpus is exercised separately (`tests/unit/checkup/plan-corpus.test.ts`);
 * here each test isolates ONE of the four filters and the ordering, so a
 * failure names the rule that broke rather than the guide that changed.
 */
import { describe, expect, it } from "vitest";

import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { deriveBike } from "@/lib/bike/rules";
import type { BikeBuild } from "@/lib/domain/schema/part";
import type { ProcedureStep } from "@/lib/domain/schema/procedure";

import {
  hostOf,
  parseStepKey,
  planCheckup,
  scopeFromPartIds,
  stepKeyOf,
  toolRefs,
  toolsFor,
  type PlannableGuide,
} from "./plan";
import type { PartId } from "@/lib/domain/data/parts";

function buildOf(preset: keyof typeof BIKE_PRESETS): BikeBuild {
  // eslint-disable-next-line security/detect-object-injection -- a literal preset id
  const derived = deriveBike(BIKE_PRESETS[preset]);
  return { spec: derived.spec, parts: derived.parts };
}

const GRAVEL = buildOf("gravel-1x11");
const ROAD_RIM = buildOf("road-rim-2x11");

function step(overrides: Partial<ProcedureStep<string>> = {}): ProcedureStep<string> {
  return {
    id: "pad-wear",
    title: "Usure des plaquettes",
    checkQuestion: {
      prompt: "Reste-t-il 1 mm ?",
      skippable: true,
      ko: [
        {
          action: "replace",
          partId: "brake-pads-front",
          reasonKey: "pad-worn",
          guideSlug: "replace-brake-pads-disc",
        },
      ],
    },
    ...overrides,
  };
}

function guide(overrides: Partial<PlannableGuide> = {}): PlannableGuide {
  return {
    slug: "check-brakes-disc",
    kind: "check",
    order: 20,
    partIds: ["brake-pads-front"],
    tools: [],
    steps: [step()],
    ...overrides,
  };
}

describe("stepKeyOf / parseStepKey", () => {
  it("round-trips a key", () => {
    expect(stepKeyOf("check-drivetrain", "chain-wear")).toBe("check-drivetrain#chain-wear");
    expect(parseStepKey("check-drivetrain#chain-wear")).toEqual({
      guideSlug: "check-drivetrain",
      stepId: "chain-wear",
    });
  });

  it("refuses anything that is not one", () => {
    expect(parseStepKey("check-drivetrain")).toBeNull();
    expect(parseStepKey("#chain-wear")).toBeNull();
    expect(parseStepKey("check-drivetrain#")).toBeNull();
  });
});

describe("hostOf", () => {
  it("sends a hosted part to the part it is clicked through", () => {
    expect(hostOf("brake-pads-front")).toBe("brake-caliper-front");
    expect(hostOf("brake-caliper-front")).toBe("brake-caliper-front");
  });

  it("is null for anything that is not a part", () => {
    expect(hostOf("not-a-part")).toBeNull();
  });
});

describe("scopeFromPartIds", () => {
  it("treats an empty selection as a full checkup", () => {
    expect(scopeFromPartIds([])).toEqual({ kind: "full" });
  });

  it("keeps the picked parts otherwise", () => {
    expect(scopeFromPartIds(["chain"] as PartId[])).toEqual({ kind: "parts", partIds: ["chain"] });
  });
});

describe("planCheckup", () => {
  it("only plans check guides", () => {
    const plan = planCheckup(GRAVEL, { kind: "full" }, [guide({ kind: "replace" })]);
    expect(plan).toEqual([]);
  });

  it("drops a guide whose appliesTo the bike does not satisfy", () => {
    const disc = guide({ appliesTo: { path: "brakes.isDisc", in: [true] } });
    expect(planCheckup(GRAVEL, { kind: "full" }, [disc])).toHaveLength(1);
    expect(planCheckup(ROAD_RIM, { kind: "full" }, [disc])).toEqual([]);
  });

  it("drops a step whose own appliesTo the bike does not satisfy", () => {
    const hydraulic = guide({
      steps: [step({ appliesTo: { path: "brakes.type", in: ["disc-hydraulic"] } })],
    });
    expect(planCheckup(GRAVEL, { kind: "full" }, [hydraulic])).toHaveLength(1);
    expect(planCheckup(ROAD_RIM, { kind: "full" }, [hydraulic])).toEqual([]);
  });

  it("ignores a step with no checkQuestion", () => {
    expect(
      planCheckup(GRAVEL, { kind: "full" }, [
        guide({ steps: [{ id: "intro", title: "Avant de commencer" }] }),
      ]),
    ).toEqual([]);
  });

  it("drops a step about a part this bike does not carry", () => {
    const rack = guide({ partIds: ["rack"], steps: [step({ partIds: ["rack"] })] });
    expect(planCheckup(GRAVEL, { kind: "full" }, [rack])).toEqual([]);
  });

  it("ignores a fitted part the catalogue no longer has", () => {
    // A bike row written before a taxonomy change, re-derived: the part is on
    // the bike but nothing knows what it is, so it asks no question.
    const stale: BikeBuild = {
      spec: GRAVEL.spec,
      parts: [...GRAVEL.parts, { partId: "retired-widget", attributes: {} }],
    };
    const widget = guide({
      partIds: ["retired-widget"],
      steps: [step({ partIds: ["retired-widget"] })],
    });
    expect(planCheckup(stale, { kind: "full" }, [widget])).toEqual([]);
  });

  it("falls back to the guide's partIds when the step names none", () => {
    const plan = planCheckup(GRAVEL, { kind: "full" }, [guide()]);
    expect(plan[0].partIds).toEqual(["brake-caliper-front"]);
  });

  it("expands hosted parts to their host, once each", () => {
    const plan = planCheckup(GRAVEL, { kind: "full" }, [
      guide({
        partIds: ["brake-pads-front", "brake-caliper-front"],
        steps: [step({ partIds: ["brake-pads-front", "brake-caliper-front"] })],
      }),
    ]);
    expect(plan[0].partIds).toEqual(["brake-caliper-front"]);
  });

  it("keeps a step whose parts intersect the picked ones, through their host", () => {
    const guides = [
      guide(),
      guide({
        slug: "check-drivetrain",
        partIds: ["chain"],
        steps: [step({ id: "chain-wear", partIds: ["chain"] })],
      }),
    ];
    const scoped = planCheckup(
      GRAVEL,
      { kind: "parts", partIds: ["brake-caliper-front"] as PartId[] },
      guides,
    );
    expect(scoped.map((entry) => entry.key)).toEqual(["check-brakes-disc#pad-wear"]);
  });

  it("ignores a picked part that is not a part at all", () => {
    const scoped = planCheckup(
      GRAVEL,
      { kind: "parts", partIds: ["../etc/passwd"] as unknown as PartId[] },
      [guide()],
    );
    expect(scoped).toEqual([]);
  });

  it("drops a KO consequence about a part the bike does not carry", () => {
    const plan = planCheckup(GRAVEL, { kind: "full" }, [
      guide({
        steps: [
          step({
            checkQuestion: {
              prompt: "?",
              skippable: false,
              ko: [
                {
                  action: "replace",
                  partId: "brake-pads-front",
                  reasonKey: "pad-worn",
                  guideSlug: "replace-brake-pads-disc",
                },
                {
                  action: "replace",
                  partId: "rack",
                  reasonKey: "accessory-loose",
                  guideSlug: "check-frame-bolts",
                },
              ],
            },
          }),
        ],
      }),
    ]);
    expect(plan[0].ko.map((consequence) => consequence.partId)).toEqual(["brake-pads-front"]);
  });

  it("deduplicates a guide passed twice (both locales of the corpus)", () => {
    expect(planCheckup(GRAVEL, { kind: "full" }, [guide(), guide()])).toHaveLength(1);
  });

  it("orders by checkupPriority, then the guide's order, then the step's index", () => {
    const brakes = guide({ order: 99, steps: [step(), step({ id: "caliper" })] });
    const chain = guide({
      slug: "check-drivetrain",
      order: 1,
      partIds: ["chain"],
      steps: [step({ id: "chain-wear", partIds: ["chain"] })],
    });
    const plan = planCheckup(GRAVEL, { kind: "full" }, [chain, brakes]);
    // Brakes carry a lower checkupPriority than the chain, whatever the guide's
    // own order says; inside the guide the author's step order is kept.
    expect(plan.map((entry) => entry.key)).toEqual([
      "check-brakes-disc#pad-wear",
      "check-brakes-disc#caliper",
      "check-drivetrain#chain-wear",
    ]);
  });

  it("breaks a total tie on the key, so the order is stable", () => {
    const a = guide({ slug: "check-b", steps: [step({ id: "one" })] });
    const b = guide({ slug: "check-a", steps: [step({ id: "one" })] });
    const plan = planCheckup(GRAVEL, { kind: "full" }, [a, b]);
    expect(plan.map((entry) => entry.key)).toEqual(["check-a#one", "check-b#one"]);
  });

  it("badges a stub guide's steps", () => {
    const plan = planCheckup(GRAVEL, { kind: "full" }, [guide({ status: "stub" })]);
    expect(plan[0].stub).toBe(true);
    expect(
      planCheckup(GRAVEL, { kind: "full" }, [guide({ status: "full" })])[0].stub,
    ).toBeUndefined();
  });

  it("carries the step's own words and position", () => {
    const plan = planCheckup(GRAVEL, { kind: "full" }, [
      guide({ steps: [{ id: "intro", title: "Intro" }, step()] }),
    ]);
    expect(plan[0]).toMatchObject({
      title: "Usure des plaquettes",
      prompt: "Reste-t-il 1 mm ?",
      number: 2,
      skippable: true,
    });
  });
});

describe("toolRefs", () => {
  it("drops tool ids the catalogue does not know, and self-references", () => {
    expect(
      toolRefs([
        { toolId: "chain-checker", alternatives: ["steel-ruler", "chain-checker", "hammer"] },
        { toolId: "sonic-screwdriver", alternatives: ["allen-keys"] },
      ]),
    ).toEqual([{ toolId: "chain-checker", alternatives: ["steel-ruler"] }]);
  });
});

describe("toolsFor", () => {
  it("unions the plan's tools in catalogue order, keeping every alternative", () => {
    const plan = planCheckup(GRAVEL, { kind: "full" }, [
      guide({
        tools: [
          { toolId: "rags", alternatives: [] },
          { toolId: "chain-checker", alternatives: ["steel-ruler"] },
        ],
      }),
      guide({
        slug: "check-drivetrain",
        partIds: ["chain"],
        steps: [step({ id: "chain-wear", partIds: ["chain"] })],
        tools: [
          { toolId: "chain-checker", alternatives: ["tape-measure"] },
          { toolId: "allen-keys", alternatives: ["multi-tool"] },
        ],
      }),
    ]);
    expect(toolsFor(plan)).toEqual([
      { toolId: "allen-keys", alternatives: ["multi-tool"] },
      { toolId: "chain-checker", alternatives: ["steel-ruler", "tape-measure"] },
      { toolId: "rags", alternatives: [] },
    ]);
  });

  it("is empty for an empty plan", () => {
    expect(toolsFor([])).toEqual([]);
  });
});
