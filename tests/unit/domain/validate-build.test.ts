/**
 * `validateBuild` and the build edits (§2.5).
 *
 *   - every default build of every preset round-trips unchanged;
 *   - one table row per rejection, each with the exact issue it produces;
 *   - the hand-written spec check agrees with `BikeSpecSchema` on thousands of
 *     generated inputs (fast-check) — the price of keeping this module zod-free;
 *   - `setAttribute`, `addOptionalPart`, `removeOptionalPart`,
 *     `optionalPartsFor` and `meshIdsForSpec` on real builds.
 *
 * The mass-assignment fixture lives in `tests/security/mass-assignment-build.test.ts`.
 */
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename -- offsets into our own fixtures; a fixed list of files under lib/domain */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { PARTS, partDefinition } from "@/lib/domain/data/parts";
import { rotorSizeFor } from "@/lib/domain/data/parts/brakes";
import { BIKE_PRESETS, PRESET_IDS } from "@/lib/domain/data/presets";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import { answerWithDefaults } from "@/lib/domain/engine/decision";
import { buildForSpec, findPart, isPartIncluded } from "@/lib/domain/engine/parts-for-spec";
import {
  addOptionalPart,
  coerceAttributeValue,
  isPlainObject,
  isValidAttributeValue,
  MAX_BUILD_PARTS,
  MAX_TEXT_LENGTH,
  meshIdsForSpec,
  optionalPartsFor,
  removeOptionalPart,
  setAttribute,
  specIssues,
  validateBuild,
  type BuildIssue,
} from "@/lib/domain/engine/validate-build";
import { BikeSpecSchema } from "@/lib/domain/schema/bike-spec";
import type { Answers } from "@/lib/domain/schema/decision";
import type { AttributeDef, BikeBuild } from "@/lib/domain/schema/part";

const buildOf = (answers: Answers): BikeBuild =>
  buildForSpec(buildBikeSpec(answerWithDefaults(answers)));

const ROAD_RIM = buildOf(BIKE_PRESETS["road-rim-2x11"]);
const ROAD_DISC = buildOf(BIKE_PRESETS["road-disc-2x12"]);
const GRAVEL = buildOf(BIKE_PRESETS["gravel-1x11"]);

/** A JSON copy with one change applied — what an attacker or a stale client would send. */
function tampered(build: BikeBuild, change: (draft: Record<string, unknown>) => void): unknown {
  const draft = JSON.parse(JSON.stringify(build)) as Record<string, unknown>;
  change(draft);
  return draft;
}

const partsOf = (draft: Record<string, unknown>) =>
  draft.parts as { partId: unknown; attributes: Record<string, unknown> }[];

const issuesOf = (input: unknown): BuildIssue[] => {
  const result = validateBuild(input);
  return result.ok ? [] : result.issues;
};

describe("validateBuild accepts", () => {
  it("the default build of every preset, returned as an equal but separate object", () => {
    for (const preset of PRESET_IDS) {
      const build = buildOf(BIKE_PRESETS[preset]);
      const result = validateBuild(JSON.parse(JSON.stringify(build)));
      expect(result.issues, preset).toEqual([]);
      expect(result.build).toEqual(build);
      expect(result.build).not.toBe(build);
    }
  });

  it("a build without its optional parts, or with an optional part added", () => {
    const withoutCassette = tampered(GRAVEL, (draft) => {
      draft.parts = partsOf(draft).filter((part) => part.partId !== "cassette");
    });
    expect(validateBuild(withoutCassette).ok).toBe(true);
    const withRack = addOptionalPart(GRAVEL, "rack");
    expect(withRack.ok && validateBuild(withRack.build).ok).toBe(true);
  });

  it("a build whose null-default attributes are filled in, or left out", () => {
    const measured = tampered(ROAD_RIM, (draft) => {
      partsOf(draft).find((part) => part.partId === "seatpost")!.attributes["seatpost-diameter"] =
        27.2;
    });
    expect(validateBuild(measured).ok).toBe(true);
  });
});

