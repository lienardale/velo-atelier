import { describe, expect, it } from "vitest";

import {
  barToPsi,
  baseBarFor,
  BASE_BAR_85KG,
  FRONT_DELTA_BAR,
  PRESSURE_CLAMP_BAR,
  tirePressure,
} from "./pressure";

describe("the base table", () => {
  it("falls monotonically as the tyre gets wider", () => {
    for (let i = 1; i < BASE_BAR_85KG.length; i++) {
      expect(BASE_BAR_85KG[i][0]).toBeGreaterThan(BASE_BAR_85KG[i - 1][0]);
      expect(BASE_BAR_85KG[i][1]).toBeLessThan(BASE_BAR_85KG[i - 1][1]);
    }
  });

  it("returns a row verbatim at its own width", () => {
    for (const [width, bar] of BASE_BAR_85KG) expect(baseBarFor(width)).toBeCloseTo(bar, 10);
  });

  it("interpolates linearly between two rows", () => {
    // Halfway between 25 mm (6.3) and 28 mm (5.5) is 26.5 mm.
    expect(baseBarFor(26.5)).toBeCloseTo(5.9, 10);
  });

  it("clamps to the ends rather than extrapolating", () => {
    expect(baseBarFor(18)).toBe(BASE_BAR_85KG[0][1]);
    expect(baseBarFor(80)).toBe(BASE_BAR_85KG[BASE_BAR_85KG.length - 1][1]);
  });
});

describe("tirePressure", () => {
  // §5.8 AC6.
  it("suggests ~5.46 bar at the rear for 75 + 9 kg on a 28 mm tube tyre", () => {
    const result = tirePressure({ riderKg: 75, bikeKg: 9, widthMm: 28, tubeless: false });
    expect(result).not.toBeNull();
    expect(result!.rear).toBeCloseTo(5.46, 1);
    expect(Math.abs(result!.rear - 5.46)).toBeLessThan(0.2);
  });

  it("runs the front 0.2 bar softer than the rear", () => {
    const result = tirePressure({ riderKg: 75, bikeKg: 9, widthMm: 28, tubeless: false })!;
    expect(result.front).toBeCloseTo(result.rear + FRONT_DELTA_BAR, 10);
  });

  it("takes 10 % off for tubeless", () => {
    const tube = tirePressure({ riderKg: 75, bikeKg: 9, widthMm: 40, tubeless: false })!;
    const tubeless = tirePressure({ riderKg: 75, bikeKg: 9, widthMm: 40, tubeless: true })!;
    expect(tubeless.rear).toBeCloseTo(tube.rear * 0.9, 10);
  });

  it("rises with the system weight and falls with the tyre width", () => {
    const light = tirePressure({ riderKg: 55, bikeKg: 9, widthMm: 32, tubeless: false })!;
    const heavy = tirePressure({ riderKg: 95, bikeKg: 9, widthMm: 32, tubeless: false })!;
    const fat = tirePressure({ riderKg: 95, bikeKg: 9, widthMm: 54, tubeless: false })!;
    expect(heavy.rear).toBeGreaterThan(light.rear);
    expect(fat.rear).toBeLessThan(heavy.rear);
  });

  it("counts luggage as system weight", () => {
    const bare = tirePressure({ riderKg: 75, bikeKg: 12, widthMm: 40, tubeless: true })!;
    const loaded = tirePressure({
      riderKg: 75,
      bikeKg: 12,
      widthMm: 40,
      tubeless: true,
      loadKg: 15,
    })!;
    expect(loaded.systemKg).toBe(102);
    expect(loaded.rear).toBeGreaterThan(bare.rear);
  });

  it("never leaves the global band", () => {
    const tiny = tirePressure({ riderKg: 20, bikeKg: 8, widthMm: 62, tubeless: true })!;
    const huge = tirePressure({ riderKg: 140, bikeKg: 12, widthMm: 23, tubeless: false })!;
    expect(tiny.rear).toBeGreaterThanOrEqual(PRESSURE_CLAMP_BAR.min);
    expect(huge.rear).toBeLessThanOrEqual(PRESSURE_CLAMP_BAR.max);
  });

  it("lets the sidewall win over the table", () => {
    const capped = tirePressure({
      riderKg: 95,
      bikeKg: 9,
      widthMm: 23,
      tubeless: false,
      maxBar: 4,
    })!;
    expect(capped.rear).toBe(4);
    expect(capped.front).toBe(4);
  });

  it("refuses input that cannot describe a rider on a bike", () => {
    expect(tirePressure({ riderKg: 0, bikeKg: 9, widthMm: 28, tubeless: false })).toBeNull();
    expect(tirePressure({ riderKg: 75, bikeKg: -1, widthMm: 28, tubeless: false })).toBeNull();
    expect(tirePressure({ riderKg: 75, bikeKg: 9, widthMm: 0, tubeless: false })).toBeNull();
    expect(
      tirePressure({ riderKg: Number.NaN, bikeKg: 9, widthMm: 28, tubeless: false }),
    ).toBeNull();
    expect(
      tirePressure({ riderKg: 75, bikeKg: 9, widthMm: 28, tubeless: false, minBar: 6, maxBar: 4 }),
    ).toBeNull();
  });

  it("converts to psi for the shop gauge", () => {
    expect(barToPsi(1)).toBeCloseTo(14.5038, 4);
    expect(barToPsi(5.46)).toBeCloseTo(79.2, 1);
  });
});
