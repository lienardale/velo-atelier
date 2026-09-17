import { describe, expect, it } from "vitest";

import { PRESET_IDS } from "@/lib/domain";

import { presetBuild } from "./builds";
import { planScene } from "./scene";
import { MIN_STROKE_MM, projectRecipe, silhouetteFor } from "./silhouette";

describe("silhouetteFor", () => {
  it.each(PRESET_IDS)("%s renders exactly one entry per rendered part", (id) => {
    const plan = planScene(presetBuild(id));
    const silhouette = silhouetteFor(plan);
    expect(silhouette.parts.map((p) => p.partId).sort()).toEqual([...plan.partIds].sort());
    expect(silhouette.parts.every((p) => p.shapes.length > 0)).toBe(true);
    const numbers = silhouette.viewBox.split(" ").map(Number);
    expect(numbers.every(Number.isFinite)).toBe(true);
    expect(silhouette.width).toBeGreaterThan(1500);
    expect(silhouette.height).toBeGreaterThan(800);
  });

  it("paints far parts (+Z) before near ones", () => {
    const silhouette = silhouetteFor(planScene(presetBuild("road-disc-2x12")));
    const order = silhouette.parts.map((p) => p.partId);
    // Rotors sit on +Z (far from the drive-side camera), the chain on −Z.
    expect(order.indexOf("rotor-front")).toBeLessThan(order.indexOf("chain"));
    expect(order.indexOf("pedal-left")).toBeLessThan(order.indexOf("pedal-right"));
  });
});

describe("parts seen end-on", () => {
  it("draws a Z-aligned tube (axle, grip, BB shell) as the disc a side view shows", () => {
    const axle = projectRecipe({
      kind: "tube",
      from: [0, 0, -0.075],
      to: [0, 0, 0.075],
      radius: 0.006,
    });
    expect(axle).toEqual({
      type: "circle",
      cx: -0,
      cy: -0,
      r: 6, // the axle is 12 mm across, wider than the minimum stroke
      width: 0,
      filled: true,
    });
    const stay = projectRecipe({
      kind: "tube",
      from: [0, 0, 0],
      to: [-0.4, 0.07, 0.06],
      radius: 0.009,
    });
    expect(stay.type).toBe("line");
  });

  it("so a flat-bar bike's grips are still drawn and clickable", () => {
    const grips = silhouetteFor(planScene(presetBuild("mtb-hardtail-1x12"))).parts.find(
      (part) => part.partId === "grips-or-tape",
    )!;
    expect(grips.shapes).toHaveLength(2);
    expect(grips.shapes.every((shape) => shape.type === "circle")).toBe(true);
  });
});

describe("projectRecipe", () => {
  it("mirrors x (drive-side view) and flips y (SVG down), in millimetres", () => {
    expect(
      projectRecipe({ kind: "tube", from: [0.1, 0.2, 0], to: [-0.3, 0, 0], radius: 0.01 }),
    ).toEqual({
      type: "line",
      x1: -100,
      y1: -200,
      x2: 300,
      y2: -0,
      width: 20,
    });
  });

  it("never draws a stroke thinner than the tappable minimum", () => {
    const shape = projectRecipe({
      kind: "capsule",
      from: [0, 0, 0],
      to: [1, 0, 0],
      radius: 0.0005,
    });
    expect(shape).toMatchObject({ type: "line", width: MIN_STROKE_MM });
  });

  it("projects paths, tori, discs, gears and rotated boxes", () => {
    expect(
      projectRecipe({
        kind: "path",
        points: [
          [0, 0, 0],
          [0.1, 0.1, 0],
        ],
        radius: 0.004,
        closed: true,
      }),
    ).toEqual({ type: "polyline", points: "0,0 -100,-100", width: 8, closed: true });
    expect(
      projectRecipe({ kind: "torus", center: [0.5, 0, 0], radius: 0.311, tube: 0.02 }),
    ).toEqual({
      type: "circle",
      cx: -500,
      cy: -0,
      r: 311,
      width: 40,
      filled: false,
    });
    expect(
      projectRecipe({ kind: "disc", center: [0, 0, 0], radius: 0.08, thickness: 0.002 }),
    ).toMatchObject({
      type: "circle",
      r: 80,
      filled: true,
    });
    expect(
      projectRecipe({
        kind: "gear",
        center: [0, 0, 0],
        teeth: 40,
        pitchRadius: 0.081,
        thickness: 0.002,
      }),
    ).toMatchObject({ type: "circle", r: 81, filled: true });
    const box = projectRecipe({
      kind: "box",
      center: [0, 0, 0],
      size: [0.2, 0.1, 0.1],
      rotationZ: Math.PI / 2,
    });
    expect(box.type).toBe("polygon");
    const points = (box as { points: string }).points
      .split(" ")
      .map((p) => p.split(",").map(Number));
    // Rotated 90°: 100 mm tall and 200 mm... swapped extents.
    const xs = points.map((p) => p[0]!);
    const ys = points.map((p) => p[1]!);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(200, 0);
  });
});
