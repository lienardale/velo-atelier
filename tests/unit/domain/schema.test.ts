/**
 * The domain data, parsed and refined (§2.6).
 *
 * Three kinds of assertion live here, and the order matters:
 *
 *   1. the shipped data parses — the decision tree, the illustration registry
 *      and the presets are what the product is made of;
 *   2. every refinement actually catches what it claims to catch, proven with a
 *      deliberately broken copy (a refinement nobody has seen fail is a comment);
 *   3. every `*Key` the data emits resolves to a real string in **both**
 *      `messages/fr` and `messages/en` — the CI-enforced parity contract that
 *      turns "we forgot to translate one option" into a failing unit test
 *      instead of a raw key on screen.
 */
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename -- fixed paths under messages/ and offsets into our own catalogues */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BIKE_PRESETS,
  BRAKE_SIDE,
  DECISION_TREE,
  ILLUSTRATIONS,
  ILLUSTRATION_IDS,
  isId,
  isIllustrationId,
  nodeFor,
  pairFrontRear,
  PRESET_IDS,
  QUESTION_IDS,
  type DecisionNode,
  type QuestionId,
} from "@/lib/domain";
import { ILLUSTRATION_COMPONENTS } from "@/components/illustrations";
import { routing } from "@/lib/i18n/routing";
import { AnswersSchema, checkDecisionTree, DecisionTreeSchema } from "@/lib/domain/schema/decision";
import {
  checkIllustrations,
  IllustrationRegistrySchema,
  type IllustrationDef,
} from "@/lib/domain/schema/illustration";
import {
  checkPartCatalog,
  PartCatalogSchema,
  type AttributeDef,
  type PartDefinition,
} from "@/lib/domain/schema/part";
import {
  checkProcedure,
  guideKindFor,
  KoConsequenceSchema,
  ProcedureMetaSchema,
  ToolDefSchema,
  type ProcedureMeta,
} from "@/lib/domain/schema/procedure";
import {
  buildSearchUrl,
  RetailerDefSchema,
  RETAILER_LOCALES,
  type RetailerDef,
} from "@/lib/domain/schema/retailer";
import {
  checkRuleCatalog,
  RuleCatalogSchema,
  RuleCheckSchema,
  CompatibilityRuleSchema,
  type CompatibilityRule,
} from "@/lib/domain/schema/rule";

// ── Helpers ──────────────────────────────────────────────────────────────────

const clone = <T>(value: T): T => structuredClone(value) as T;

/** The tree, mutable, for the "break one thing" cases. */
const brokenTree = (mutate: (nodes: DecisionNode[]) => void): DecisionNode[] => {
  const nodes = clone(DECISION_TREE) as DecisionNode[];
  mutate(nodes);
  return nodes;
};

const failsWith = (nodes: DecisionNode[], pattern: RegExp) => {
  const errors = checkDecisionTree(nodes);
  expect(errors.join("\n")).toMatch(pattern);
  expect(DecisionTreeSchema.safeParse(nodes).success).toBe(false);
};

/** `messages/<locale>/<namespace>.json`, read straight off disk. */
const catalogue = (locale: string, namespace: string): unknown =>
  JSON.parse(
    readFileSync(join(process.cwd(), "messages", locale, `${namespace}.json`), "utf8"),
  ) as unknown;

const CATALOGUES: Record<string, Record<string, unknown>> = Object.fromEntries(
  routing.locales.map((locale) => [
    locale,
    { decision: catalogue(locale, "decision"), illustrations: catalogue(locale, "illustrations") },
  ]),
);

