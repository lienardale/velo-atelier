/**
 * The part catalogue and `partsForSpec` (§2.3, §2.6).
 *
 *   - the catalogue parses with every refinement of `schema/part.ts`, holds
 *     exactly the 48 ids of §2.3, and every part is drawn or hosted by a drawn
 *     part (never both, never a chain of hosts);
 *   - every `includeWhen` is true for some bike and false for another, and
 *     every `presentWhen` likewise — a condition that never flips is dead data;
 *   - the structural promises: mid-drive bikes have a crankset and a motor but no
 *     bottom bracket, every bike has both brake levers;
 *   - every `procedures[]` slug is one of `EXPECTED_SLUGS` of its own kind, and
 *     every expected guide is reachable from some part;
 *   - every key the catalogue and the geometry measures emit resolves in both
 *     `messages/fr/parts.json` and `messages/en/parts.json`, with no stale copy.
 */
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename -- fixed paths under messages/ and offsets into our own catalogues */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";

import { DECISION_TREE } from "@/lib/domain/data/decision-tree";
import { GEOMETRY_MEASURES, GEOMETRY_MEASURE_IDS } from "@/lib/domain/data/geometry-measures";
import {
  clickTargetOf,
  hasMesh,
  HOSTED_PART_IDS,
  isPartId,
  partDefinition,
  PART_IDS,
  PARTS,
  RENDERED_PART_IDS,
  type PartId,
} from "@/lib/domain/data/parts";
import { rotorSizeFor } from "@/lib/domain/data/parts/brakes";
import { BIKE_PRESETS, PRESET_IDS } from "@/lib/domain/data/presets";
import { RETAILER_ORDER } from "@/lib/domain/data/retailers";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import { answerWithDefaults, isNodeVisible, visibleOptions } from "@/lib/domain/engine/decision";
import {
  buildForSpec,
  defaultAttributes,
  defaultAttributeValue,
  findPart,
  includedParts,
  isAttributePresent,
  isPartIncluded,
  partsForSpec,
} from "@/lib/domain/engine/parts-for-spec";
import { ATTRIBUTE_UNITS, PART_POSITIONS, PART_SYSTEMS } from "@/lib/domain/data/conventions";
import type { BikeSpec } from "@/lib/domain/schema/bike-spec";
import type { Answers } from "@/lib/domain/schema/decision";
import { checkPartCatalog, PartCatalogSchema } from "@/lib/domain/schema/part";
import {
  EXPECTED_SLUGS,
  FULL_SLUGS,
  GUIDE_KINDS,
  isExpectedSlug,
  kindOfSlug,
  MEASURE_SLUGS,
  CHECK_SLUGS,
} from "@/tests/fixtures/content-manifest";

const specOf = (answers: Answers): BikeSpec => buildBikeSpec(answerWithDefaults(answers));

/** Every bike one answer away from the default one, plus the presets — a varied sample. */
function sampleSpecs(): BikeSpec[] {
  const specs = PRESET_IDS.map((preset) => specOf(BIKE_PRESETS[preset]));
  const roots: Answers[] = [
    {},
    { drive: "electric" },
    { discipline: "road" },
    { discipline: "gravel" },
    { discipline: "mtb" },
    { discipline: "kids" },
    { drivetrain: "singlespeed" },
    { drivetrain: "igh", transmission: "belt" },
    { drive: "electric", discipline: "mtb" },
  ];
  for (const root of roots) {
    const complete = answerWithDefaults(root);
    for (const node of DECISION_TREE) {
      if (!isNodeVisible(node, complete)) continue;
      for (const option of visibleOptions(node, complete)) {
        specs.push(specOf({ ...complete, [node.id]: option.id }));
      }
    }
  }
  return specs;
}

const SPECS = sampleSpecs();

// ── The catalogue ────────────────────────────────────────────────────────────

