import { describe, expect, it } from "vitest";

import { PRESET_IDS, type BikeBuild, type BikeSpec } from "@/lib/domain";
import { RENDERED_PART_IDS } from "@/lib/domain/data/parts";
import { addOptionalPart, meshIdsForSpec } from "@/lib/domain/engine/validate-build";

import { buildFromAnswers, enumerateBuilds, presetBuild } from "./builds";
import {
  isRenderedPartId,
  PART_RENDERERS,
  planScene,
  recipePoints,
  sceneSphere,
  type RenderedPartId,
} from "./scene";
import type { GeometryRecipe } from "./types";

const withPart = (build: BikeBuild, partId: string): BikeBuild => {
  const change = addOptionalPart(build, partId);
  if (!change.ok) throw new Error(`cannot add ${partId}: ${change.code}`);
  return change.build;
};

/**
 * The enumerated spec space, built once at import. Module scope is not charged
 * to a test's timeout — the same move `solver.test.ts` made for the same reason.
 */
const BUILDS = enumerateBuilds();

/** Each part the scene draws only for some specs, and the spec property that decides. */
const CONDITIONAL_PARTS: ReadonlyArray<[RenderedPartId, (spec: BikeSpec) => boolean]> = [
  ["rotor-front", (spec) => spec.brakes.isDisc],
  ["rotor-rear", (spec) => spec.brakes.isDisc],
  ["front-derailleur", (spec) => spec.drivetrain.chainrings >= 2],
  ["rear-shock", (spec) => spec.suspension.rear],
  ["e-motor", (spec) => spec.eSystem !== null],
  ["e-battery", (spec) => spec.eSystem !== null],
  ["internal-gear-hub", (spec) => spec.drivetrain.kind === "igh"],
  ["rear-derailleur", (spec) => spec.drivetrain.kind === "derailleur"],
];

const labelOf = ({ spec }: BikeBuild): string =>
  JSON.stringify([spec.discipline, spec.brakes.type, spec.drivetrain.kind, spec.suspension]);

const recipesOf = (build: BikeBuild, partId: string): GeometryRecipe[] =>
  planScene(build)
    .parts.find((part) => part.partId === partId)!
    .meshes.flatMap((mesh) => mesh.recipes);

describe("PART_RENDERERS", () => {
  it("covers exactly the rendered parts of the domain", () => {
    expect(Object.keys(PART_RENDERERS).sort()).toEqual([...RENDERED_PART_IDS].sort());
    expect(isRenderedPartId("frame")).toBe(true);
    expect(isRenderedPartId("brake-pads-front")).toBe(false);
    expect(isRenderedPartId("__proto__")).toBe(false);
  });
});