/** Resolve `decision.drive.title` the way next-intl would, or `undefined`. */
function message(locale: string, key: string): unknown {
  const [namespace, ...path] = key.split(".");
  let current: unknown = CATALOGUES[locale]?.[namespace];
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Every flattened key of a catalogue, for the "no stale copy" check. */
function flatten(tree: unknown, prefix: string): string[] {
  if (typeof tree !== "object" || tree === null) return [prefix];
  return Object.entries(tree).flatMap(([key, value]) =>
    flatten(value, prefix ? `${prefix}.${key}` : key),
  );
}

// ── The decision tree ────────────────────────────────────────────────────────

describe("the decision tree", () => {
  it("is made of exactly these sixteen questions, in this order", () => {
    expect([...QUESTION_IDS]).toEqual([
      "drive",
      "discipline",
      "wheel-size",
      "brake-type",
      "brake-mount",
      "cockpit",
      "drivetrain",
      "transmission",
      "speeds",
      "shifter",
      "pedals",
      "suspension",
      "seatpost",
      "tire-system",
      "e-motor",
      "e-battery",
    ]);
    expect(DECISION_TREE.map((node) => node.id)).toEqual([...QUESTION_IDS]);
  });

  it("parses, refinements included", () => {
    const parsed = DecisionTreeSchema.safeParse(DECISION_TREE);
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).toEqual([]);
    expect(checkDecisionTree(DECISION_TREE)).toEqual([]);
  });

  it("gives every id a shape that can be a message-key segment and a URL value", () => {
    for (const node of DECISION_TREE) {
      expect(isId(node.id), node.id).toBe(true);
      for (const option of node.options) expect(isId(option.id), option.id).toBe(true);
    }
  });

  it("asks for a thumbnail from four options up, unless the ids are plain numbers", () => {
    for (const node of DECISION_TREE) {
      const numeric = node.options.every((option) => /^[0-9]+$/.test(option.id));
      const expected = node.options.length >= 4 && !numeric;
      for (const option of node.options) {
        expect(option.illustrationId !== undefined, `${node.id}.${option.id}`).toBe(expected);
      }
    }
    // The numeric grid: ten options, no art at all.
    expect(nodeFor("speeds").options).toHaveLength(10);
    expect(nodeFor("speeds").options.every((o) => o.illustrationId === undefined)).toBe(true);
  });

  it("never reads a question that is asked later", () => {
    // Enforced by the refinement; asserted here as the contract it protects.
    expect(checkDecisionTree(DECISION_TREE)).toEqual([]);
    failsWith(
      brokenTree((nodes) => {
        nodes[0].visibleWhen = { q: "speeds", in: ["11"] };
      }),
      /drive: condition references "speeds" \(order 9\), which is not asked earlier/,
    );
  });
});

describe("checkDecisionTree catches", () => {
  it("a duplicate question id", () => {
    failsWith(
      brokenTree((nodes) => {
        nodes[1].id = "drive";
      }),
      /drive: duplicate question id/,
    );
  });

  it("an order that is not the node's position", () => {
    failsWith(
      brokenTree((nodes) => {
        nodes[2].order = 7;
      }),
      /wheel-size: order 7 is not its 1-based position 3/,
    );
  });

  it("a duplicate option id", () => {
    failsWith(
      brokenTree((nodes) => {
        nodes[0].options = [nodes[0].options[0], nodes[0].options[0]];
      }),
      /drive\.muscular: duplicate option id/,
    );
  });

  it("a label key that is not derived from the ids", () => {
    failsWith(
      brokenTree((nodes) => {
        (nodes[0].options[0] as { labelKey: string }).labelKey = "decision.drive.muscular";
      }),
      /labelKey must be "decision\.drive\.options\.muscular\.label"/,
    );
  });

  it("a description key that is not derived from the ids — but accepts none at all", () => {
    failsWith(
      brokenTree((nodes) => {
        (nodes[0].options[0] as { descriptionKey?: string }).descriptionKey = "decision.drive.hint";
      }),
      /descriptionKey must be "decision\.drive\.options\.muscular\.description"/,
    );
    const withoutDescription = brokenTree((nodes) => {
      delete (nodes[0].options[0] as { descriptionKey?: string }).descriptionKey;
    });
    expect(checkDecisionTree(withoutDescription)).toEqual([]);
  });

  it("a thumbnail id that is not derived from the ids", () => {
    failsWith(
      brokenTree((nodes) => {
        (nodes[1].options[0] as { illustrationId?: string }).illustrationId = "ill-drive";
      }),
      /illustrationId must be "ill-discipline-road"/,
    );
  });

  it("a missing thumbnail on a node with four options or more", () => {
    failsWith(
      brokenTree((nodes) => {
        delete (nodes[1].options[0] as { illustrationId?: string }).illustrationId;
      }),
      /discipline\.road: a node with 5 options needs a thumbnail on every option/,
    );
  });

  it("a title, help text or help illustration that does not match its question", () => {
    failsWith(
      brokenTree((nodes) => {
        nodes[0].titleKey = "decision.drive.question";
      }),
      /drive: titleKey must be "decision\.drive\.title"/,
    );
    failsWith(
      brokenTree((nodes) => {
        nodes[0].help = { ...nodes[0].help, textKey: "decision.drive.hint" };
      }),
      /drive: help\.textKey must be "decision\.drive\.help"/,
    );
    failsWith(
      brokenTree((nodes) => {
        nodes[0].help = { ...nodes[0].help, illustrationId: "ill-speeds" };
      }),
      /drive: help\.illustrationId must be "ill-drive"/,
    );
  });

  it("a default that is not one of the options", () => {
    failsWith(
      brokenTree((nodes) => {
        nodes[0].default = { ...nodes[0].default, fallback: "hybrid" };
      }),
      /drive: default fallback "hybrid" is not an option/,
    );
    failsWith(
      brokenTree((nodes) => {
        nodes[3].default = {
          ...nodes[3].default,
          when: [{ when: { q: "discipline", in: ["road"] }, option: "drum" }],
        };
      }),
      /brake-type: conditional default "drum" is not an option/,
    );
  });

  it("a condition on a question that does not exist", () => {
    failsWith(
      brokenTree((nodes) => {
        nodes[3].visibleWhen = { q: "frame-material" as QuestionId, in: ["steel"] };
      }),
      /brake-type: condition references unknown question "frame-material"/,
    );
  });

  it("a nested condition that reads a later question", () => {
    failsWith(
      brokenTree((nodes) => {
        nodes[1].visibleWhen = {
          any: [{ not: { all: [{ q: "pedals", in: ["flat"] }] } }],
        };
      }),
      /discipline: condition references "pedals" \(order 11\)/,
    );
  });
});

