/**
 * Conditions over a spec, and the path reader underneath them (§2.2).
 *
 * The two asymmetries this file pins down are the ones every data file depends
 * on and nobody remembers:
 *
 *   - a path that reads `undefined` is in no `in` list and in every `notIn`
 *     list, so `{ not: { path: 'eSystem.motorPosition', in: ['mid-drive'] } }`
 *     is **true** on a muscular bike;
 *   - `getAtPath` never follows a prototype key, so a path that reached it from
 *     user input cannot walk into `Object.prototype`.
 */
import { describe, expect, it } from "vitest";

import { evalSpecCondition } from "@/lib/domain/engine/condition";
import { getAtPath } from "@/lib/domain/engine/paths";
import { SPEC_PATH_PATTERN, SpecConditionSchema } from "@/lib/domain/schema/condition";
import { DEFAULT_SPEC, makeSpec, specFor } from "@/tests/_fakes/domain/build";

describe("getAtPath", () => {
  const value = { a: { b: { c: 1 }, empty: null }, flag: false };

  it("reads nested leaves", () => {
    expect(getAtPath(value, "a.b.c")).toBe(1);
    expect(getAtPath(value, "flag")).toBe(false);
    expect(getAtPath(value, "a.b")).toEqual({ c: 1 });
  });

  it("returns undefined instead of throwing on a missing or non-object segment", () => {
    expect(getAtPath(value, "a.nope")).toBeUndefined();
    expect(getAtPath(value, "a.b.c.d")).toBeUndefined();
    expect(getAtPath(value, "a.empty.deep")).toBeUndefined();
    expect(getAtPath(undefined, "a")).toBeUndefined();
    expect(getAtPath(null, "a")).toBeUndefined();
    expect(getAtPath("a string", "length")).toBeUndefined();
  });

  it("never follows a prototype key", () => {
    expect(getAtPath({}, "__proto__")).toBeUndefined();
    expect(getAtPath({}, "constructor.name")).toBeUndefined();
    expect(getAtPath({}, "toString")).toBeUndefined();
  });
});

describe("SpecConditionSchema", () => {
  it("accepts every shape", () => {
    const conditions = [
      { path: "drive", in: ["electric"] },
      { path: "brakes.isDisc", notIn: [false] },
      {
        all: [
          { path: "discipline", in: ["mtb"] },
          { path: "suspension.rear", in: [true] },
        ],
      },
      { any: [{ path: "drivetrain.speeds", in: [11, 12] }] },
      { not: { path: "eSystem.motorPosition", in: ["mid-drive"] } },
    ];
    for (const condition of conditions) {
      expect(SpecConditionSchema.safeParse(condition).success, JSON.stringify(condition)).toBe(
        true,
      );
    }
  });

  it("rejects an empty list, an unknown key and a malformed path", () => {
    expect(SpecConditionSchema.safeParse({ path: "drive", in: [] }).success).toBe(false);
    expect(SpecConditionSchema.safeParse({ path: "drive", is: ["electric"] }).success).toBe(false);
    expect(SpecConditionSchema.safeParse({ path: "drive.", in: ["x"] }).success).toBe(false);
    expect(SpecConditionSchema.safeParse({ path: "brakes-type", in: ["x"] }).success).toBe(false);
  });

  it("has a path pattern that matches dotted identifiers only", () => {
    expect(SPEC_PATH_PATTERN.test("eSystem.motorPosition")).toBe(true);
    expect(SPEC_PATH_PATTERN.test("2wheels")).toBe(false);
  });
});

describe("evalSpecCondition", () => {
  const gravel = specFor("gravel-1x11");
  const emtb = specFor("emtb-mid-1x12");

  it("matches a leaf with in and notIn", () => {
    expect(evalSpecCondition({ path: "discipline", in: ["gravel", "road"] }, gravel)).toBe(true);
    expect(evalSpecCondition({ path: "discipline", in: ["mtb"] }, gravel)).toBe(false);
    expect(evalSpecCondition({ path: "discipline", notIn: ["mtb"] }, gravel)).toBe(true);
    expect(evalSpecCondition({ path: "brakes.isDisc", in: [true] }, gravel)).toBe(true);
    expect(evalSpecCondition({ path: "drivetrain.speeds", in: [11] }, gravel)).toBe(true);
  });

  it("treats an unreadable path as absent — not as a match, and not as an error", () => {
    // A muscular bike has no eSystem at all.
    expect(evalSpecCondition({ path: "eSystem.motorPosition", in: ["mid-drive"] }, gravel)).toBe(
      false,
    );
    // …which is exactly what makes "not a mid-drive" true for it (§2.2).
    expect(
      evalSpecCondition({ not: { path: "eSystem.motorPosition", in: ["mid-drive"] } }, gravel),
    ).toBe(true);
    expect(
      evalSpecCondition({ not: { path: "eSystem.motorPosition", in: ["mid-drive"] } }, emtb),
    ).toBe(false);
    // notIn on an absent leaf is true, by the same rule.
    expect(evalSpecCondition({ path: "eSystem.motorPosition", notIn: ["hub-rear"] }, gravel)).toBe(
      true,
    );
  });

  it("combines with all, any and not", () => {
    expect(
      evalSpecCondition(
        {
          all: [
            { path: "drive", in: ["muscular"] },
            { path: "tires.system", in: ["tubeless"] },
          ],
        },
        gravel,
      ),
    ).toBe(true);
    expect(
      evalSpecCondition(
        {
          all: [
            { path: "drive", in: ["muscular"] },
            { path: "discipline", in: ["mtb"] },
          ],
        },
        gravel,
      ),
    ).toBe(false);
    expect(
      evalSpecCondition(
        {
          any: [
            { path: "discipline", in: ["mtb"] },
            { path: "discipline", in: ["gravel"] },
          ],
        },
        gravel,
      ),
    ).toBe(true);
    expect(evalSpecCondition({ any: [{ path: "discipline", in: ["mtb"] }] }, gravel)).toBe(false);
    expect(evalSpecCondition({ not: { path: "drive", in: ["electric"] } }, gravel)).toBe(true);
  });

  it("reads a spec built by makeSpec the same way", () => {
    const stepThrough = makeSpec({ discipline: "city-hybrid", frameStyle: "step-through" });
    expect(evalSpecCondition({ path: "frameStyle", in: ["step-through"] }, stepThrough)).toBe(true);
    expect(evalSpecCondition({ path: "frameStyle", in: ["step-through"] }, DEFAULT_SPEC)).toBe(
      true,
    );
  });
});