describe("planScene", () => {
  it.each(PRESET_IDS)("%s draws each rendered part of the build exactly once", (id) => {
    const build = presetBuild(id);
    const plan = planScene(build);
    const expected = build.parts
      .map((p) => p.partId)
      .filter((partId) => RENDERED_PART_IDS.includes(partId as never));
    expect(plan.partIds).toEqual(expected);
    expect(new Set(plan.partIds).size).toBe(plan.partIds.length);
    // Same count as the domain's own mesh list.
    expect(plan.partIds).toHaveLength(meshIdsForSpec(build.spec).length);
    for (const part of plan.parts) {
      expect(part.meshes.length, part.partId).toBeGreaterThan(0);
      expect(
        part.meshes.every((mesh) => mesh.recipes.length > 0),
        part.partId,
      ).toBe(true);
      expect(part.focus.radius, part.partId).toBeGreaterThanOrEqual(0.05);
    }
  });

  it("draws conditional parts iff the spec needs them", () => {
    // Nine invariants over 6 800 builds. They are compared in plain JS and
    // asserted once: 61 200 `expect()` calls in this loop took 5.3 s on CI's
    // two-core runner under v8 coverage and timed the test out (.debug/009).
    // The report is a Set because thousands of builds share a spec shape and
    // the label names that shape — a real break lists each distinct one once,
    // where the old loop stopped at the first.
    const wrong = new Set<string>();
    for (const build of BUILDS) {
      const ids = new Set(planScene(build).partIds);
      for (const [partId, needed] of CONDITIONAL_PARTS) {
        const expected = needed(build.spec);
        if (ids.has(partId) !== expected)
          wrong.add(`${labelOf(build)} ${partId}: expected ${expected}`);
      }
      if (ids.has("chain") === ids.has("belt"))
        wrong.add(`${labelOf(build)} exactly one of chain / belt`);
    }
    expect([...wrong].sort()).toEqual([]);
  });

  it("draws the dropper's wider tube only on a dropper post", () => {
    expect(recipesOf(presetBuild("mtb-full-dropper-1x12"), "seatpost")).toHaveLength(3);
    expect(recipesOf(presetBuild("mtb-hardtail-1x12"), "seatpost")).toHaveLength(2);
  });

  it("draws optional accessories once they are added", () => {
    let build = presetBuild("gravel-1x11");
    expect(planScene(build).partIds).not.toContain("rack");
    build = withPart(withPart(withPart(build, "rack"), "lights"), "kickstand");
    build = withPart(build, "mudguards");
    const plan = planScene(build);
    expect(plan.partIds).toEqual(
      expect.arrayContaining(["rack", "lights", "kickstand", "mudguards"]),
    );
    // Rear light sits on the rack when there is one.
    const withRack = recipesOf(build, "lights")[1] as Extract<GeometryRecipe, { kind: "box" }>;
    const withoutRack = recipesOf(
      withPart(presetBuild("gravel-1x11"), "lights"),
      "lights",
    )[1] as Extract<GeometryRecipe, { kind: "box" }>;
    expect(withRack.center).not.toEqual(withoutRack.center);
  });

  it("ignores unknown, hosted and duplicated parts", () => {
    const build = presetBuild("road-rim-2x11");
    const noisy = {
      spec: build.spec,
      parts: [
        ...build.parts,
        { partId: "frame", attributes: {} },
        { partId: "not-a-part", attributes: {} },
        { partId: "brake-pads-front", attributes: {} },
      ],
    } as BikeBuild;
    expect(planScene(noisy).partIds).toEqual(planScene(build).partIds);
  });

  it("describes every cockpit, brake, frame and e-system variant", () => {
    const variants = [
      { cockpit: "drop" },
      { cockpit: "flat" },
      { cockpit: "riser", discipline: "mtb" },
      { cockpit: "swept", discipline: "city-hybrid" },
      { "brake-type": "v-brake" },
      { "brake-type": "cantilever" },
      { "brake-type": "rim-caliper" },
      { "brake-type": "disc-mechanical" },
      { drive: "electric", "e-motor": "mid-drive", "e-battery": "external-downtube" },
      { drive: "electric", "e-motor": "hub-rear", "e-battery": "rack" },
      { drive: "electric", "e-motor": "mid-drive", "e-battery": "integrated" },
      { drivetrain: "singlespeed", transmission: "belt" },
      { drivetrain: "igh", transmission: "chain", shifter: "grip" },
      { drivetrain: "derailleur-3x" },
      { discipline: "kids" },
    ] as const;
    const hashes = new Set<string>();
    for (const answers of variants) {
      const plan = planScene(buildFromAnswers({ discipline: "road", ...answers }));
      hashes.add(plan.hash);
      expect(
        plan.parts.every((p) => p.meshes.length > 0),
        JSON.stringify(answers),
      ).toBe(true);
    }
    expect(hashes.size).toBe(variants.length);
  });

  it("the step-through frame bends its down tube and has no top tube", () => {
    const city = recipesOf(presetBuild("city-igh-8-hub-motor"), "frame");
    expect(city.some((r) => r.kind === "path")).toBe(true);
    const road = recipesOf(presetBuild("road-rim-2x11"), "frame");
    expect(road.some((r) => r.kind === "path")).toBe(false);
    expect(road).toHaveLength(city.length);
  });

  it("hashes deterministically and changes with the inputs", () => {
    const build = presetBuild("gravel-1x11");
    expect(planScene(build).hash).toBe(planScene(presetBuild("gravel-1x11")).hash);
    expect(planScene(build, { saddleHeightMm: 700 }).hash).not.toBe(planScene(build).hash);
    expect(planScene(build).hash).not.toBe(planScene(presetBuild("road-rim-2x11")).hash);
  });

  it("frames the whole bike", () => {
    const plan = planScene(presetBuild("mtb-full-dropper-1x12"));
    const { center, radius } = sceneSphere(plan);
    expect(radius).toBeGreaterThan(0.8);
    expect(radius).toBeLessThan(1.6);
    expect(center[0]).toBeGreaterThan(plan.bounds.min[0]);
    expect(center[0]).toBeLessThan(plan.bounds.max[0]);
  });
});

describe("recipePoints", () => {
  it("spans every recipe kind", () => {
    const c = [0, 0, 0] as const;
    expect(recipePoints({ kind: "tube", from: c, to: [1, 0, 0], radius: 0.1 })).toHaveLength(2);
    expect(recipePoints({ kind: "capsule", from: c, to: [1, 0, 0], radius: 0.1 })).toHaveLength(2);
    expect(
      recipePoints({ kind: "path", points: [c, c, c], radius: 0.1, closed: false }),
    ).toHaveLength(3);
    expect(recipePoints({ kind: "torus", center: c, radius: 0.3, tube: 0.02 })[1]).toEqual([
      0.32, 0.32, 0.02,
    ]);
    expect(recipePoints({ kind: "disc", center: c, radius: 0.1, thickness: 0.02 })[0]).toEqual([
      -0.1, -0.1, -0.01,
    ]);
    expect(
      recipePoints({
        kind: "gear",
        center: c,
        teeth: 40,
        pitchRadius: 0.1,
        thickness: 0.002,
      })[1][0],
    ).toBeCloseTo(0.105);
    expect(recipePoints({ kind: "box", center: c, size: [2, 4, 6], rotationZ: 0 })).toEqual([
      [-1, -2, -3],
      [1, 2, 3],
    ]);
  });
});