// ── Illustrations ────────────────────────────────────────────────────────────

describe("the illustration registry", () => {
  it("parses and holds one entry per id", () => {
    const parsed = IllustrationRegistrySchema.safeParse(ILLUSTRATIONS);
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).toEqual([]);
    expect(checkIllustrations(ILLUSTRATIONS)).toEqual([]);
    expect(Object.keys(ILLUSTRATIONS)).toEqual([...ILLUSTRATION_IDS]);
    expect(new Set(ILLUSTRATION_IDS).size).toBe(ILLUSTRATION_IDS.length);
  });

  it("covers every drawing the tree asks for, and nothing it does not", () => {
    const wanted = new Set<string>();
    for (const node of DECISION_TREE) {
      wanted.add(node.help.illustrationId);
      for (const option of node.options) {
        if (option.illustrationId !== undefined) wanted.add(option.illustrationId);
      }
    }
    expect([...wanted].sort()).toEqual([...ILLUSTRATION_IDS].sort());
  });

  it("names a component that exists", () => {
    for (const [id, definition] of Object.entries(ILLUSTRATIONS)) {
      expect(ILLUSTRATION_COMPONENTS[definition.component], id).toBeTypeOf("function");
    }
  });

  it("starts every drawing as a placeholder, for W2-T4c to replace", () => {
    for (const [id, definition] of Object.entries(ILLUSTRATIONS)) {
      expect(definition.status, id).toBe("placeholder");
    }
  });

  it("recognises its own ids", () => {
    expect(isIllustrationId("ill-drive")).toBe(true);
    expect(isIllustrationId("ill-drivetrain-4x")).toBe(false);
  });

  it("catches a malformed id, a wrong alt key and a shared component", () => {
    const good: IllustrationDef = {
      component: "IllDrive",
      altKey: "illustrations.ill-drive.alt",
      aspect: "4/3",
      status: "placeholder",
    };
    expect(checkIllustrations({ "ill-drive": good })).toEqual([]);
    expect(
      checkIllustrations({ ill_drive: { ...good, altKey: "illustrations.ill_drive.alt" } }),
    ).toEqual(["ill_drive: not a well-formed illustration id"]);
    expect(
      checkIllustrations({ "ill-drive": { ...good, altKey: "illustrations.drive.alt" } }),
    ).toEqual(['ill-drive: altKey must be "illustrations.ill-drive.alt"']);
    expect(
      checkIllustrations({
        "ill-drive": good,
        "ill-speeds": { ...good, altKey: "illustrations.ill-speeds.alt" },
      }),
    ).toEqual(["ill-speeds: component IllDrive is already used by ill-drive"]);
    // …and the parser reports them as issues, not just the helper.
    expect(
      IllustrationRegistrySchema.safeParse({
        "ill-drive": { ...good, altKey: "illustrations.drive.alt" },
      }).success,
    ).toBe(false);
  });
});

