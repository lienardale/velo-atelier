import { describe, expect, it } from "vitest";

import {
  CHAIN_PITCH,
  cassetteTeeth,
  chainringTeeth,
  openChainLength,
  parseRange,
  pitchRadius,
} from "./cassettes";

const RANGES = [
  "11-25",
  "11-28",
  "11-30",
  "11-32",
  "11-34",
  "11-36",
  "11-42",
  "10-42",
  "10-45",
  "10-51",
  "10-52",
];

describe("pitchRadius", () => {
  it("follows r(T) = p / (2·sin(π/T))", () => {
    expect(pitchRadius(18)).toBeCloseTo(CHAIN_PITCH / (2 * Math.sin(Math.PI / 18)), 12);
    expect(pitchRadius(50)).toBeCloseTo(0.10115, 4);
    expect(pitchRadius(51)).toBeGreaterThan(pitchRadius(50));
  });
});

describe("cassetteTeeth", () => {
  it("returns known cassettes verbatim", () => {
    expect(cassetteTeeth("10-51", 12)).toEqual([10, 12, 14, 16, 18, 21, 24, 28, 32, 36, 42, 51]);
    expect(cassetteTeeth("11-28", 11)).toEqual([11, 12, 13, 14, 15, 17, 19, 21, 23, 25, 28]);
  });

  it("spreads every other range × speeds strictly increasing between the end cogs", () => {
    for (const range of RANGES) {
      const [low, high] = parseRange(range);
      for (let speeds = 2; speeds <= 13; speeds++) {
        const teeth = cassetteTeeth(range, speeds);
        expect(teeth, `${range} × ${speeds}`).toHaveLength(speeds);
        expect(teeth[0], `${range} × ${speeds}`).toBe(low);
        expect(teeth[teeth.length - 1], `${range} × ${speeds}`).toBe(high);
        for (let i = 1; i < teeth.length; i++) expect(teeth[i]!).toBeGreaterThan(teeth[i - 1]!);
      }
    }
  });

  it("handles degenerate inputs", () => {
    expect(cassetteTeeth("11-32", 1)).toEqual([11]);
    expect(cassetteTeeth(undefined, 8)).toEqual([11, 13, 15, 17, 20, 24, 27, 32]);
    expect(cassetteTeeth("11-32", 99)).toHaveLength(14);
    // More cogs than tooth counts in the range: still strictly increasing.
    const crowded = cassetteTeeth("11-14", 8);
    expect(crowded).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
  });
});

describe("parseRange", () => {
  it("parses and falls back to 11-32", () => {
    expect(parseRange("10-51")).toEqual([10, 51]);
    expect(parseRange("42-11")).toEqual([11, 32]);
    expect(parseRange("junk")).toEqual([11, 32]);
    expect(parseRange(undefined)).toEqual([11, 32]);
  });
});

describe("chainringTeeth", () => {
  it("derives the smaller rings", () => {
    expect(chainringTeeth(40, 1)).toEqual([40]);
    expect(chainringTeeth(50, 2)).toEqual([50, 34]);
    expect(chainringTeeth(44, 3)).toEqual([44, 32, 22]);
  });
});

describe("openChainLength", () => {
  it("is monotone in both radii and the distance", () => {
    const base = openChainLength(0.08, 0.03, 0.42);
    expect(openChainLength(0.09, 0.03, 0.42)).toBeGreaterThan(base);
    expect(openChainLength(0.08, 0.04, 0.42)).toBeGreaterThan(base);
    expect(openChainLength(0.08, 0.03, 0.44)).toBeGreaterThan(base);
  });

  it("equals the belt formula for equal sprockets", () => {
    expect(openChainLength(0.05, 0.05, 0.4)).toBeCloseTo(0.8 + 2 * Math.PI * 0.05, 12);
  });
});
