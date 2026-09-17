import { describe, expect, it } from "vitest";

import { DISCIPLINES } from "@/lib/domain/data/conventions";

import {
  chainElongationPercent,
  chainWearFromRuler,
  chainWearLimitMm,
  DROP_CM,
  dropVerdict,
  INSEAM_RANGE_CM,
  kopsVerdict,
  SADDLE_HEIGHT_RANGE_MM,
  SAG_PERCENT,
  saddleHeightHeelMethodMm,
  saddleHeightLeMond,
  saddleHeightMmFromInseam,
  sagPercent,
  sagRange,
  sagTargetFor,
  sagVerdict,
} from "./formulas";

describe("saddle height", () => {
  // §5.8 AC6.
  it("gives 74.2 cm for an 84 cm inseam", () => {
    expect(saddleHeightLeMond(84)).toBeCloseTo(74.2, 1);
    expect(Math.abs(saddleHeightLeMond(84) - 74.2)).toBeLessThan(0.05);
  });

  it("rounds to whole millimetres for storage", () => {
    // 84 × 0.883 = 74.172 cm → 741.72 mm → 742.
    expect(saddleHeightMmFromInseam(84)).toBe(742);
    expect(saddleHeightMmFromInseam(75)).toBe(662);
  });

  it("lands inside the stored range for every inseam an adult frame fits", () => {
    for (let inseam = 60; inseam <= 100; inseam++) {
      const mm = saddleHeightMmFromInseam(inseam);
      expect(mm).toBeGreaterThanOrEqual(SADDLE_HEIGHT_RANGE_MM.min);
      expect(mm).toBeLessThanOrEqual(SADDLE_HEIGHT_RANGE_MM.max);
    }
  });

  it("can leave that range at the ends of the accepted inseams, where the schema clamps", () => {
    // A 110 cm inseam is accepted as a *measurement* (`INSEAM_RANGE_CM`) but the
    // height it implies is outside what a seatpost can do; `BikeFit` refuses it
    // rather than storing 971 mm, which is why the two ranges are separate.
    expect(saddleHeightMmFromInseam(INSEAM_RANGE_CM.max)).toBeGreaterThan(
      SADDLE_HEIGHT_RANGE_MM.max,
    );
    expect(saddleHeightMmFromInseam(INSEAM_RANGE_CM.min)).toBeLessThan(SADDLE_HEIGHT_RANGE_MM.min);
  });

  it("puts the heel-method target just below the LeMond height", () => {
    const lemond = saddleHeightMmFromInseam(84);
    const heel = saddleHeightHeelMethodMm(84);
    expect(heel).toBeLessThan(lemond);
    expect(lemond - heel).toBeLessThan(0.03 * lemond);
  });

  it("is monotone in the inseam", () => {
    expect(saddleHeightLeMond(80)).toBeLessThan(saddleHeightLeMond(81));
  });
});

describe("KOPS", () => {
  it.each([
    [2, "forward"],
    [1, "aligned"],
    [0, "aligned"],
    [-1, "aligned"],
    [-2.5, "back"],
  ] as const)("%s cm → %s", (offset, verdict) => {
    expect(kopsVerdict(offset)).toBe(verdict);
  });

  it("takes a caller's tolerance", () => {
    expect(kopsVerdict(1.5)).toBe("forward");
    expect(kopsVerdict(1.5, 2)).toBe("aligned");
  });
});

describe("saddle-to-bar drop", () => {
  it("has a band for every discipline", () => {
    for (const discipline of DISCIPLINES) {
      const [min, max] = DROP_CM[discipline];
      expect(min).toBeLessThan(max);
    }
  });

  it("reads a lower bar than usual as `low`", () => {
    expect(dropVerdict(-12, "road")).toBe("low");
    expect(dropVerdict(-7, "road")).toBe("typical");
    expect(dropVerdict(0, "road")).toBe("high");
  });

  it("puts a city bar above the saddle in its own band", () => {
    expect(dropVerdict(3, "city-hybrid")).toBe("typical");
    expect(dropVerdict(3, "gravel")).toBe("high");
  });
});

describe("sag", () => {
  it("firms the fork up on a hardtail and softens it on a full suspension", () => {
    expect(sagTargetFor("fork", false)).toBe("forkXc");
    expect(sagTargetFor("fork", true)).toBe("forkTrail");
    expect(sagTargetFor("shock", true)).toBe("shock");
  });

  it("converts an o-ring reading into a percentage of travel", () => {
    expect(sagPercent(26, 130)).toBeCloseTo(20, 6);
    expect(sagPercent(0, 130)).toBe(0);
  });

  it("refuses a reading that cannot be one", () => {
    expect(sagPercent(20, 0)).toBeNull();
    expect(sagPercent(-1, 130)).toBeNull();
    expect(sagPercent(Number.NaN, 130)).toBeNull();
  });

  it("judges against the band of the chosen target", () => {
    expect(sagVerdict(12, "forkXc")).toBe("firm");
    expect(sagVerdict(18, "forkXc")).toBe("ok");
    expect(sagVerdict(24, "forkXc")).toBe("soft");
    expect(sagVerdict(24, "forkTrail")).toBe("ok");
    expect(sagRange("shock")).toEqual(SAG_PERCENT.shock);
  });
});

describe("chain wear", () => {
  // §5.8 AC6.
  it("calls 306.5 mm over 12 links worn out on an 11-speed and 306.0 fine", () => {
    expect(chainWearFromRuler(306.5, 11)).toBe("replace");
    expect(chainWearFromRuler(306.0, 11)).toBe("ok");
  });

  it("is more tolerant below 11 speeds", () => {
    expect(chainWearFromRuler(306.5, 9)).toBe("ok");
    expect(chainWearFromRuler(307.2, 9)).toBe("replace");
    expect(chainWearLimitMm(9)).toBeGreaterThan(chainWearLimitMm(11));
  });

  it("puts the 11-speed limit at 0.5 % elongation", () => {
    expect(chainElongationPercent(chainWearLimitMm(11))).toBeCloseTo(0.5, 6);
    expect(chainElongationPercent(chainWearLimitMm(10))).toBeCloseTo(0.75, 6);
  });

  it("reports a new chain as unworn", () => {
    expect(chainElongationPercent(304.8)).toBeCloseTo(0, 6);
    expect(chainWearFromRuler(304.8, 12)).toBe("ok");
  });
});