describe("validateBuild rejects", () => {
  const cases: [string, unknown, BuildIssue[]][] = [
    ["a non-object", "build", [{ path: "", code: "invalid-shape" }]],
    ["an array", [], [{ path: "", code: "invalid-shape" }]],
    ["null", null, [{ path: "", code: "invalid-shape" }]],
    [
      "an unknown envelope key",
      tampered(ROAD_RIM, (draft) => {
        draft.userId = "someone-else";
      }),
      [{ path: "userId", code: "unknown-key" }],
    ],
    [
      "parts that are not an array",
      tampered(ROAD_RIM, (draft) => {
        draft.parts = {};
      }),
      [{ path: "parts", code: "invalid-shape" }],
    ],
    [
      "more parts than a bike can have",
      tampered(ROAD_RIM, (draft) => {
        draft.parts = Array.from({ length: MAX_BUILD_PARTS + 1 }, () => ({}));
      }),
      [{ path: "parts", code: "too-many-parts" }],
    ],
    [
      "a spec with a wrong value",
      tampered(ROAD_RIM, (draft) => {
        (draft.spec as { discipline: string }).discipline = "track";
      }),
      [{ path: "spec.discipline", code: "invalid-value" }],
    ],
    [
      "a spec with an extra key",
      tampered(ROAD_RIM, (draft) => {
        (draft.spec as { brakes: Record<string, unknown> }).brakes.isAdmin = true;
      }),
      [{ path: "spec.brakes.isAdmin", code: "unknown-key" }],
    ],
    [
      "a spec with a branch that is not an object",
      tampered(ROAD_RIM, (draft) => {
        (draft.spec as { wheel: unknown }).wheel = "700c";
      }),
      [{ path: "spec.wheel", code: "invalid-shape" }],
    ],
    [
      "a spec missing a field",
      tampered(ROAD_RIM, (draft) => {
        delete (draft.spec as { pedals?: string }).pedals;
      }),
      [{ path: "spec.pedals", code: "invalid-value" }],
    ],
    [
      "a part that is not an object",
      tampered(ROAD_RIM, (draft) => {
        partsOf(draft)[0] = "frame" as never;
      }),
      [
        { path: "parts.0", code: "invalid-shape" },
        { path: "parts.frame", code: "missing-part" },
      ],
    ],
    [
      "an unknown part id",
      tampered(ROAD_RIM, (draft) => {
        partsOf(draft).push({ partId: "jetpack", attributes: {} });
      }),
      [{ path: `parts.${ROAD_RIM.parts.length}.partId`, code: "unknown-part" }],
    ],
    [
      "a part id that is not a string",
      tampered(ROAD_RIM, (draft) => {
        partsOf(draft).push({ partId: 7, attributes: {} });
      }),
      [{ path: `parts.${ROAD_RIM.parts.length}.partId`, code: "unknown-part" }],
    ],
    [
      "a part fitted twice",
      tampered(ROAD_RIM, (draft) => {
        partsOf(draft).push({ partId: "chain", attributes: {} });
      }),
      [{ path: `parts.${ROAD_RIM.parts.length}.partId`, code: "duplicate-part" }],
    ],
    [
      "a part this bike cannot have",
      tampered(ROAD_RIM, (draft) => {
        partsOf(draft).push({ partId: "rotor-front", attributes: {} });
      }),
      [{ path: `parts.${ROAD_RIM.parts.length}.partId`, code: "part-not-allowed" }],
    ],
    [
      "a required part left out",
      tampered(ROAD_RIM, (draft) => {
        draft.parts = partsOf(draft).filter((part) => part.partId !== "brake-lever-rear");
      }),
      [{ path: "parts.brake-lever-rear", code: "missing-part" }],
    ],
    [
      "an extra key on a part",
      tampered(ROAD_RIM, (draft) => {
        (partsOf(draft)[0] as Record<string, unknown>).price = 0;
      }),
      [{ path: "parts.0.price", code: "unknown-key" }],
    ],
    [
      "attributes that are not an object",
      tampered(ROAD_RIM, (draft) => {
        partsOf(draft)[0].attributes = [] as never;
      }),
      [{ path: "parts.0.attributes", code: "invalid-shape" }],
    ],
    [
      "an attribute the part does not have",
      tampered(ROAD_RIM, (draft) => {
        partsOf(draft)[0].attributes.colour = "red";
      }),
      [{ path: "parts.0.attributes.colour", code: "unknown-attribute" }],
    ],
    [
      "an attribute that is not present on this bike",
      tampered(ROAD_RIM, (draft) => {
        partsOf(draft)[0].attributes["max-rotor"] = 160;
      }),
      [{ path: "parts.0.attributes.max-rotor", code: "unknown-attribute" }],
    ],
    [
      "an enum value that is not one of the values",
      tampered(ROAD_RIM, (draft) => {
        partsOf(draft)[0].attributes.material = "cardboard";
      }),
      [{ path: "parts.0.attributes.material", code: "invalid-value" }],
    ],
    [
      "a number out of range",
      tampered(ROAD_RIM, (draft) => {
        partsOf(draft)[0].attributes["max-tire-width"] = 500;
      }),
      [{ path: "parts.0.attributes.max-tire-width", code: "invalid-value" }],
    ],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      const result = validateBuild(input);
      expect(result.ok).toBe(false);
      expect(result.build).toBeNull();
      expect(result.issues).toEqual(expected);
    });
  }

  it("an over-long text, a non-finite number, a string boolean", () => {
    const hanger = tampered(ROAD_RIM, (draft) => {
      partsOf(draft).find((part) => part.partId === "rear-derailleur")!.attributes["hanger-model"] =
        "x".repeat(MAX_TEXT_LENGTH + 1);
    });
    expect(issuesOf(hanger).map((issue) => issue.code)).toEqual(["invalid-value"]);

    const infinite = structuredClone(ROAD_RIM);
    findPart(infinite, "frame")!.attributes["max-tire-width"] = Number.POSITIVE_INFINITY;
    expect(issuesOf(infinite).map((issue) => issue.code)).toEqual(["invalid-value"]);

    const stringly = tampered(ROAD_RIM, (draft) => {
      partsOf(draft).find((part) => part.partId === "chain")!.attributes["e-rated"] = "false";
    });
    expect(issuesOf(stringly).map((issue) => issue.code)).toEqual(["invalid-value"]);
  });
});

