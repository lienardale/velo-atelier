import { describe, expect, it } from "vitest";

import { GEOMETRY_MEASURE_IDS } from "@/lib/domain/data/geometry-measures";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { findPart } from "@/lib/domain/engine/parts-for-spec";
import { validateBuild } from "@/lib/domain/engine/validate-build";

import {
  BIKE_NAME_MAX,
  buildOf,
  coerceFit,
  deriveBike,
  FIT_FIELDS,
  FIT_KEYS,
  fitField,
  fitFieldsFor,
  isValidFitValue,
  jsonBytes,
  MAX_JSON_BYTES,
  mergeAttributes,
  mergeFit,
  parseFit,
  partStateDiff,
  QUOTAS,
  withinJsonBudget,
  withinQuota,
} from "./rules";

describe("deriveBike", () => {
  it("produces a build the domain accepts, for every preset", () => {
    for (const answers of Object.values(BIKE_PRESETS)) {
      const derived = deriveBike(answers);
      expect(validateBuild(buildOf(derived)).ok).toBe(true);
    }
  });

  it("never trusts a caller's spec — it recomputes from the answers", () => {
    const derived = deriveBike(BIKE_PRESETS["road-disc-2x12"]);
    expect(derived.spec.brakes.isDisc).toBe(true);
    expect(derived.spec.drivetrain.speeds).toBe(12);
  });

  it("prunes answers to questions this bike is never asked", () => {
    const derived = deriveBike({ ...BIKE_PRESETS["road-rim-2x11"], "e-battery": "integrated" });
    expect(derived.answers).not.toHaveProperty("e-battery");
  });

  it("carries an editable attribute edit across a change of answers", () => {
    const before = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    const saddle = findPart(buildOf(before), "saddle");
    expect(saddle).toBeDefined();
    const edited = before.parts.map((part) =>
      part.partId === "saddle"
        ? { partId: part.partId, attributes: { ...part.attributes, "saddle-width": 155 } }
        : part,
    );

    // The same bike, now tubeless instead of tubed: the saddle is untouched by that.
    const after = deriveBike({ ...BIKE_PRESETS["gravel-1x11"], "tire-system": "tubeless" }, edited);
    expect(findPart(buildOf(after), "saddle")?.attributes["saddle-width"]).toBe(155);
    expect(validateBuild(buildOf(after)).ok).toBe(true);
  });

  it("drops the parts a new spec no longer fits", () => {
    const rim = deriveBike(BIKE_PRESETS["road-rim-2x11"]);
    const disc = deriveBike(BIKE_PRESETS["road-disc-2x12"], rim.parts);
    expect(disc.parts.some((part) => part.partId.startsWith("rotor-"))).toBe(true);
    expect(disc.parts.some((part) => part.partId === "brake-pads-front")).toBe(true);
    expect(validateBuild(buildOf(disc)).ok).toBe(true);
  });

  it("ignores a previous attribute value the new spec refuses", () => {
    const build = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    const poisoned = build.parts.map((part) =>
      part.partId === "saddle"
        ? { partId: part.partId, attributes: { ...part.attributes, "saddle-width": 9_999 } }
        : part,
    );
    const after = deriveBike(BIKE_PRESETS["gravel-1x11"], poisoned);
    expect(findPart(buildOf(after), "saddle")?.attributes["saddle-width"]).not.toBe(9_999);
  });

  it("returns default attributes for an unknown part id", () => {
    expect(
      mergeAttributes("no-such-part", deriveBike(BIKE_PRESETS["gravel-1x11"]).spec, {}),
    ).toEqual({});
  });
});

describe("partStateDiff", () => {
  it("creates the new parts and removes the vanished ones, keeping the rest", () => {
    expect(partStateDiff(["chain", "cassette"], ["chain", "belt"])).toEqual({
      create: ["belt"],
      remove: ["cassette"],
    });
  });

  it("is a no-op when nothing moved", () => {
    expect(partStateDiff(["chain"], ["chain"])).toEqual({ create: [], remove: [] });
  });
});

