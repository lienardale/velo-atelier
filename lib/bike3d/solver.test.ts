import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { enumerateBuilds, presetBuild } from "./builds";
import { openChainLength, pitchRadius } from "./cassettes";
import { GEOMETRY_TABLE, geometryRowFor } from "./geometry-table";
import { CATALOGUE_REFERENCES, frameMeasurements } from "./measurements";
import {
  chainPath,
  cogPitch,
  onDownTube,
  onSeatTube,
  solve,
  solveRow,
  SolverError,
  solverAttributes,
  solverInputFor,
  stackReach,
} from "./solver";
import type { BikeAnchors, SolverInput, Vec3 } from "./types";
import { isFiniteVec } from "./vec";

const BUILDS = enumerateBuilds();

function allPoints(a: BikeAnchors): Vec3[] {
  return [
    a.bb,
    a.rearAxle,
    a.frontAxle,
    a.forkCrown,
    a.headBottom,
    a.headTop,
    a.topTubeFront,
    a.steererTop,
    a.seatTubeTop,
    a.topTubeRear,
    a.downTubeRear,
    a.stemEnd,
    a.saddle,
    a.seatpostTop,
    a.pedalLeft,
    a.pedalRight,
    ...a.chainPath,
    ...a.chainrings.map((s) => s.center),
    ...a.cogs.map((s) => s.center),
  ];
}

describe("solver invariants over the enumerated spec space", () => {
  it("enumerates a meaningful spec space", () => {
    expect(BUILDS.length).toBeGreaterThan(300);
  });

  it("every spec resolves to a row and solves to finite, coherent anchors", () => {
    for (const build of BUILDS) {
      const label = `${build.spec.discipline}/${build.spec.wheel.etrtoDiameter}/${build.spec.drivetrain.kind}`;
      const row = geometryRowFor(build.spec.discipline, build.spec.wheel.etrtoDiameter);
      const a = solve(solverInputFor(build));

      expect(allPoints(a).every(isFiniteVec), label).toBe(true);
      // Wheelbase and BB drop come straight from the row.
      expect(a.frontAxle[0] - a.rearAxle[0], label).toBeCloseTo(row.wheelbase, 9);
      expect(a.rearAxle[1], label).toBeCloseTo(row.bbDrop, 9);
      expect(Math.hypot(a.rearAxle[0], a.rearAxle[1]), label).toBeCloseTo(row.chainstay, 9);
      // The steering axis leans back at the head angle.
      const angle = (Math.atan2(-a.steerDown[1], a.steerDown[0]) * 180) / Math.PI;
      expect(angle, label).toBeCloseTo(row.headAngleDeg, 9);
      // Head tube top above its bottom, top tube joins below the head-tube top.
      expect(a.headTop[1], label).toBeGreaterThan(a.headBottom[1]);
      expect(a.topTubeFront[1], label).toBeLessThan(a.headTop[1]);
      // The wheels do not overlap and sit above the ground line.
      expect(a.frontAxle[0] - a.rearAxle[0], label).toBeGreaterThan(
        a.wheelFront.wheelRadius + a.wheelRear.wheelRadius,
      );
      expect(a.ground, label).toBeLessThan(0);
      // A saddle above the frame, a positive chain.
      expect(a.saddle[1], label).toBeGreaterThan(a.seatTubeTop[1]);
      expect(a.chainLength, label).toBeGreaterThan(0.5);
      // Drivetrain on the drive side (−Z), rotors on the other.
      expect(
        a.chainrings.every((ring) => ring.center[2] < 0),
        label,
      ).toBe(true);
      expect(
        a.cogs.every((cog) => cog.center[2] < 0),
        label,
      ).toBe(true);
      if (build.spec.brakes.isDisc) expect(a.rotorFront?.center[2], label).toBeGreaterThan(0);
      else expect(a.rotorFront, label).toBeNull();
    }
  });

  it("orders cogs largest first, nearest the spokes, and displays the middle one", () => {
    const a = solve(solverInputFor(presetBuild("mtb-hardtail-1x12")));
    expect(a.cogs).toHaveLength(12);
    expect(a.cogs[0]!.teeth).toBe(51);
    expect(a.cogs[0]!.center[2]).toBeCloseTo(-0.0335, 9);
    expect(a.cogs[1]!.center[2]).toBeCloseTo(-(0.0335 + cogPitch(12)), 9);
    expect(a.displayedCog).toBe(6);
  });

  it("is deterministic", () => {
    const build = presetBuild("road-disc-2x12");
    expect(solve(solverInputFor(build))).toEqual(solve(solverInputFor(build)));
  });

  it("matches the committed anchors of road-disc-2x12", async () => {
    const a = solve(solverInputFor(presetBuild("road-disc-2x12")));
    const rounded = JSON.parse(
      JSON.stringify(a, (_, value) =>
        typeof value === "number" ? Number(value.toFixed(6)) + 0 : value,
      ),
    );
    // Compared as data, not text: Prettier formats the committed JSON.
    const file = new URL("./__snapshots__/road-disc-2x12.anchors.json", import.meta.url);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path next to this test
    const committed: unknown = JSON.parse(readFileSync(file, "utf8"));
    expect(rounded).toEqual(committed);
  });
});

