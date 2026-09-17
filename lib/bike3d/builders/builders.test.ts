import {
  Box3,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Quaternion,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import { PRESET_IDS } from "@/lib/domain";

import { presetBuild } from "../builds";
import { planScene } from "../scene";
import type { GeometryRecipe, QualityTier } from "../types";
import { boxGeometry } from "./bars";
import { frameGeometry, mergeAll, recipeGeometry, triangleCount } from "./frame";
import { gearGeometry, gearProfile } from "./gear";
import { geometryTierFor, LOD_TABLE } from "./lod";
import { bentTube, capsuleBetween, orientBetween, tubeBetween } from "./tube";
import { discGeometry, spokeGeometry, spokeMatrices, torusGeometry } from "./wheel";

const high = LOD_TABLE.high;
const low = LOD_TABLE.low;

const size = (geometry: BufferGeometry) =>
  new Box3()
    .setFromBufferAttribute(geometry.getAttribute("position") as never)
    .getSize(new Vector3());

/** §3.4 triangle budgets, on geometry alone (spokes included). */
const TRIANGLE_BUDGET: Record<QualityTier, number> = { low: 60_000, med: 110_000, high: 150_000 };

describe("primitives", () => {
  it("orients a tube between two points", () => {
    const g = tubeBetween([0, 0, 0], [1, 0, 0], 0.01, high);
    const s = size(g);
    expect(s.x).toBeCloseTo(1, 6);
    expect(s.y).toBeCloseTo(0.02, 3);
    const zeroLength = tubeBetween([1, 1, 1], [1, 1, 1], 0.01, high);
    expect(triangleCount(zeroLength)).toBeGreaterThan(0);
    expect(
      orientBetween(new CylinderGeometry(1, 1, 2), [0, 0, 0], [0, 0, 0]).getAttribute("position")
        .count,
    ).toBeGreaterThan(0);
  });

  it("bends tubes through points, open and closed", () => {
    const open = bentTube(
      [
        [0, 0, 0],
        [0.5, 0.2, 0],
        [1, 0, 0],
      ],
      0.01,
      false,
      high,
    );
    const closed = bentTube(
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
      0.01,
      true,
      low,
    );
    expect(triangleCount(open)).toBeGreaterThan(0);
    expect(size(closed).x).toBeGreaterThan(0.9);
  });

  it("builds capsules, tori, discs and boxes where asked", () => {
    expect(size(capsuleBetween([0, 0, 0], [0, 1, 0], 0.02, high)).y).toBeCloseTo(1.04, 3);
    const torus = torusGeometry([1, 0, 0], 0.3, 0.02, high);
    expect(size(torus).x).toBeCloseTo(0.64, 3);
    expect(size(discGeometry([0, 0, 0], 0.1, 0.004, low)).z).toBeCloseTo(0.004, 6);
    const box = boxGeometry([0, 0, 0], [0.2, 0.1, 0.05], Math.PI / 2);
    expect(size(box).x).toBeCloseTo(0.1, 6);
    expect(size(boxGeometry([1, 0, 0], [0.2, 0.1, 0.05], 0)).x).toBeCloseTo(0.2, 6);
  });

  it("draws teeth on the high tier and a cylinder on the low tier", () => {
    const shape = gearProfile(40, 0.08);
    expect(shape.getPoints().length).toBeGreaterThanOrEqual(160);
    const toothed = gearGeometry([0, 0, -0.05], 40, 0.08, 0.002, high);
    expect(toothed).toBeInstanceOf(ExtrudeGeometry);
    expect(size(toothed).z).toBeCloseTo(0.002, 6);
    const plain = gearGeometry([0, 0, -0.05], 40, 0.08, 0.002, low);
    expect(plain).toBeInstanceOf(CylinderGeometry);
    expect(triangleCount(plain)).toBeLessThan(triangleCount(toothed));
  });

  it("instances 32 spokes from hub to rim", () => {
    const matrices = spokeMatrices({
      key: "s",
      material: "steel",
      center: [0, 0, 0],
      hubRadius: 0.02,
      rimRadius: 0.3,
      count: 32,
      flangeOffset: 0.03,
    });
    expect(matrices).toHaveLength(32);
    const scale = new Vector3();
    matrices[0]!.decompose(new Vector3(), new Quaternion(), scale);
    expect(scale.y).toBeGreaterThan(0.27);
    expect(scale.y).toBeLessThan(0.31);
    expect(spokeGeometry().getAttribute("position").count).toBeGreaterThan(0);
  });
});

describe("recipes and merging", () => {
  const recipes: GeometryRecipe[] = [
    { kind: "tube", from: [0, 0, 0], to: [1, 0, 0], radius: 0.01 },
    {
      kind: "path",
      points: [
        [0, 0, 0],
        [0.5, 0.5, 0],
        [1, 0, 0],
      ],
      radius: 0.01,
      closed: false,
    },
    { kind: "capsule", from: [0, 0, 0], to: [0, 1, 0], radius: 0.02 },
    { kind: "torus", center: [0, 0, 0], radius: 0.3, tube: 0.01 },
    { kind: "disc", center: [0, 0, 0], radius: 0.1, thickness: 0.002 },
    { kind: "gear", center: [0, 0, 0], teeth: 30, pitchRadius: 0.06, thickness: 0.002 },
    { kind: "box", center: [0, 0, 0], size: [0.1, 0.1, 0.1], rotationZ: 0.3 },
  ];

  it("builds every recipe kind with position, normal and uv", () => {
    for (const recipe of recipes) {
      const g = recipeGeometry(recipe, high);
      expect(g.getAttribute("position"), recipe.kind).toBeDefined();
      expect(g.getAttribute("normal"), recipe.kind).toBeDefined();
      expect(g.getAttribute("uv"), recipe.kind).toBeDefined();
    }
  });

  it("merges indexed and non-indexed geometry into one", () => {
    const parts = recipes.map((r) => recipeGeometry(r, high));
    const triangles = parts.reduce((n, g) => n + triangleCount(g), 0);
    const merged = mergeAll(parts);
    expect(merged.index).toBeNull();
    expect(triangleCount(merged)).toBe(triangles);
    const indexedOnly = mergeAll([
      recipeGeometry(recipes[0]!, low),
      recipeGeometry(recipes[3]!, low),
    ]);
    expect(indexedOnly.index).not.toBeNull();
    const single = recipeGeometry(recipes[0]!, low);
    expect(mergeAll([single])).toBe(single);
  });

  it("refuses incompatible attributes", () => {
    const a = new BufferGeometry();
    a.setAttribute(
      "position",
      tubeBetween([0, 0, 0], [1, 0, 0], 0.01, low).getAttribute("position"),
    );
    const b = tubeBetween([0, 0, 0], [1, 0, 0], 0.01, low);
    expect(() => mergeAll([a, b])).toThrow(/mergeGeometries failed/);
  });

  it("maps quality to a geometry tier", () => {
    expect(geometryTierFor("low")).toBe("low");
    expect(geometryTierFor("med")).toBe("high");
    expect(geometryTierFor("high")).toBe("high");
  });
});

describe("§3.4 budgets on geometry", () => {
  it.each(PRESET_IDS)("%s fits the triangle budget and draw calls at every tier", (id) => {
    const plan = planScene(presetBuild(id));
    for (const quality of ["low", "med", "high"] as const) {
      const tier = geometryTierFor(quality);
      let triangles = 0;
      let calls = 0;
      for (const part of plan.parts) {
        for (const mesh of part.meshes) {
          const geometry = frameGeometry(mesh, tier);
          expect(geometry.boundingSphere, part.partId).not.toBeNull();
          triangles += triangleCount(geometry);
          calls += 1;
          geometry.dispose();
        }
        for (const spokes of part.spokes) {
          triangles += triangleCount(spokeGeometry()) * spokes.count;
          calls += 1;
        }
      }
      expect(triangles, `${id} ${quality}`).toBeLessThanOrEqual(TRIANGLE_BUDGET[quality]);
      expect(calls, `${id} ${quality}`).toBeLessThanOrEqual(quality === "low" ? 45 : 60);
    }
  });
});
