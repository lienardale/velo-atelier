import { describe, expect, it } from "vitest";

import type { GuideSummary } from "@/lib/content/types";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import type { SpecCondition } from "@/lib/domain/schema/condition";

import {
  bestGuideFor,
  conditionSpecificity,
  findPartRow,
  guidesFor,
  isPartOnBike,
  partActionGuides,
  partGroups,
  partIdsOfGroup,
  SYSTEM_ORDER,
} from "./queries";
import { buildOf, deriveBike } from "./rules";

const gravel = buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"]));
const roadRim = buildOf(deriveBike(BIKE_PRESETS["road-rim-2x11"]));
const emtb = buildOf(deriveBike(BIKE_PRESETS["emtb-mid-1x12"]));

function guide(slug: string, appliesTo?: SpecCondition<string>): GuideSummary {
  return {
    slug,
    locale: "fr",
    kind: slug.split("-")[0] as GuideSummary["kind"],
    title: slug,
    summary: slug,
    status: "full",
    difficulty: 1,
    minutes: 10,
    order: 1,
    partIds: [],
    systems: [],
    ...(appliesTo === undefined ? {} : { appliesTo }),
  };
}

const GUIDES: GuideSummary[] = [
  guide("replace-tube-tire", { path: "tires.system", in: ["clincher-tube"] }),
  guide("replace-tire-tubeless", { path: "tires.system", in: ["tubeless"] }),
  guide("replace-chain"),
  guide("clean-chain"),
  guide("clean-drivetrain"),
  guide("replace-brake-pads-disc", { path: "brakes.isDisc", in: [true] }),
  guide("replace-brake-pads-rim", { path: "brakes.isDisc", in: [false] }),
];

describe("guidesFor", () => {
  it("offers only the guides whose appliesTo matches this bike", () => {
    // gravel-1x11 is tubeless.
    expect(guidesFor(GUIDES, gravel, "tire-front", "replace").map((g) => g.slug)).toEqual([
      "replace-tire-tubeless",
    ]);
    expect(guidesFor(GUIDES, roadRim, "tire-front", "replace").map((g) => g.slug)).toEqual([
      "replace-tube-tire",
    ]);
  });

  it("puts the most specific appliesTo first, ahead of the catalogue order", () => {
    // `chain.procedures.clean` is [clean-chain, clean-drivetrain]; giving the
    // SECOND one a condition that this e-bike satisfies must move it first.
    const cleanGuides = [
      guide("clean-chain"),
      guide("clean-drivetrain", { path: "drive", in: ["electric"] }),
    ];
    expect(guidesFor(cleanGuides, emtb, "chain", "clean").map((g) => g.slug)).toEqual([
      "clean-drivetrain",
      "clean-chain",
    ]);
    // …and on a muscular bike the conditional one is not offered at all.
    expect(guidesFor(cleanGuides, gravel, "chain", "clean").map((g) => g.slug)).toEqual([
      "clean-chain",
    ]);
  });

  it("keeps the author's order between equally specific guides", () => {
    expect(guidesFor(GUIDES, gravel, "chain", "clean").map((g) => g.slug)).toEqual([
      "clean-chain",
      "clean-drivetrain",
    ]);
  });

  it("returns nothing for a part that declares no guide of that kind", () => {
    expect(guidesFor(GUIDES, gravel, "chain", "measure")).toEqual([]);
    expect(guidesFor(GUIDES, gravel, "no-such-part", "replace")).toEqual([]);
  });

  it("skips a slug the corpus does not contain", () => {
    expect(guidesFor([], gravel, "chain", "replace")).toEqual([]);
    expect(bestGuideFor([], gravel, "chain", "replace")).toBeNull();
  });

  it("counts the leaves of a condition as its specificity", () => {
    expect(conditionSpecificity(guide("a"))).toBe(0);
    expect(conditionSpecificity(guide("b", { path: "brakes.isDisc", in: [true] }))).toBe(1);
    expect(
      conditionSpecificity(
        guide("c", {
          all: [
            { path: "brakes.isDisc", in: [true] },
            { path: "drive", in: ["electric"] },
          ],
        }),
      ),
    ).toBe(2);
  });

  it("gives the panel one guide per action", () => {
    const actions = partActionGuides(GUIDES, gravel, "brake-pads-front");
    expect(actions.replace?.slug).toBe("replace-brake-pads-disc");
    expect(actions.clean).toBeUndefined();
    expect(actions.adjust).toBeUndefined();
  });
});

describe("partGroups", () => {
  it("groups by system in the panel's order", () => {
    const groups = partGroups(gravel);
    const systems = groups.map((group) => group.system);
    expect(systems).toEqual(SYSTEM_ORDER.filter((system) => systems.includes(system)));
    expect(systems).toContain("drivetrain");
    expect(systems).not.toContain("e-system");
  });

  it("nests a hosted part under its host and never at the top level", () => {
    const groups = partGroups(gravel);
    const brakes = groups.find((group) => group.system === "brakes")!;
    const caliper = brakes.rows.find((row) => row.partId === "brake-caliper-front")!;
    expect(caliper.hosted.map((row) => row.partId)).toContain("brake-pads-front");
    expect(brakes.rows.map((row) => row.partId)).not.toContain("brake-pads-front");
  });

  it("lists every fitted part exactly once, host or hosted", () => {
    for (const build of [gravel, roadRim, emtb]) {
      const listed = partGroups(build).flatMap(partIdsOfGroup);
      expect([...listed].sort()).toEqual(build.parts.map((part) => part.partId).sort());
      expect(new Set(listed).size).toBe(listed.length);
    }
  });

  it("promotes a hosted part whose host is missing rather than losing it", () => {
    const orphaned = {
      spec: gravel.spec,
      parts: gravel.parts.filter((part) => part.partId !== "brake-caliper-front"),
    };
    const listed = partGroups(orphaned).flatMap(partIdsOfGroup);
    expect(listed).toContain("brake-pads-front");
  });

  it("shows the e-system only on an e-bike", () => {
    expect(partGroups(emtb).map((group) => group.system)).toContain("e-system");
  });
});

describe("one part", () => {
  it("knows whether a part is on this bike", () => {
    expect(isPartOnBike(gravel, "chain")).toBe(true);
    expect(isPartOnBike(gravel, "e-motor")).toBe(false);
    expect(isPartOnBike(gravel, "not-a-part")).toBe(false);
  });

  it("finds a hosted row as readily as a top-level one", () => {
    expect(findPartRow(gravel, "chain")?.partId).toBe("chain");
    expect(findPartRow(gravel, "brake-pads-front")?.partId).toBe("brake-pads-front");
    expect(findPartRow(gravel, "e-motor")).toBeNull();
  });
});