describe("drivetrain", () => {
  it("chain length grows with the chainring", () => {
    const build = presetBuild("gravel-1x11");
    const lengths = [32, 36, 40, 44, 48, 52].map((teeth) => {
      const input = solverInputFor(build);
      return solve({ ...input, attributes: { ...input.attributes, chainringTeeth: teeth } })
        .chainLength;
    });
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThan(lengths[i - 1]!);
  });

  it("chain length grows with the displayed cog", () => {
    const build = presetBuild("gravel-1x11");
    const input = solverInputFor(build);
    const lengths = ["11-25", "11-28", "11-32", "11-36", "11-42"].map(
      (range) =>
        solve({ ...input, attributes: { ...input.attributes, cassetteRange: range } }).chainLength,
    );
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThan(lengths[i - 1]!);
  });

  it("the chain path is closed around both sprockets", () => {
    const ring = { teeth: 40, pitchRadius: pitchRadius(40), center: [0, 0, -0.045] as Vec3 };
    const cog = { teeth: 18, pitchRadius: pitchRadius(18), center: [-0.42, 0.07, -0.05] as Vec3 };
    const points = chainPath(ring, cog, 8);
    expect(points).toHaveLength(18);
    // Every point lies on one of the two pitch circles.
    for (const p of points) {
      const onRing = Math.abs(Math.hypot(p[0], p[1]) - ring.pitchRadius) < 1e-9;
      const onCog = Math.abs(Math.hypot(p[0] + 0.42, p[1] - 0.07) - cog.pitchRadius) < 1e-9;
      expect(onRing || onCog).toBe(true);
    }
    // The cog wrap passes BEHIND the cog (away from the ring).
    expect(Math.min(...points.map((p) => p[0]))).toBeCloseTo(-0.42 - cog.pitchRadius, 3);
    expect(
      openChainLength(ring.pitchRadius, cog.pitchRadius, Math.hypot(0.42, 0.07)),
    ).toBeGreaterThan(0.84);
  });

  it("uses a single sprocket for hub gears and a bigger one for belts", () => {
    const city = solve(solverInputFor(presetBuild("city-igh-8-hub-motor")));
    expect(city.cogs.map((c) => c.teeth)).toEqual([18]);
    const input = solverInputFor(presetBuild("city-igh-8-hub-motor"));
    const belt = solve({
      ...input,
      spec: { ...input.spec, drivetrain: { ...input.spec.drivetrain, transmission: "belt" } },
    });
    expect(belt.cogs.map((c) => c.teeth)).toEqual([24]);
    expect(city.wheelRear.hubRadius).toBe(0.075);
  });

  it("uses the middle ring of a triple", () => {
    const input = solverInputFor(presetBuild("road-rim-2x11"));
    const triple = solve({
      ...input,
      spec: { ...input.spec, drivetrain: { ...input.spec.drivetrain, chainrings: 3 } },
    });
    expect(triple.chainrings.map((r) => r.teeth)).toEqual([50, 38, 28]);
    expect(
      Math.hypot(
        triple.chainPath[triple.chainPath.length - 1]![0],
        triple.chainPath[triple.chainPath.length - 1]![1],
      ),
    ).toBeCloseTo(pitchRadius(38), 6);
  });

  it("cog pitch narrows with more speeds", () => {
    expect(cogPitch(8)).toBeGreaterThan(cogPitch(9));
    expect(cogPitch(10)).toBeGreaterThan(cogPitch(11));
    expect(cogPitch(11)).toBeGreaterThan(cogPitch(12));
    expect(cogPitch(13)).toBe(cogPitch(12));
  });
});