describe("the part catalogue", () => {
  it("holds exactly the 48 parts of §2.3", () => {
    expect([...PART_IDS].sort()).toEqual(
      [
        "bottom-bracket",
        "brake-caliper-front",
        "brake-caliper-rear",
        "brake-lever-front",
        "brake-lever-rear",
        "brake-line-front",
        "brake-line-rear",
        "brake-pads-front",
        "brake-pads-rear",
        "belt",
        "cassette",
        "chain",
        "chainring",
        "crankset",
        "e-battery",
        "e-motor",
        "fork",
        "frame",
        "freewheel",
        "front-derailleur",
        "grips-or-tape",
        "handlebar",
        "headset",
        "internal-gear-hub",
        "kickstand",
        "lights",
        "mudguards",
        "pedal-left",
        "pedal-right",
        "rack",
        "rear-derailleur",
        "rear-shock",
        "rotor-front",
        "rotor-rear",
        "saddle",
        "seat-clamp",
        "seatpost",
        "sealant",
        "shift-cables",
        "shifter-left",
        "shifter-right",
        "stem",
        "tire-front",
        "tire-rear",
        "tube-front",
        "tube-rear",
        "wheel-front",
        "wheel-rear",
      ].sort(),
    );
    expectTypeOf<PartId>().toEqualTypeOf<(typeof PART_IDS)[number]>();
    expectTypeOf<"brake-caliper-front">().toMatchTypeOf<PartId>();
  });

  it("parses, refinements included", () => {
    expect(checkPartCatalog(PARTS)).toEqual([]);
    const parsed = PartCatalogSchema.safeParse(PARTS);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it("lists parts in system order", () => {
    const order = PARTS.map((part) => PART_SYSTEMS.indexOf(part.system));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("draws every part or hosts it on a drawn part, one level deep", () => {
    expect(RENDERED_PART_IDS).toEqual(PART_IDS.filter((id) => hasMesh(partDefinition(id)!)));
    expect([...RENDERED_PART_IDS, ...HOSTED_PART_IDS].sort()).toEqual([...PART_IDS].sort());
    for (const id of HOSTED_PART_IDS) {
      const host = partDefinition(id)!.hostPartId as PartId;
      expect(RENDERED_PART_IDS, id).toContain(host);
      expect(clickTargetOf(id)).toBe(host);
    }
    expect(clickTargetOf("saddle")).toBe("saddle");
    expect(partDefinition("acc-rack")).toBeUndefined();
    for (const id of ["mudguards", "rack", "kickstand", "lights"] as const) {
      expect(partDefinition(id)!.meshId).toBe(`acc-${id}`);
    }
  });

  it("recognises its own ids and nothing else", () => {
    expect(isPartId("chain")).toBe(true);
    expect(isPartId("chainring-big")).toBe(false);
    expect(isPartId("__proto__")).toBe(false);
    expect(isPartId(42)).toBe(false);
  });

  it("gives a paired part the position its id says", () => {
    for (const part of PARTS) {
      const suffix = /-(front|rear|left|right)$/.exec(part.id)?.[1];
      if (suffix !== undefined) expect(part.position, part.id).toBe(suffix);
    }
  });

  it("uses one vocabulary per attribute key", () => {
    const kinds = new Map<string, string>();
    for (const part of PARTS) {
      for (const attribute of part.attributes) {
        const seen = kinds.get(attribute.key);
        const shape = `${attribute.kind}:${attribute.unit ?? ""}`;
        if (seen !== undefined) expect(shape, `${part.id}.${attribute.key}`).toBe(seen);
        kinds.set(attribute.key, shape);
      }
    }
  });
});

// ── Presence ─────────────────────────────────────────────────────────────────

describe("partsForSpec", () => {
  it("flips every includeWhen and every presentWhen at least once", () => {
    for (const part of PARTS) {
      if (part.includeWhen !== undefined) {
        const results = new Set(SPECS.map((spec) => isPartIncluded(part, spec)));
        expect([...results].sort(), `${part.id}.includeWhen`).toEqual([false, true]);
      }
      for (const attribute of part.attributes) {
        if (attribute.presentWhen === undefined) continue;
        const results = new Set(SPECS.map((spec) => isAttributePresent(attribute, spec)));
        expect([...results].sort(), `${part.id}.${attribute.key}.presentWhen`).toEqual([
          false,
          true,
        ]);
      }
    }
  });

  it("puts the motor in the bottom bracket's place on a mid-drive bike", () => {
    const ids = partsForSpec(specOf(BIKE_PRESETS["emtb-mid-1x12"])).map((part) => part.partId);
    expect(ids).toContain("crankset");
    expect(ids).toContain("e-motor");
    expect(ids).not.toContain("bottom-bracket");

    const hubMotor = partsForSpec(specOf(BIKE_PRESETS["city-igh-8-hub-motor"]));
    expect(hubMotor.map((part) => part.partId)).toContain("bottom-bracket");
    expect(findPart({ spec: specOf({}), parts: hubMotor }, "e-motor")!.attributes).toEqual({
      "motor-brand": "bafang",
      torque: 45,
    });
  });

  it("gives every bike both brake levers and both calipers", () => {
    for (const spec of SPECS) {
      const ids = partsForSpec(spec).map((part) => part.partId);
      for (const id of [
        "brake-lever-front",
        "brake-lever-rear",
        "brake-caliper-front",
        "brake-caliper-rear",
      ]) {
        expect(ids).toContain(id);
      }
    }
  });

  it("fits tubes or sealant, a chain or a belt — never both", () => {
    for (const spec of SPECS) {
      const ids = new Set(partsForSpec(spec).map((part) => part.partId));
      expect(ids.has("tube-front")).not.toBe(ids.has("sealant"));
      expect(ids.has("chain")).not.toBe(ids.has("belt"));
    }
  });

  it("returns the parts in catalogue order, with default attributes", () => {
    const spec = specOf(BIKE_PRESETS["gravel-1x11"]);
    const parts = partsForSpec(spec);
    expect(parts.map((part) => part.partId)).toEqual(includedParts(spec).map((p) => p.id));
    expect(buildForSpec(spec)).toEqual({ spec, parts });
    expect(findPart(buildForSpec(spec), "cassette")!.attributes).toEqual({
      speeds: 11,
      range: "11-42",
      "largest-cog": 42,
      freehub: "hg-l",
    });
    expect(findPart(buildForSpec(spec), "belt")).toBeUndefined();
  });

  it("leaves off attributes that are absent or cannot be guessed", () => {
    const rigid = specOf(BIKE_PRESETS["road-rim-2x11"]);
    const fork = partDefinition("fork")!;
    expect(Object.keys(defaultAttributes(fork, rigid))).toEqual([
      "axle",
      "steerer",
      "max-tire-width",
    ]);
    const seatpost = partDefinition("seatpost")!;
    const measurement = seatpost.attributes.find((a) => a.key === "seatpost-diameter")!;
    expect(defaultAttributeValue(measurement, rigid)).toBeNull();
    expect(defaultAttributes(seatpost, rigid)).toEqual({ dropper: false });

    const suspended = specOf(BIKE_PRESETS["mtb-full-dropper-1x12"]);
    expect(defaultAttributes(fork, suspended)).toMatchObject({ "travel-mm": 140, spring: "air" });
    expect(defaultAttributes(seatpost, suspended)).toEqual({ dropper: true, "travel-mm": 170 });
  });

  it("sizes a caliper's rotor from its mount and adapter", () => {
    expect(rotorSizeFor("flat-mount", "+20")).toBe(160);
    expect(rotorSizeFor("post-mount", "+40")).toBe(203);
    expect(rotorSizeFor("post-mount", "is-to-flat")).toBeNull();
    expect(rotorSizeFor("rim", "none")).toBeNull();
    // …and the default bike's adapter agrees with its default rotor.
    for (const spec of SPECS.filter((entry) => entry.brakes.isDisc)) {
      const build = buildForSpec(spec);
      for (const side of ["front", "rear"]) {
        const caliper = findPart(build, `brake-caliper-${side}`)!.attributes;
        // A 203 rotor on a flat mount has no adapter: `rotor-caliper-mount` warns instead.
        if (caliper.mount === "flat-mount" && caliper["rotor-size"] === 203) continue;
        expect(rotorSizeFor(caliper.mount, caliper.adapter), JSON.stringify(caliper)).toBe(
          caliper["rotor-size"],
        );
      }
    }
  });
});

// ── Procedures ───────────────────────────────────────────────────────────────

describe("the guide contract", () => {
  it("fixes the slug manifest of §5.7", () => {
    expect(new Set(EXPECTED_SLUGS).size).toBe(EXPECTED_SLUGS.length);
    expect(new Set(FULL_SLUGS).size).toBe(FULL_SLUGS.length);
    for (const slug of FULL_SLUGS) expect(isExpectedSlug(slug)).toBe(true);
    for (const slug of [...CHECK_SLUGS, ...MEASURE_SLUGS]) expect(FULL_SLUGS).toContain(slug);
    for (const slug of EXPECTED_SLUGS) expect(GUIDE_KINDS).toContain(kindOfSlug(slug));
    expect(isExpectedSlug("check-everything")).toBe(false);
  });

  it("points every part at expected guides of the right kind", () => {
    for (const part of PARTS) {
      for (const [kind, slugs] of Object.entries(part.procedures)) {
        for (const slug of slugs) {
          expect(isExpectedSlug(slug), `${part.id}: ${slug}`).toBe(true);
          expect(kindOfSlug(slug as (typeof EXPECTED_SLUGS)[number]), `${part.id}: ${slug}`).toBe(
            kind,
          );
        }
      }
    }
  });

  it("reaches every expected guide from some part", () => {
    const referenced = new Set(PARTS.flatMap((part) => Object.values(part.procedures).flat()));
    expect(EXPECTED_SLUGS.filter((slug) => !referenced.has(slug))).toEqual([]);
  });

  it("gives every rendered part a check guide", () => {
    for (const id of RENDERED_PART_IDS) {
      expect(partDefinition(id)!.procedures.check?.length, id).toBeGreaterThan(0);
    }
  });

  it("points every geometry measure at a full measure or adjust guide", () => {
    expect(GEOMETRY_MEASURES.map((entry) => entry.id)).toEqual([...GEOMETRY_MEASURE_IDS]);
    for (const measure of GEOMETRY_MEASURES) {
      expect(FULL_SLUGS, measure.id).toContain(measure.guideSlug);
      expect(["measure", "adjust"]).toContain(
        kindOfSlug(measure.guideSlug as (typeof EXPECTED_SLUGS)[number]),
      );
      for (const partId of measure.partIds) expect(isPartId(partId)).toBe(true);
    }
  });
});

// ── Messages ─────────────────────────────────────────────────────────────────

type Tree = { [key: string]: string | Tree };

const partsCatalogue = (locale: string): Tree =>
  JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "parts.json"), "utf8")) as Tree;

function resolve(tree: Tree, key: string): unknown {
  let current: unknown = tree;
  for (const segment of key.replace(/^parts\./, "").split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Tree)[segment];
  }
  return current;
}