// ── Message keys ─────────────────────────────────────────────────────────────

describe("every key the data emits resolves", () => {
  for (const locale of routing.locales) {
    it(`in messages/${locale}`, () => {
      const missing: string[] = [];
      const check = (key: string) => {
        const value = message(locale, key);
        if (typeof value !== "string" || value.trim() === "") missing.push(key);
      };

      for (const node of DECISION_TREE) {
        check(node.titleKey);
        check(node.help.textKey);
        for (const option of node.options) {
          check(option.labelKey);
          if (option.descriptionKey !== undefined) check(option.descriptionKey);
        }
      }
      for (const definition of Object.values(ILLUSTRATIONS)) check(definition.altKey);

      expect(missing).toEqual([]);
    });

    it(`with no stale copy left in messages/${locale}`, () => {
      const emitted = new Set<string>();
      for (const node of DECISION_TREE) {
        emitted.add(node.titleKey);
        emitted.add(node.help.textKey);
        for (const option of node.options) {
          emitted.add(option.labelKey);
          if (option.descriptionKey !== undefined) emitted.add(option.descriptionKey);
        }
      }
      const onDisk = flatten(CATALOGUES[locale].decision, "decision");
      expect(onDisk.filter((key) => !emitted.has(key))).toEqual([]);

      const alts = new Set(Object.values(ILLUSTRATIONS).map((entry) => entry.altKey));
      // illustrations.json is shared (Appendix A): the decision tree owns the `ill-*`
      // ids, guide illustrations (W1-T4, W2-T4a/b) add their own. Only the tree's
      // ids can go stale from here; guide ids are checked by content-check and
      // tests/ui/illustrations.test.tsx.
      const illustrationsOnDisk = flatten(CATALOGUES[locale].illustrations, "illustrations").filter(
        (key) => key.startsWith("illustrations.ill-"),
      );
      expect(illustrationsOnDisk.filter((key) => !alts.has(key))).toEqual([]);
    });
  }
});

// ── Presets ──────────────────────────────────────────────────────────────────

describe("the presets", () => {
  it("are seven, and parse as answers", () => {
    expect(PRESET_IDS).toHaveLength(7);
    for (const preset of PRESET_IDS) {
      const parsed = AnswersSchema.safeParse(BIKE_PRESETS[preset]);
      expect(parsed.success ? [] : parsed.error.issues, preset).toEqual([]);
    }
  });

  it("only answer questions the tree actually asks, with options it offers", () => {
    for (const preset of PRESET_IDS) {
      for (const [question, option] of Object.entries(BIKE_PRESETS[preset])) {
        const node = nodeFor(question as QuestionId);
        expect(
          node.options.map((entry) => entry.id),
          `${preset}.${question}`,
        ).toContain(option);
      }
    }
  });
});

// ── Conventions ──────────────────────────────────────────────────────────────

describe("conventions", () => {
  it("puts the front brake on the left lever (French convention)", () => {
    expect(BRAKE_SIDE).toEqual({ front: "left", rear: "right" });
  });

  it("accepts kebab-case ids and nothing else", () => {
    expect(isId("brake-caliper-front")).toBe(true);
    expect(isId("700c")).toBe(true);
    expect(isId("brake.caliper")).toBe(false);
    expect(isId("BrakeCaliper")).toBe(false);
    expect(isId("brake_caliper")).toBe(false);
  });

  it("expands a paired template into its front and rear instances", () => {
    const [front, rear] = pairFrontRear({
      id: "rotor-hub-interface",
      appliesTo: ["rotor-{side}", "wheel-{side}"],
      check: { kind: "equal", a: "rotor-{side}.interface", b: "wheel-{side}.hub-interface" },
      severity: "error",
      margin: 2,
      optional: false,
      nothing: null,
    });

    expect(front).toEqual({
      id: "rotor-hub-interface-front",
      appliesTo: ["rotor-front", "wheel-front"],
      check: { kind: "equal", a: "rotor-front.interface", b: "wheel-front.hub-interface" },
      severity: "error",
      margin: 2,
      optional: false,
      nothing: null,
    });
    expect(rear.id).toBe("rotor-hub-interface-rear");
    expect(rear.appliesTo).toEqual(["rotor-rear", "wheel-rear"]);
  });
});