// ── The spec check agrees with BikeSpecSchema ────────────────────────────────

describe("specIssues", () => {
  const specs = PRESET_IDS.map((preset) => buildOf(BIKE_PRESETS[preset]).spec);

  const leafValues = fc.oneof(
    fc.constantFrom(
      null,
      undefined,
      true,
      false,
      0,
      1,
      2,
      3,
      12,
      14,
      15,
      1.5,
      Number.NaN,
      "road",
      "mtb",
      "track",
      "700c",
      "27.5",
      622,
      584,
      "disc-hydraulic",
      "flat-mount",
      "mid-drive",
      "rack",
      "step-through",
      "",
    ),
    fc.object({ maxDepth: 1, maxKeys: 2 }),
    fc.array(fc.integer(), { maxLength: 2 }),
  );

  /** A valid spec with one path overwritten, deleted, or an extra key added. */
  const mutated = fc
    .tuple(
      fc.constantFrom(...specs),
      fc.constantFrom(
        "version",
        "drive",
        "discipline",
        "wheel",
        "wheel.label",
        "wheel.etrtoDiameter",
        "brakes.type",
        "brakes.isDisc",
        "brakes.mount",
        "drivetrain",
        "drivetrain.chainrings",
        "drivetrain.speeds",
        "drivetrain.shifter",
        "cockpit.bar",
        "pedals",
        "suspension.rear",
        "seatpost",
        "tires.system",
        "eSystem",
        "eSystem.motorPosition",
        "frameStyle",
        "extra",
        "drivetrain.extra",
      ),
      fc.oneof(leafValues, fc.constant("__delete__")),
    )
    .map(([spec, path, value]) => {
      const copy = structuredClone(spec) as Record<string, unknown>;
      const segments = path.split(".");
      let parent: Record<string, unknown> = copy;
      for (const segment of segments.slice(0, -1)) {
        const next = parent[segment];
        if (typeof next !== "object" || next === null) return copy;
        parent = next as Record<string, unknown>;
      }
      const last = segments[segments.length - 1];
      if (value === "__delete__") delete parent[last];
      else parent[last] = value;
      return copy;
    });

  it("accepts exactly what BikeSpecSchema accepts", () => {
    fc.assert(
      fc.property(fc.oneof(mutated, fc.anything()), (input) => {
        expect(specIssues(input).length === 0).toBe(BikeSpecSchema.safeParse(input).success);
      }),
      { numRuns: 3000 },
    );
  });

  it("accepts the specs of the presets", () => {
    for (const spec of specs) expect(specIssues(spec)).toEqual([]);
  });
});

// ── Plain objects and values ─────────────────────────────────────────────────