function flatten(tree: unknown, prefix: string): string[] {
  if (typeof tree !== "object" || tree === null) return [prefix];
  return Object.entries(tree).flatMap(([key, value]) => flatten(value, `${prefix}.${key}`));
}

/** Every key the domain emits under `parts.*`. */
function emittedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const part of PARTS) {
    keys.add(part.labelKey);
    keys.add(part.descriptionKey);
    for (const attribute of part.attributes) {
      keys.add(attribute.labelKey);
      keys.add(attribute.helpKey!);
      for (const value of attribute.values ?? []) {
        keys.add(`parts.values.${attribute.key}.${String(value)}`);
      }
    }
  }
  for (const system of PART_SYSTEMS) keys.add(`parts.systems.${system}`);
  for (const position of PART_POSITIONS) keys.add(`parts.position.${position}`);
  for (const unit of [...ATTRIBUTE_UNITS, "speeds"]) keys.add(`parts.units.${unit}`);
  for (const retailer of RETAILER_ORDER) keys.add(`parts.retailers.${retailer}`);
  for (const measure of GEOMETRY_MEASURES) {
    keys.add(measure.labelKey);
    keys.add(measure.helpKey);
  }
  for (const value of ["true", "false"]) keys.add(`parts.boolean.${value}`);
  for (const form of ["oneOf", "atMost", "atLeast", "between"]) {
    keys.add(`parts.constraints.${form}`);
  }
  return keys;
}

describe("messages/*/parts.json", () => {
  const emitted = emittedKeys();

  for (const locale of ["fr", "en"]) {
    it(`resolves every emitted key in ${locale}`, () => {
      const tree = partsCatalogue(locale);
      const missing = [...emitted].filter((key) => {
        const value = resolve(tree, key);
        return typeof value !== "string" || value.trim() === "";
      });
      expect(missing).toEqual([]);
    });

    it(`holds no stale key in ${locale}`, () => {
      const onDisk = flatten(partsCatalogue(locale), "parts");
      expect(onDisk.filter((key) => !emitted.has(key))).toEqual([]);
    });
  }

  it("names every speed the catalogue can hold, singular and plural alike", () => {
    const labels = resolve(partsCatalogue("en"), "parts.values.speeds") as Tree;
    expect(labels["6-7-8"]).toBe("6-7-8 speed");
    expect(labels.single).toBe("Single speed");
  });
});