// ── Parts ────────────────────────────────────────────────────────────────────

const attribute = (overrides: Partial<AttributeDef<string>> = {}): AttributeDef<string> => ({
  key: "speeds",
  kind: "enum",
  values: ["10", "11"],
  editable: true,
  default: { fallback: "11", when: [] },
  labelKey: "parts.attr.speeds.label",
  ...overrides,
});

const part = (overrides: Partial<PartDefinition<string>> = {}): PartDefinition<string> => ({
  id: "chain",
  system: "drivetrain",
  labelKey: "parts.chain.label",
  descriptionKey: "parts.chain.description",
  optional: false,
  position: "none",
  meshId: "chain",
  attributes: [attribute()],
  procedures: { check: ["check-drivetrain"] },
  checkupPriority: 10,
  wearItem: true,
  ...overrides,
});

describe("the part contract", () => {
  it("accepts a well-formed catalogue", () => {
    const catalogue = [
      part(),
      part({
        id: "brake-caliper-front",
        system: "brakes",
        position: "front",
        meshId: "caliper-f",
        labelKey: "parts.brake-caliper-front.label",
        descriptionKey: "parts.brake-caliper-front.description",
        attributes: [],
        procedures: {},
      }),
      part({
        id: "brake-pads-front",
        system: "brakes",
        position: "front",
        meshId: null,
        hostPartId: "brake-caliper-front",
        labelKey: "parts.brake-pads-front.label",
        descriptionKey: "parts.brake-pads-front.description",
        attributes: [],
        procedures: {},
      }),
    ];
    expect(checkPartCatalog(catalogue)).toEqual([]);
    expect(PartCatalogSchema.safeParse(catalogue).success).toBe(true);
  });

  it("rejects an unknown field or a malformed id", () => {
    expect(PartCatalogSchema.safeParse([{ ...part(), colour: "red" }]).success).toBe(false);
    expect(PartCatalogSchema.safeParse([part({ id: "Chain" })]).success).toBe(false);
  });

  it("catches catalogue-level mistakes", () => {
    expect(checkPartCatalog([part(), part()])).toContain("chain: duplicate part id");
    expect(checkPartCatalog([part({ labelKey: "parts.chain.name" })])).toContain(
      'chain: labelKey must be "parts.chain.label"',
    );
    expect(checkPartCatalog([part({ descriptionKey: "parts.chain.about" })])).toContain(
      'chain: descriptionKey must be "parts.chain.description"',
    );
    // Exactly one of meshId / hostPartId: neither…
    expect(checkPartCatalog([part({ meshId: null })])).toContain(
      "chain: set exactly one of meshId and hostPartId",
    );
    // …and not both.
    expect(checkPartCatalog([part({ hostPartId: "crankset" })])).toContain(
      "chain: set exactly one of meshId and hostPartId",
    );
    expect(
      checkPartCatalog([
        part(),
        part({
          id: "belt",
          labelKey: "parts.belt.label",
          descriptionKey: "parts.belt.description",
        }),
      ]),
    ).toContain('belt: meshId "chain" is already used by chain');
    expect(
      checkPartCatalog([
        part({
          id: "tube-front",
          meshId: null,
          hostPartId: "tire-front",
          labelKey: "parts.tube-front.label",
          descriptionKey: "parts.tube-front.description",
        }),
      ]),
    ).toContain('tube-front: hostPartId "tire-front" is not a part');
    expect(
      checkPartCatalog([
        part({
          id: "sealant",
          meshId: null,
          hostPartId: "tube-rear",
          labelKey: "parts.sealant.label",
          descriptionKey: "parts.sealant.description",
        }),
        part({
          id: "tube-rear",
          meshId: null,
          hostPartId: "chain",
          labelKey: "parts.tube-rear.label",
          descriptionKey: "parts.tube-rear.description",
        }),
      ]),
    ).toContain('sealant: host "tube-rear" has no mesh of its own');
    expect(checkPartCatalog([part({ attributes: [attribute(), attribute()] })])).toContain(
      "chain.speeds: duplicate attribute key",
    );
  });

  it("catches attribute-level mistakes", () => {
    const check = (overrides: Partial<AttributeDef<string>>) =>
      checkPartCatalog([part({ attributes: [attribute(overrides)] })]);

    expect(check({ labelKey: "parts.speeds.label" })).toContain(
      'chain.speeds: labelKey must be "parts.attr.speeds.label"',
    );
    expect(check({ helpKey: "parts.speeds.help" })).toContain(
      'chain.speeds: helpKey must be "parts.attr.speeds.help"',
    );
    expect(check({ helpKey: "parts.attr.speeds.help" })).toEqual([]);
    expect(check({ values: ["11"] })).toContain(
      "chain.speeds: an enum attribute needs at least two values",
    );
    expect(
      check({ kind: "enum", values: undefined, default: { fallback: null, when: [] } }),
    ).toContain("chain.speeds: an enum attribute needs at least two values");
    expect(
      check({ kind: "text", values: ["a", "b"], default: { fallback: "a", when: [] } }),
    ).toContain("chain.speeds: only an enum attribute carries values");
    expect(
      check({ kind: "text", values: undefined, min: 1, default: { fallback: "a", when: [] } }),
    ).toContain("chain.speeds: only a number attribute carries min/max");
    expect(
      check({
        kind: "number",
        values: undefined,
        min: 1,
        max: 3,
        default: { fallback: 2, when: [] },
      }),
    ).toEqual([]);
    expect(
      check({ kind: "number", values: undefined, default: { fallback: "eleven", when: [] } }),
    ).toContain('chain.speeds: default fallback does not match kind "number"');
    expect(
      check({ kind: "boolean", values: undefined, default: { fallback: true, when: [] } }),
    ).toEqual([]);
    expect(
      check({ kind: "boolean", values: undefined, default: { fallback: 1, when: [] } }),
    ).toContain('chain.speeds: default fallback does not match kind "boolean"');
    expect(check({ default: { fallback: null, when: [] }, values: ["10", "11"] })).toEqual([]);
    expect(
      check({
        default: {
          fallback: "11",
          when: [{ when: { path: "drivetrain.speeds", in: [12] }, value: true }],
        },
      }),
    ).toContain('chain.speeds: conditional default does not match kind "enum"');
    expect(check({ default: { fallback: "12", when: [] } })).toContain(
      'chain.speeds: default "12" is not one of the values',
    );
    expect(
      check({
        default: {
          fallback: "11",
          when: [{ when: { path: "drivetrain.speeds", in: [12] }, value: "12" }],
        },
      }),
    ).toContain('chain.speeds: default "12" is not one of the values');
  });
});