describe("quotas", () => {
  it("lets the last allowed item through and refuses the next", () => {
    expect(withinQuota(QUOTAS.bikesPerUser - 1, QUOTAS.bikesPerUser)).toBe(true);
    expect(withinQuota(QUOTAS.bikesPerUser, QUOTAS.bikesPerUser)).toBe(false);
  });

  it("measures a JSON column in UTF-8 bytes, not characters", () => {
    expect(jsonBytes({ a: "é" })).toBe(jsonBytes({ a: "e" }) + 1);
    expect(withinJsonBudget({ a: "x" })).toBe(true);
    expect(withinJsonBudget({ a: "x".repeat(MAX_JSON_BYTES) })).toBe(false);
  });

  it("keeps a real bike far under the JSON ceiling", () => {
    const derived = deriveBike(BIKE_PRESETS["emtb-mid-1x12"]);
    expect(jsonBytes(derived.parts)).toBeLessThan(MAX_JSON_BYTES);
    expect(jsonBytes(derived.spec)).toBeLessThan(MAX_JSON_BYTES);
    expect(BIKE_NAME_MAX).toBe(80);
  });
});

describe("fit", () => {
  it("has a field for a measure the fit page can store", () => {
    for (const field of FIT_FIELDS) {
      expect(GEOMETRY_MEASURE_IDS).toContain(field.measureId);
      expect(field.min).toBeLessThan(field.max);
    }
    expect(new Set(FIT_KEYS).size).toBe(FIT_KEYS.length);
    expect(fitFieldsFor("saddle-height").map((field) => field.key)).toEqual([
      "inseamCm",
      "saddleHeightMm",
    ]);
    expect(fitField("saddleHeightMm")?.unit).toBe("mm");
    expect(fitField("nope")).toBeUndefined();
  });

  it("accepts a value inside its field's range and refuses one outside", () => {
    expect(isValidFitValue("saddleHeightMm", 742)).toBe(true);
    expect(isValidFitValue("saddleHeightMm", 400)).toBe(false);
    expect(isValidFitValue("saddleHeightMm", "742")).toBe(false);
    expect(isValidFitValue("saddleHeightMm", Number.NaN)).toBe(false);
    expect(isValidFitValue("passwordHash", "x")).toBe(false);
  });

  it("parses a fit object strictly", () => {
    expect(parseFit({ saddleHeightMm: 742, inseamCm: 84 })).toEqual({
      saddleHeightMm: 742,
      inseamCm: 84,
    });
    expect(parseFit(null)).toEqual({});
    expect(parseFit(undefined)).toEqual({});
    expect(parseFit({ saddleHeightMm: null })).toEqual({});
  });

  it("refuses the whole object when one entry is wrong", () => {
    expect(parseFit({ saddleHeightMm: 742, userId: "other" })).toBeNull();
    expect(parseFit({ saddleHeightMm: 2_000 })).toBeNull();
    expect(parseFit([1, 2])).toBeNull();
    expect(parseFit("fit")).toBeNull();
    expect(parseFit(JSON.parse('{"__proto__": {"admin": true}}'))).toBeNull();
  });

  it("coerces a stored value tolerantly, dropping what it cannot use", () => {
    expect(coerceFit({ saddleHeightMm: 742, legacyKey: 1, riderKg: "x" })).toEqual({
      saddleHeightMm: 742,
    });
    expect(coerceFit(null)).toEqual({});
  });

  it("merges a patch over the previous fit", () => {
    expect(mergeFit({ saddleHeightMm: 700, riderKg: 70 }, { saddleHeightMm: 742 })).toEqual({
      saddleHeightMm: 742,
      riderKg: 70,
    });
    expect(mergeFit(null, { riderKg: 70 })).toEqual({ riderKg: 70 });
  });
});