describe("inputs", () => {
  it("reads the build attributes, dropping malformed ones", () => {
    const build = presetBuild("mtb-full-dropper-1x12");
    expect(solverAttributes(build)).toMatchObject({
      rotorFrontMm: 203,
      cassetteSpeeds: 12,
      cassetteRange: "10-51",
      chainringTeeth: 32,
      forkTravelMm: 140,
      tireFrontWidthMm: 60,
    });
    const junk = {
      spec: build.spec,
      parts: [
        { partId: "rotor-front", attributes: { diameter: "big" } },
        { partId: "cassette", attributes: { range: 42, speeds: "12" } },
        { partId: "fork", attributes: { "travel-mm": Number.NaN } },
      ],
    };
    expect(solverAttributes(junk as never)).toEqual({
      rotorFrontMm: undefined,
      rotorRearMm: undefined,
      cassetteSpeeds: 12,
      cassetteRange: undefined,
      chainringTeeth: undefined,
      forkTravelMm: undefined,
      tireFrontWidthMm: undefined,
      tireRearWidthMm: undefined,
    });
  });

  it("honours the saddle height of the fit, clamped to a sane insertion", () => {
    const build = presetBuild("gravel-1x11");
    const row = geometryRowFor("gravel", 622);
    const at = (mm: number) => {
      const a = solve(solverInputFor(build, { saddleHeightMm: mm }));
      return Math.hypot(a.saddle[0], a.saddle[1]);
    };
    expect(at(750)).toBeCloseTo(0.75, 9);
    expect(at(100)).toBeCloseTo(row.seatTubeLength + 0.06, 9);
    expect(at(5000)).toBeCloseTo(row.seatTubeLength + 0.38, 9);
    expect(solverInputFor(build).fit).toBeNull();
  });

  it("longer suspension travel raises the front", () => {
    const input = solverInputFor(presetBuild("mtb-hardtail-1x12"));
    const short = solve({ ...input, attributes: { ...input.attributes, forkTravelMm: 100 } });
    const long = solve({ ...input, attributes: { ...input.attributes, forkTravelMm: 160 } });
    expect(long.headTop[1]).toBeGreaterThan(short.headTop[1]);
    const rigid = solve({
      ...input,
      spec: { ...input.spec, suspension: { front: false, rear: false } },
    });
    expect(rigid.forkTravel).toBe(0);
    expect(short.forkTravel).toBeCloseTo(0.1, 9);
  });

  it("uses the kids' crank length", () => {
    const a = solve(solverInputFor(presetBuild("road-rim-2x11")));
    expect(a.crankLength).toBe(0.1725);
    const kids = enumerateBuilds().find((b) => b.spec.discipline === "kids")!;
    expect(solve(solverInputFor(kids)).crankLength).toBe(0.14);
  });
});

describe("failure modes", () => {
  const input: SolverInput = solverInputFor(presetBuild("road-rim-2x11"));
  const row = GEOMETRY_TABLE["road/622"]!;

  it("throws only on non-finite anchors", () => {
    expect(() => solveRow({ ...row, chainstay: 0.05 }, input)).toThrow(SolverError);
    expect(() => solveRow({ ...row, forkAxleToCrown: 0.01 }, input)).toThrow(/axle-to-crown/);
    expect(() => solveRow({ ...row, headTubeLength: Number.NaN }, input)).toThrow(/non-finite/);
    // An unrealistic but finite row still solves.
    expect(() => solveRow({ ...row, headAngleDeg: 45, wheelbase: 2 }, input)).not.toThrow();
  });
});

describe("derived measurements", () => {
  it("stack and reach are the head-tube top relative to the BB", () => {
    expect(stackReach([0.38, 0.56, 0])).toEqual({ stack: 0.56, reach: 0.38 });
    expect(stackReach([1, 1, 0], [0.5, 0.25, 0])).toEqual({ stack: 0.75, reach: 0.5 });
  });

  it("measures a frame in millimetres", () => {
    const a = solve(solverInputFor(presetBuild("road-rim-2x11")));
    const m = frameMeasurements(a);
    expect(m.wheelbaseMm).toBe(995);
    expect(m.chainstayMm).toBe(410);
    expect(m.bbHeightMm).toBeGreaterThan(250);
    expect(m.trailMm).toBeGreaterThan(40);
    expect(m.trailMm).toBeLessThan(80);
    expect(m.chainLinks).toBeGreaterThan(90);
    expect(m.saddleHeightMm).toBe(720);
  });

  it("stays near typical size-M catalogue values (soft)", () => {
    // Enumerated ONCE: this used to run inside the loop, re-deriving every build
    // in the matrix for each catalogue reference. Fast enough on a dev machine,
    // 5 s timeout on CI's two-core runner (W2 integration, 2026-09-18).
    const builds = enumerateBuilds();
    for (const [key, reference] of Object.entries(CATALOGUE_REFERENCES)) {
      const [discipline, etrto] = key.split("/") as [never, string];
      const build = builds.find(
        (b) =>
          b.spec.discipline === discipline &&
          b.spec.wheel.etrtoDiameter === Number(etrto) &&
          (discipline !== ("mtb" as never) || b.spec.suspension.front),
      )!;
      const input = solverInputFor(build);
      const a = solve({ ...input, attributes: { ...input.attributes, forkTravelMm: 130 } });
      const m = frameMeasurements(a);
      expect
        .soft(Math.abs(m.stackMm - reference.stackMm), `${key} stack ${m.stackMm}`)
        .toBeLessThanOrEqual(20);
      expect
        .soft(Math.abs(m.reachMm - reference.reachMm), `${key} reach ${m.reachMm}`)
        .toBeLessThanOrEqual(10);
    }
  });

  it("helpers walk the seat tube and the down tube", () => {
    const a = solve(solverInputFor(presetBuild("road-rim-2x11")));
    expect(onSeatTube(a, 1)).toEqual(a.seatTubeTop);
    expect(onDownTube(a, 0)).toEqual(a.headBottom);
    expect(onDownTube(a, 1)).toEqual(a.downTubeRear);
  });
});
