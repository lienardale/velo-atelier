import { describe, expect, it } from "vitest";

import { DISCIPLINES, nodeFor, visibleOptions, type EtrtoDiameter } from "@/lib/domain";
import { buildBikeSpec, answerWithDefaults } from "@/lib/domain";

import {
  GEOMETRY_TABLE,
  geometryRowFor,
  geometryRowKey,
  MissingGeometryRowError,
} from "./geometry-table";

describe("GEOMETRY_TABLE", () => {
  it("has a row for every discipline × wheel size the decision tree can produce", () => {
    for (const discipline of DISCIPLINES) {
      for (const option of visibleOptions(nodeFor("wheel-size"), { discipline })) {
        const spec = buildBikeSpec(answerWithDefaults({ discipline, "wheel-size": option.id }));
        expect(
          () => geometryRowFor(spec.discipline, spec.wheel.etrtoDiameter),
          `${discipline} ${option.id}`,
        ).not.toThrow();
      }
    }
  });

  it("every row is physically plausible", () => {
    for (const [key, row] of Object.entries(GEOMETRY_TABLE)) {
      expect(row!.chainstay, key).toBeGreaterThan(row!.bbDrop);
      expect(row!.forkAxleToCrown, key).toBeGreaterThan(row!.forkRake);
      expect(row!.headAngleDeg, key).toBeGreaterThan(60);
      expect(row!.headAngleDeg, key).toBeLessThan(76);
      expect(row!.wheelbase, key).toBeGreaterThan(0.5);
      expect(row!.saddleHeightDefault, key).toBeGreaterThan(row!.seatTubeLength);
    }
  });

  it("scales kids' frames with the wheel", () => {
    const k507 = geometryRowFor("kids", 507);
    const k305 = geometryRowFor("kids", 305);
    expect(k305.wheelbase).toBeLessThan(k507.wheelbase);
    expect(k305.headAngleDeg).toBe(k507.headAngleDeg);
    expect(k507.frameStyle).toBe("diamond");
  });

  it("derives the smaller-wheel rows by shortening the wheelbase", () => {
    expect(geometryRowFor("mtb", 559).wheelbase).toBeCloseTo(
      geometryRowFor("mtb", 622).wheelbase - 0.04,
      9,
    );
    expect(geometryRowFor("gravel", 584).tireWidth).toBe(0.047);
  });

  it("refuses a combination without a row", () => {
    expect(() => geometryRowFor("kids", 622 as EtrtoDiameter)).toThrow(MissingGeometryRowError);
    expect(() => geometryRowFor("road", 305 as EtrtoDiameter)).toThrow(
      "No geometry row for road/305",
    );
    expect(geometryRowKey("mtb", 584)).toBe("mtb/584");
  });
});