describe("the value checks", () => {
  it("recognise a JSON object and nothing else", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("{}")).toBe(false);
  });

  const number = (overrides: Partial<AttributeDef> = {}): AttributeDef => ({
    key: "width",
    kind: "number",
    editable: true,
    default: { fallback: null, when: [] },
    labelKey: "parts.attr.width.label",
    ...overrides,
  });

  it("bound numbers by min and max only when they are set", () => {
    expect(isValidAttributeValue(number(), -1e9)).toBe(true);
    expect(isValidAttributeValue(number({ min: 0 }), -1)).toBe(false);
    expect(isValidAttributeValue(number({ max: 10 }), 11)).toBe(false);
    expect(isValidAttributeValue(number({ min: 0, max: 10 }), 10)).toBe(true);
    expect(isValidAttributeValue(number(), Number.NaN)).toBe(false);
    expect(isValidAttributeValue(number(), "3")).toBe(false);
  });

  it("coerce form strings into the attribute's own type", () => {
    const speeds = partDefinition("cassette")!.attributes.find((a) => a.key === "speeds")!;
    expect(coerceAttributeValue(speeds, "11")).toBe(11);
    expect(coerceAttributeValue(speeds, "4")).toBeUndefined();
    expect(coerceAttributeValue(number({ max: 40 }), "27.2")).toBe(27.2);
    expect(coerceAttributeValue(number({ max: 40 }), " ")).toBeUndefined();
    expect(coerceAttributeValue(number({ max: 40 }), 31.6)).toBe(31.6);
    const text = partDefinition("rear-derailleur")!.attributes.find(
      (a) => a.key === "hanger-model",
    )!;
    expect(coerceAttributeValue(text, "Pilo D38")).toBe("Pilo D38");
    const flag = partDefinition("chain")!.attributes.find((a) => a.key === "e-rated")!;
    expect(coerceAttributeValue(flag, true)).toBe(true);
    expect(coerceAttributeValue(flag, "true")).toBeUndefined();
  });
});

// ── Edits ────────────────────────────────────────────────────────────────────

describe("setAttribute", () => {
  it("sets a coerced value without touching the original build", () => {
    const result = setAttribute(GRAVEL, "cassette", "speeds", "12");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findPart(result.build, "cassette")!.attributes.speeds).toBe(12);
    expect(findPart(GRAVEL, "cassette")!.attributes.speeds).toBe(11);
    expect(findPart(result.build, "chain")).toBe(findPart(GRAVEL, "chain"));
  });

  it("clears a value with null", () => {
    const result = setAttribute(GRAVEL, "chain", "e-rated", null);
    expect(result.ok && findPart(result.build, "chain")!.attributes).toEqual({ speeds: 11 });
  });

  it("follows a caliper's mount and adapter with its rotor size", () => {
    const adapter = setAttribute(ROAD_DISC, "brake-caliper-front", "adapter", "+40");
    expect(
      adapter.ok && findPart(adapter.build, "brake-caliper-front")!.attributes["rotor-size"],
    ).toBe(rotorSizeFor("flat-mount", "+40"));
    const mount = setAttribute(ROAD_DISC, "brake-caliper-rear", "mount", "post-mount");
    expect(mount.ok && findPart(mount.build, "brake-caliper-rear")!.attributes["rotor-size"]).toBe(
      180,
    );
    const nonsense = setAttribute(ROAD_DISC, "brake-caliper-rear", "adapter", "is-to-post");
    expect(
      nonsense.ok &&
        Object.hasOwn(findPart(nonsense.build, "brake-caliper-rear")!.attributes, "rotor-size"),
    ).toBe(false);
    expect(rotorSizeFor("__proto__", "constructor")).toBeNull();
    expect(rotorSizeFor("post-mount", "constructor")).toBeNull();
  });

  it("refuses what validateBuild would refuse", () => {
    expect(setAttribute(GRAVEL, "jetpack", "speeds", 1)).toEqual({
      ok: false,
      code: "unknown-part",
    });
    expect(setAttribute(GRAVEL, "freewheel", "speeds", 7)).toEqual({
      ok: false,
      code: "part-not-fitted",
    });
    expect(setAttribute(GRAVEL, "cassette", "colour", "red")).toEqual({
      ok: false,
      code: "unknown-attribute",
    });
    expect(setAttribute(GRAVEL, "fork", "travel-mm", 120)).toEqual({
      ok: false,
      code: "unknown-attribute",
    });
    expect(setAttribute(GRAVEL, "cassette", "speeds", 4)).toEqual({
      ok: false,
      code: "invalid-value",
    });
    expect(setAttribute(GRAVEL, "handlebar", "bar-shape", "flat")).toEqual({
      ok: false,
      code: "not-editable",
    });
  });
});

