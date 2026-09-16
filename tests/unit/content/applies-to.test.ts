/**
 * `appliesTo` (§5.1, §6.2): evaluation against real specs, the vocabulary the
 * content check validates conditions with, and the tree the banner translates.
 */
/* eslint-disable security/detect-object-injection -- lookups keyed by spec paths from SPEC_VOCABULARY */
import { describe, expect, it } from "vitest";

import {
  conditionLeaves,
  conditionMessageKeys,
  conditionProblems,
  describeCondition,
  isNumericPath,
  matchesSpec,
  pathKey,
  SPEC_VOCABULARY,
  stepsForSpec,
  valueKey,
} from "@/lib/content/applies-to";
import type { SpecCondition } from "@/lib/domain/schema/condition";
import { specFor } from "@/tests/_fakes/domain/build";

import fr from "@/messages/fr/guides.json";

const DISC: SpecCondition<string> = { path: "brakes.isDisc", in: [true] };

describe("matchesSpec / stepsForSpec", () => {
  it("is true without a condition, and follows the spec otherwise", () => {
    expect(matchesSpec(undefined, specFor("road-rim-2x11"))).toBe(true);
    expect(matchesSpec(DISC, specFor("road-rim-2x11"))).toBe(false);
    expect(matchesSpec(DISC, specFor("gravel-1x11"))).toBe(true);
  });

  it("keeps only the steps whose own condition holds, in order", () => {
    const steps = [
      { id: "a" },
      {
        id: "b",
        appliesTo: { path: "brakes.type", in: ["disc-hydraulic"] } as SpecCondition<string>,
      },
      { id: "c", appliesTo: { not: DISC } as SpecCondition<string> },
    ];
    expect(stepsForSpec(steps, specFor("road-rim-2x11")).map((s) => s.id)).toEqual(["a", "c"]);
    expect(stepsForSpec(steps, specFor("road-disc-2x12")).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("the spec vocabulary", () => {
  it("holds a value every preset actually produces, for every path", () => {
    for (const preset of ["road-rim-2x11", "emtb-mid-1x12", "city-igh-8-hub-motor"] as const) {
      const spec = specFor(preset) as unknown as Record<string, Record<string, unknown>>;
      for (const [path, vocabulary] of Object.entries(SPEC_VOCABULARY)) {
        const [head, tail] = path.split(".");
        const value = tail === undefined ? spec[head] : spec[head]?.[tail];
        if (value === undefined || value === null) continue;
        expect(vocabulary.values as unknown[], `${preset}: ${path}`).toContain(value);
      }
    }
  });

  it("has a label for every path and every non-numeric value in both catalogues", () => {
    for (const [path, vocabulary] of Object.entries(SPEC_VOCABULARY)) {
      const key = pathKey(path) as keyof typeof fr.appliesTo.paths;
      expect(fr.appliesTo.paths[key], path).toBeTruthy();
      if (vocabulary.kind === "number") continue;
      const values = (fr.appliesTo.values as Record<string, Record<string, string>>)[key];
      for (const value of vocabulary.values)
        expect(values[valueKey(value)], `${path}=${value}`).toBeTruthy();
    }
  });

  it("knows which paths are numeric", () => {
    expect(isNumericPath("drivetrain.speeds")).toBe(true);
    expect(isNumericPath("brakes.type")).toBe(false);
    expect(isNumericPath("nope")).toBe(false);
  });

  it("escapes dots in keys", () => {
    expect(pathKey("wheel.label")).toBe("wheel_label");
    expect(valueKey("27.5")).toBe("27_5");
    expect(valueKey(true)).toBe("true");
  });
});

describe("conditionProblems", () => {
  it("accepts a valid nested condition", () => {
    expect(
      conditionProblems({
        all: [
          DISC,
          {
            any: [
              { path: "drivetrain.speeds", in: [11, 12] },
              { not: { path: "drive", notIn: ["electric"] } },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("locates unknown paths and impossible values", () => {
    expect(
      conditionProblems({
        any: [
          { path: "brakes.isDsic", in: [true] },
          { not: { path: "brakes.type", notIn: ["disk-hydraulic"] } },
        ],
      }),
    ).toEqual([
      { path: ["any", 0, "path"], message: '"brakes.isDsic" is not a BikeSpec path' },
      {
        path: ["any", 1, "not", "notIn", 0],
        message: '"disk-hydraulic" is not a possible value of "brakes.type"',
      },
    ]);
  });
});

describe("leaves, message keys and description", () => {
  const condition: SpecCondition<string> = {
    all: [
      DISC,
      {
        any: [
          { path: "drivetrain.speeds", notIn: [12] },
          { not: { path: "wheel.label", in: ["27.5"] } },
        ],
      },
    ],
  };

  it("lists every leaf", () => {
    expect(conditionLeaves(condition)).toEqual([
      { path: "brakes.isDisc", value: true },
      { path: "drivetrain.speeds", value: 12 },
      { path: "wheel.label", value: "27.5" },
    ]);
  });

  it("needs a path label per leaf and a value label for non-numeric values", () => {
    expect(conditionMessageKeys(condition).sort()).toEqual(
      [
        "appliesTo.paths.brakes_isDisc",
        "appliesTo.values.brakes_isDisc.true",
        "appliesTo.paths.drivetrain_speeds",
        "appliesTo.paths.wheel_label",
        "appliesTo.values.wheel_label.27_5",
      ].sort(),
    );
  });

  it("describes the condition as a tree", () => {
    expect(describeCondition(condition)).toEqual({
      kind: "all",
      children: [
        {
          kind: "leaf",
          pathKey: "brakes_isDisc",
          negated: false,
          values: [{ key: "true", raw: "true", numeric: false }],
        },
        {
          kind: "any",
          children: [
            {
              kind: "leaf",
              pathKey: "drivetrain_speeds",
              negated: true,
              values: [{ key: "12", raw: "12", numeric: true }],
            },
            {
              kind: "not",
              child: {
                kind: "leaf",
                pathKey: "wheel_label",
                negated: false,
                values: [{ key: "27_5", raw: "27.5", numeric: false }],
              },
            },
          ],
        },
      ],
    });
  });
});