// ── Rules ────────────────────────────────────────────────────────────────────

const rule = (overrides: Partial<CompatibilityRule<string>> = {}): CompatibilityRule<string> => ({
  id: "chain-cassette-speeds",
  severity: "error",
  appliesTo: ["chain", "cassette"],
  check: {
    kind: "allowed",
    a: "chain.speeds",
    b: "cassette.speeds",
    table: { "6-7-8": [6, 7, 8] },
  },
  messageKey: "rules.chain-cassette-speeds.message",
  fixHintKey: "rules.chain-cassette-speeds.fix",
  ...overrides,
});

describe("the compatibility-rule contract", () => {
  it("accepts each of the five checks", () => {
    const checks = [
      { kind: "equal", a: "rotor-front.interface", b: "wheel-front.hub-interface" },
      { kind: "allowed", a: "chain.speeds", b: "cassette.speeds", table: { "9": [9] } },
      { kind: "lte", a: "rotor-front.diameter", b: "frame.max-rotor", margin: 0 },
      {
        kind: "range",
        a: "wheel-front.rim-width",
        b: "tire-front.width",
        table: { "19": [28, 40] },
      },
      { kind: "flag", a: "frame.belt-splitter", mustBe: true },
    ];
    for (const check of checks) {
      expect(RuleCheckSchema.safeParse(check).success, JSON.stringify(check)).toBe(true);
      expect(CompatibilityRuleSchema.safeParse(rule({ check: check as never })).success).toBe(true);
    }
    expect(checkRuleCatalog([rule()])).toEqual([]);
  });

  it("keeps message keys under their own namespace", () => {
    expect(CompatibilityRuleSchema.safeParse(rule({ messageKey: "errors.chain" })).success).toBe(
      false,
    );
    expect(
      CompatibilityRuleSchema.safeParse(rule({ fixHintKey: "rules.chain.hint" })).success,
    ).toBe(false);
  });

  it("rejects an attribute reference that is not <partId>.<attribute>", () => {
    expect(
      RuleCheckSchema.safeParse({ kind: "equal", a: "chain", b: "cassette.speeds" }).success,
    ).toBe(false);
    // …but accepts the {side} placeholder a paired template uses.
    expect(
      RuleCheckSchema.safeParse({
        kind: "equal",
        a: "rotor-{side}.interface",
        b: "wheel-{side}.hub-interface",
      }).success,
    ).toBe(true);
  });

  it("catches a duplicate id and an inverted range", () => {
    expect(checkRuleCatalog([rule(), rule()])).toEqual([
      "chain-cassette-speeds: duplicate rule id",
    ]);
    expect(RuleCatalogSchema.safeParse([rule(), rule()]).success).toBe(false);
    expect(RuleCatalogSchema.safeParse([rule()]).success).toBe(true);
    // A range the right way round passes, so the check is not simply always failing.
    expect(
      checkRuleCatalog([
        rule({
          check: {
            kind: "range",
            a: "wheel-front.rim-width",
            b: "tire-front.width",
            table: { "19": [28, 40], "21": [32, 50] },
          },
        }),
      ]),
    ).toEqual([]);
    expect(
      checkRuleCatalog([
        rule({
          check: {
            kind: "range",
            a: "wheel-front.rim-width",
            b: "tire-front.width",
            table: { "19": [40, 28] },
          },
        }),
      ]),
    ).toEqual(['chain-cassette-speeds: range for "19" is inverted']);
  });
});