describe("optional parts", () => {
  it("adds an optional part with its defaults, in catalogue order", () => {
    const result = addOptionalPart(GRAVEL, "rack");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.build.parts.map((part) => part.partId);
    expect(ids.indexOf("rack")).toBe(ids.length - 1);
    expect(findPart(result.build, "rack")!.attributes).toEqual({ "rack-mount": "frame-eyelets" });

    const freewheel = addOptionalPart(GRAVEL, "freewheel");
    expect(
      freewheel.ok && freewheel.build.parts.map((part) => part.partId).indexOf("freewheel"),
    ).toBe(ids.indexOf("cassette") + 1);
  });

  it("removes an optional part, and only an optional one", () => {
    const result = removeOptionalPart(GRAVEL, "cassette");
    expect(result.ok && findPart(result.build, "cassette")).toBeUndefined();
    expect(removeOptionalPart(GRAVEL, "chain")).toEqual({ ok: false, code: "not-optional" });
    expect(removeOptionalPart(GRAVEL, "rack")).toEqual({ ok: false, code: "part-not-fitted" });
    expect(removeOptionalPart(GRAVEL, "jetpack")).toEqual({ ok: false, code: "unknown-part" });
  });

  it("refuses to add a required, unknown or already fitted part", () => {
    expect(addOptionalPart(GRAVEL, "chain")).toEqual({ ok: false, code: "not-optional" });
    expect(addOptionalPart(GRAVEL, "cassette")).toEqual({ ok: false, code: "already-fitted" });
    expect(addOptionalPart(GRAVEL, "jetpack")).toEqual({ ok: false, code: "unknown-part" });
  });

  it("offers the optional parts the bike does not have by default", () => {
    expect(optionalPartsFor(GRAVEL.spec).map((part) => part.id)).toEqual([
      "freewheel",
      "mudguards",
      "rack",
      "kickstand",
      "lights",
    ]);
    const city = buildOf({ discipline: "city-hybrid" });
    expect(optionalPartsFor(city.spec).map((part) => part.id)).toEqual(["cassette", "freewheel"]);
  });
});

describe("meshIdsForSpec", () => {
  it("lists the meshes of the fitted, drawn parts", () => {
    for (const preset of PRESET_IDS) {
      const spec = buildOf(BIKE_PRESETS[preset]).spec;
      const expected = PARTS.filter(
        (part) => part.meshId !== null && isPartIncluded(part, spec),
      ).map((part) => part.meshId);
      expect(meshIdsForSpec(spec), preset).toEqual(expected);
    }
    expect(meshIdsForSpec(ROAD_RIM.spec)).not.toContain("rotor-front");
    expect(meshIdsForSpec(buildOf({ discipline: "city-hybrid" }).spec)).toContain("acc-rack");
  });
});

// ── Barrel safety ────────────────────────────────────────────────────────────

/**
 * The W1-T2 data and engine modules are meant for `lib/domain/index.ts`, the
 * zod-free barrel (`no-zod-in-barrel.test.ts` walks it once they are exported).
 * Until then this pins the same promise file by file: no runtime import of zod
 * or of a `schema/*` module (which loads zod) — type-only imports erase.
 */
describe("the W1-T2 modules", () => {
  const root = join(process.cwd(), "lib", "domain");
  const files = [
    ...readdirSync(join(root, "data", "parts")).map((file) => join(root, "data", "parts", file)),
    ...["rules", "tools", "geometry-measures", "retailers"].map((name) =>
      join(root, "data", `${name}.ts`),
    ),
    ...["parts-for-spec", "compatibility", "buying-guide", "validate-build", "migrate"].map(
      (name) => join(root, "engine", `${name}.ts`),
    ),
    join(root, "i18n.ts"),
  ];

  it("import neither zod nor a schema module at runtime", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        const specifier = statement.moduleSpecifier;
        if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
        const typeOnly = ts.isImportDeclaration(statement)
          ? statement.importClause?.isTypeOnly === true
          : statement.isTypeOnly;
        const risky = specifier.text === "zod" || specifier.text.includes("/schema");
        if (risky && !typeOnly) offenders.push(`${file}: ${specifier.text}`);
      }
    }
    expect(files.length).toBeGreaterThan(15);
    expect(offenders).toEqual([]);
  });
});