// ── Procedures ───────────────────────────────────────────────────────────────

const procedure = (overrides: Partial<ProcedureMeta<string>> = {}): ProcedureMeta<string> => ({
  slug: "check-brakes-disc",
  kind: "check",
  partIds: ["brake-caliper-front", "brake-pads-front"],
  tools: [{ toolId: "allen-5", alternatives: ["multi-tool"] }],
  difficulty: 2,
  minutes: 20,
  steps: [
    {
      id: "pad-wear",
      title: "Épaisseur des plaquettes",
      partIds: ["brake-pads-front"],
      checkQuestion: {
        prompt: "Reste-t-il plus d’un millimètre de garniture ?",
        ko: [
          {
            action: "replace",
            partId: "brake-pads-front",
            reasonKey: "pad-wear",
            guideSlug: "replace-brake-pads-disc",
          },
        ],
        skippable: false,
      },
    },
  ],
  ...overrides,
});

describe("the procedure contract", () => {
  it("accepts a well-formed check guide", () => {
    const parsed = ProcedureMetaSchema.safeParse(procedure());
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).toEqual([]);
    expect(checkProcedure(procedure())).toEqual([]);
  });

  it("requires a guide for every consequence except inspect-shop", () => {
    expect(
      KoConsequenceSchema.safeParse({
        action: "replace",
        partId: "chain",
        reasonKey: "chain-wear",
      }).success,
    ).toBe(false);
    expect(
      KoConsequenceSchema.safeParse({
        action: "inspect-shop",
        partId: "wheel-front",
        reasonKey: "wheel-out-of-true",
      }).success,
    ).toBe(true);
  });

  it("maps a consequence to the kind of guide that handles it", () => {
    expect(guideKindFor("fix")).toBe("adjust");
    expect(guideKindFor("replace")).toBe("replace");
    expect(guideKindFor("clean")).toBe("clean");
    expect(guideKindFor("inspect-shop")).toBeNull();
  });

  it("catches a duplicate step, a foreign part and a question on a non-check guide", () => {
    const duplicated = procedure({ steps: [procedure().steps[0], procedure().steps[0]] });
    expect(checkProcedure(duplicated)).toContain("check-brakes-disc#pad-wear: duplicate step id");
    expect(ProcedureMetaSchema.safeParse(duplicated).success).toBe(false);

    const foreign = procedure({
      steps: [{ id: "rotor", title: "Disque", partIds: ["rotor-front"] }],
    });
    expect(checkProcedure(foreign)).toContain(
      'check-brakes-disc#rotor: "rotor-front" is not one of the guide\'s partIds',
    );

    const replacing = procedure({ kind: "replace", slug: "replace-brake-pads-disc" });
    expect(checkProcedure(replacing)).toContain(
      'replace-brake-pads-disc#pad-wear: only a "check" guide carries a checkQuestion',
    );

    const stepWithoutParts = procedure({ steps: [{ id: "intro", title: "Avant de commencer" }] });
    expect(checkProcedure(stepWithoutParts)).toEqual([]);
  });

  it("describes a tool and what can stand in for it", () => {
    expect(
      ToolDefSchema.safeParse({
        id: "chain-checker",
        labelKey: "tools.chain-checker.label",
        alternatives: ["steel-ruler"],
      }).success,
    ).toBe(true);
    expect(
      ToolDefSchema.safeParse({ id: "chain checker", labelKey: "x", alternatives: [] }).success,
    ).toBe(false);
  });
});

// ── Retailers ────────────────────────────────────────────────────────────────

describe("the retailer contract", () => {
  const retailer: RetailerDef = {
    id: "rosebikes",
    labelKey: "parts.retailers.rosebikes",
    byLocale: {
      fr: { kind: "search", template: "https://www.rosebikes.fr/search?q={q}" },
      en: { kind: "search", template: "https://www.rosebikes.com/search?q={q}" },
    },
    verifiedAt: "2026-09-07",
  };

  it("covers the same locales the site runs in", () => {
    expect([...RETAILER_LOCALES]).toEqual([...routing.locales]);
  });

  it("accepts a verified search retailer and a category one", () => {
    expect(RetailerDefSchema.safeParse(retailer).success).toBe(true);
    expect(
      RetailerDefSchema.safeParse({
        ...retailer,
        id: "alltricks",
        labelKey: "parts.retailers.alltricks",
        verifiedAt: null,
        byLocale: {
          fr: {
            kind: "category",
            byPartId: { chain: "https://www.alltricks.fr/C-chaines" },
            fallback: "https://www.alltricks.fr/",
          },
          en: { kind: "category", byPartId: {}, fallback: "https://www.alltricks.com/" },
        },
      }).success,
    ).toBe(true);
  });

  it("refuses http, a missing locale and a template without exactly one {q}", () => {
    const withTemplate = (template: string) =>
      RetailerDefSchema.safeParse({
        ...retailer,
        byLocale: { ...retailer.byLocale, fr: { kind: "search", template } },
      }).success;

    expect(withTemplate("http://www.rosebikes.fr/search?q={q}")).toBe(false);
    expect(withTemplate("https://www.rosebikes.fr/search")).toBe(false);
    expect(withTemplate("https://www.rosebikes.fr/search?q={q}&alt={q}")).toBe(false);
    expect(
      RetailerDefSchema.safeParse({ ...retailer, byLocale: { fr: retailer.byLocale.fr } }).success,
    ).toBe(false);
    expect(RetailerDefSchema.safeParse({ ...retailer, verifiedAt: "7 sept. 2026" }).success).toBe(
      false,
    );
  });

  it("builds a URL by substituting the encoded query, or picking a category", () => {
    expect(buildSearchUrl(retailer.byLocale.fr, "chaîne 11 vitesses")).toBe(
      "https://www.rosebikes.fr/search?q=cha%C3%AEne%2011%20vitesses",
    );
    const category = {
      kind: "category",
      byPartId: { chain: "https://www.alltricks.fr/C-chaines" },
      fallback: "https://www.alltricks.fr/",
    } as const;
    expect(buildSearchUrl(category, "chaîne", "chain")).toBe("https://www.alltricks.fr/C-chaines");
    expect(buildSearchUrl(category, "chaîne", "cassette")).toBe("https://www.alltricks.fr/");
    expect(buildSearchUrl(category, "chaîne")).toBe("https://www.alltricks.fr/");
  });
});

// ── Answers ──────────────────────────────────────────────────────────────────

describe("AnswersSchema", () => {
  it("takes a partial map of question id → option id", () => {
    expect(AnswersSchema.safeParse({ drive: "electric" }).success).toBe(true);
    expect(AnswersSchema.safeParse({}).success).toBe(true);
    expect(AnswersSchema.safeParse({ drive: "Electric" }).success).toBe(false);
    expect(AnswersSchema.safeParse({ frame: "steel" }).success).toBe(false);
    expect(AnswersSchema.safeParse({ drive: "x".repeat(33) }).success).toBe(false);
  });
});
