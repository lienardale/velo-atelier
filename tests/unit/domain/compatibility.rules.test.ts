/**
 * Compatibility rules (§2.4): the catalogue, every rule proven both ways, the
 * engine's skip semantics, and the ≈70-build invariant.
 *
 *   1. `CASES: Record<RuleId, Case>` — one passing and one failing build per
 *      rule. A rule added to `RULE_IDS` without a case is a `tsc` error here.
 *   2. The invariant — no default bike the decision tree can produce has an
 *      error: the 10 root combinations, every single deviation from them (each
 *      visible option of each visible question), the 7 presets, and a
 *      fast-check walk over arbitrary answers.
 *   3. Semantics: `when` false and absent parts do not apply, unset attributes
 *      skip and are reported by `missingAttributes`, a table without the key
 *      skips, `ok` ignores warnings.
 */
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename -- offsets into our own fixtures and catalogue; fixed paths under messages/ */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DECISION_TREE, QUESTION_IDS } from "@/lib/domain/data/decision-tree";
import { partDefinition, PART_IDS } from "@/lib/domain/data/parts";
import { BIKE_PRESETS, PRESET_IDS } from "@/lib/domain/data/presets";
import { RULE_IDS, RULE_MESSAGE_GROUPS, RULES, type RuleId } from "@/lib/domain/data/rules";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import {
  checkBuild,
  checkCompatibility,
  compareValues,
  missingAttributes,
  parseRef,
  refsOf,
  ruleStatus,
  ruleTouches,
  withCandidate,
} from "@/lib/domain/engine/compatibility";
import {
  answerWithDefaults,
  isNodeVisible,
  pruneAnswers,
  visibleOptions,
} from "@/lib/domain/engine/decision";
import { buildForSpec, findPart } from "@/lib/domain/engine/parts-for-spec";
import type { Answers } from "@/lib/domain/schema/decision";
import type { AttributeValue, BikeBuild } from "@/lib/domain/schema/part";
import { RuleCatalogSchema, type RuleCheck } from "@/lib/domain/schema/rule";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const buildOf = (answers: Answers): BikeBuild =>
  buildForSpec(buildBikeSpec(answerWithDefaults(answers)));

/** A copy of `build` with `<partId>.<attr>` values overwritten. */
function withValues(build: BikeBuild, values: Record<string, AttributeValue>): BikeBuild {
  const copy = structuredClone(build);
  for (const [ref, value] of Object.entries(values)) {
    const { partId, key } = parseRef(ref);
    const part = findPart(copy, partId);
    if (part === undefined) throw new Error(`fixture: ${partId} is not on this bike`);
    part.attributes[key] = value;
  }
  return copy;
}

const errorsOf = (build: BikeBuild) =>
  checkBuild(build).issues.filter((issue) => issue.severity === "error");

/** Ten starting points — the same as `build-bike-spec.snapshot.test.ts`. */
const ROOT_COMBOS: Record<string, Answers> = {
  "nothing answered": {},
  electric: { drive: "electric" },
  road: { discipline: "road" },
  gravel: { discipline: "gravel" },
  mtb: { discipline: "mtb" },
  "city-hybrid": { discipline: "city-hybrid" },
  kids: { discipline: "kids" },
  singlespeed: { drivetrain: "singlespeed" },
  "hub gears with a belt": { drivetrain: "igh", transmission: "belt" },
  "electric mtb": { drive: "electric", discipline: "mtb" },
};

const ROAD_RIM = BIKE_PRESETS["road-rim-2x11"];
const ROAD_DISC = BIKE_PRESETS["road-disc-2x12"];
const MTB_HARDTAIL = BIKE_PRESETS["mtb-hardtail-1x12"];
const CITY_E = BIKE_PRESETS["city-igh-8-hub-motor"];
const EMTB = BIKE_PRESETS["emtb-mid-1x12"];
const SEVEN_SPEED: Answers = { drivetrain: "derailleur-1x", speeds: "7" };
const TEN_SPEED: Answers = { drivetrain: "derailleur-1x", speeds: "10" };

interface Case {
  answers: Answers;
  pass: Record<string, AttributeValue>;
  fail: Record<string, AttributeValue>;
}

const CASES: Record<RuleId, Case> = {
  "chain-cassette-speeds": {
    answers: ROAD_RIM,
    pass: { "chain.speeds": 11 },
    fail: { "chain.speeds": 10 },
  },
  "chain-freewheel-speeds": {
    answers: SEVEN_SPEED,
    pass: { "chain.speeds": "6-7-8" },
    fail: { "chain.speeds": 11 },
  },
  "derailleur-cassette-speeds": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "rear-derailleur.speeds": 10 },
  },
  "shifter-derailleur-speeds": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "shifter-right.speeds": 10 },
  },
  "shifter-hub-speeds": {
    answers: CITY_E,
    pass: {},
    fail: { "internal-gear-hub.speeds": 11 },
  },
  "shifter-derailleur-brand": {
    answers: TEN_SPEED,
    pass: { "shifter-right.brand": "microshift", "rear-derailleur.brand": "shimano" },
    fail: { "shifter-right.brand": "sram" },
  },
  "shifter-derailleur-brand-11-plus": {
    answers: ROAD_RIM,
    pass: { "shifter-right.brand": "sram", "rear-derailleur.brand": "sram" },
    fail: { "shifter-right.brand": "microshift" },
  },
  "shifter-derailleur-actuation": {
    answers: ROAD_RIM,
    pass: { "shifter-right.actuation": "electronic", "rear-derailleur.actuation": "electronic" },
    fail: { "shifter-right.actuation": "electronic" },
  },
  "front-shifter-chainrings": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "shifter-left.positions": 3 },
  },
  "derailleur-max-cog": {
    answers: MTB_HARDTAIL,
    pass: { "cassette.largest-cog": 52 },
    fail: { "cassette.largest-cog": 55 },
  },
  "cassette-freehub": {
    answers: ROAD_RIM,
    pass: { "cassette.freehub": "hg", "wheel-rear.freehub": "hg-l" },
    fail: { "wheel-rear.freehub": "xd" },
  },
  "cassette-speeds-freehub": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "wheel-rear.freehub": "micro-spline" },
  },
  "freewheel-body": {
    answers: SEVEN_SPEED,
    pass: {},
    fail: { "wheel-rear.freehub": "hg" },
  },
  "hanger-standard": {
    answers: MTB_HARDTAIL,
    pass: { "rear-derailleur.hanger-standard": "classic" },
    fail: { "frame.hanger-standard": "classic" },
  },
  "caliper-rotor-size-front": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "rotor-front.diameter": 140 },
  },
  "caliper-rotor-size-rear": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "rotor-rear.diameter": 140 },
  },
  "rotor-caliper-mount-front": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "rotor-front.diameter": 203, "brake-caliper-front.rotor-size": 203 },
  },
  "rotor-caliper-mount-rear": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "rotor-rear.diameter": 180, "brake-caliper-rear.rotor-size": 180 },
  },
  "rotor-frame-max": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "rotor-rear.diameter": 180 },
  },
  "rotor-fork-max": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "rotor-front.diameter": 180 },
  },
  "rotor-hub-interface-front": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "rotor-front.interface": "6-bolt" },
  },
  "rotor-hub-interface-rear": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "wheel-rear.rotor-interface": "6-bolt" },
  },
  "caliper-frame-mount": {
    answers: ROAD_DISC,
    pass: { "frame.brake-mount": "is-mount", "brake-caliper-rear.mount": "post-mount" },
    fail: { "brake-caliper-rear.mount": "post-mount" },
  },
  "caliper-fork-mount": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "brake-caliper-front.mount": "post-mount" },
  },
  "lever-caliper-actuation-front": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "brake-lever-front.actuation": "mechanical" },
  },
  "lever-caliper-actuation-rear": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "brake-caliper-rear.actuation": "mechanical" },
  },
  "lever-pull-ratio-front": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "brake-lever-front.pull": "long-v-brake" },
  },
  "lever-pull-ratio-rear": {
    answers: { "brake-type": "v-brake" },
    pass: {},
    fail: { "brake-lever-rear.pull": "short-road" },
  },
  "mech-disc-lever-pull-front": {
    answers: { "brake-type": "disc-mechanical" },
    pass: {},
    fail: { "brake-lever-front.pull": "short-road" },
  },
  "mech-disc-lever-pull-rear": {
    answers: { "brake-type": "disc-mechanical", cockpit: "drop" },
    pass: {},
    fail: { "brake-caliper-rear.pull": "long-v-brake" },
  },
  "wheel-axle-frame": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "wheel-rear.axle": "ta-12x142" },
  },
  "wheel-axle-fork": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "wheel-front.axle": "ta-12x100" },
  },
  "tire-diameter-wheel-front": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "tire-front.etrto-diameter": 584 },
  },
  "tire-diameter-wheel-rear": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "wheel-rear.etrto-diameter": 559 },
  },
  "tire-rim-width-front": {
    answers: ROAD_RIM,
    pass: { "tire-front.etrto-width": 32 },
    fail: { "tire-front.etrto-width": 25 },
  },
  "tire-rim-width-rear": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "wheel-rear.rim-width": 30 },
  },
  "tubeless-rim-tire-front": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "wheel-front.tubeless-ready": false },
  },
  "tubeless-rim-tire-rear": {
    answers: ROAD_DISC,
    pass: {},
    fail: { "wheel-rear.tubeless-ready": false },
  },
  "tire-frame-clearance": {
    answers: ROAD_RIM,
    pass: { "tire-rear.etrto-width": 32 },
    fail: { "tire-rear.etrto-width": 35 },
  },
  "tire-fork-clearance": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "fork.max-tire-width": 25 },
  },
  "headset-frame": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "headset.head-tube": "threaded-1" },
  },
  "stem-steerer": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "stem.steerer-clamp": "quill-22-2" },
  },
  "stem-bar-clamp": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "stem.bar-clamp": 35 },
  },
  "seatpost-frame-diameter": {
    answers: ROAD_RIM,
    pass: { "frame.seatpost-diameter": 31.6, "seatpost.seatpost-diameter": 27.2 },
    fail: { "frame.seatpost-diameter": 27.2, "seatpost.seatpost-diameter": 31.6 },
  },
  "seatpost-frame-shim": {
    answers: ROAD_RIM,
    pass: { "frame.seatpost-diameter": 27.2, "seatpost.seatpost-diameter": 27.2 },
    fail: { "frame.seatpost-diameter": 31.6, "seatpost.seatpost-diameter": 27.2 },
  },
  "seat-clamp-frame": {
    answers: ROAD_RIM,
    pass: { "frame.seat-clamp-diameter": 34.9, "seat-clamp.seat-clamp-diameter": 34.9 },
    fail: { "frame.seat-clamp-diameter": 34.9, "seat-clamp.seat-clamp-diameter": 31.8 },
  },
  "bb-shell-frame": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "bottom-bracket.bb-shell": "bsa-68" },
  },
  "bb-spindle-crank": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "bottom-bracket.spindle": "dub-28-99" },
  },
  "pedal-thread-crank-left": {
    answers: ROAD_RIM,
    pass: {},
    fail: { "pedal-left.pedal-thread": "1-2" },
  },
  "pedal-thread-crank-right": {
    answers: ROAD_RIM,
    pass: { "crankset.pedal-thread": "1-2", "pedal-right.pedal-thread": "1-2" },
    fail: { "crankset.pedal-thread": "1-2" },
  },
  "belt-frame-splitter": {
    answers: { drivetrain: "igh", transmission: "belt" },
    pass: {},
    fail: { "frame.belt-splitter": false },
  },
  "e-chain-rated": {
    answers: CITY_E,
    pass: {},
    fail: { "chain.e-rated": false },
  },
  "e-crank-interface": {
    answers: EMTB,
    pass: {},
    fail: { "crankset.spindle": "dub-28-99" },
  },
};

// ── The catalogue ────────────────────────────────────────────────────────────

const catalogue = (locale: string): Record<string, { message?: unknown; fix?: unknown }> =>
  JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "rules.json"), "utf8"));

describe("the rule catalogue", () => {
  it("is exactly RULE_IDS, in order, and parses", () => {
    expect(RULES.map((rule) => rule.id)).toEqual([...RULE_IDS]);
    const parsed = RuleCatalogSchema.safeParse(RULES);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it("has a pass and a fail case for every rule", () => {
    expect(Object.keys(CASES).sort()).toEqual([...RULE_IDS].sort());
  });

  it("reads real attributes of real parts, and names them in appliesTo", () => {
    for (const rule of RULES) {
      for (const ref of refsOf(rule.check)) {
        const definition = partDefinition(ref.partId);
        expect(definition, `${rule.id}: ${ref.partId}`).toBeDefined();
        const attribute = definition!.attributes.find((entry) => entry.key === ref.key);
        expect(attribute, `${rule.id}: ${ref.partId}.${ref.key}`).toBeDefined();
        expect(rule.appliesTo, rule.id).toContain(ref.partId);
        if (rule.check.kind === "flag") expect(attribute!.kind, rule.id).toBe("boolean");
        if (rule.check.kind === "lte") {
          const numeric =
            attribute!.kind === "number" ||
            attribute!.values!.every((value) => typeof value === "number");
          expect(numeric, rule.id).toBe(true);
        }
      }
      for (const partId of rule.appliesTo) expect(PART_IDS, rule.id).toContain(partId);
    }
  });

  it("keys its tables by values the left-hand attribute can take", () => {
    for (const rule of RULES) {
      const check = rule.check;
      if (check.kind !== "allowed" && check.kind !== "range") continue;
      const { partId, key } = parseRef(check.a);
      const values = partDefinition(partId)!
        .attributes.find((entry) => entry.key === key)!
        .values!.map(String);
      for (const tableKey of Object.keys(check.table)) {
        expect(values, `${rule.id}: table key "${tableKey}"`).toContain(tableKey);
      }
    }
  });

  for (const locale of ["fr", "en"]) {
    it(`has a message and a fix in messages/${locale}/rules.json, and nothing stale`, () => {
      const messages = catalogue(locale);
      for (const rule of RULES) {
        const [, group, leaf] = rule.messageKey.split(".");
        expect(leaf).toBe("message");
        expect(typeof messages[group]?.message, rule.messageKey).toBe("string");
        expect(rule.fixHintKey, rule.id).toBe(`rules.${group}.fix`);
        expect(typeof messages[group]?.fix, `${rule.id} fix`).toBe("string");
      }
      expect(Object.keys(messages).sort()).toEqual([...RULE_MESSAGE_GROUPS].sort());
    });
  }
});

// ── Every rule, both ways ────────────────────────────────────────────────────

describe("each rule", () => {
  for (const rule of RULES) {
    it(`${rule.id} passes and fails where it should`, () => {
      const testCase = CASES[rule.id];
      const base = buildOf(testCase.answers);

      const passing = withValues(base, testCase.pass);
      expect(ruleStatus(rule, passing)).toBe("pass");
      expect(checkBuild(passing).issues.map((issue) => issue.ruleId)).not.toContain(rule.id);

      const failing = withValues(base, testCase.fail);
      expect(ruleStatus(rule, failing)).toBe("fail");
      const issue = checkBuild(failing).issues.find((entry) => entry.ruleId === rule.id);
      expect(issue).toMatchObject({
        ruleId: rule.id,
        severity: rule.severity,
        partIds: rule.appliesTo,
        messageKey: rule.messageKey,
        fixHintKey: rule.fixHintKey,
      });
      expect(issue!.values).toHaveLength(refsOf(rule.check).length);
    });
  }
});

// ── The invariant ────────────────────────────────────────────────────────────

/** Every single deviation from `root`: each visible option of each visible question. */
function deviations(root: Answers): Answers[] {
  const complete = answerWithDefaults(root);
  const variants: Answers[] = [];
  for (const node of DECISION_TREE) {
    if (!isNodeVisible(node, complete)) continue;
    const before = pruneAnswers(
      Object.fromEntries(
        Object.entries(complete).filter(([question]) => {
          const order = DECISION_TREE.find((entry) => entry.id === question)!.order;
          return order < node.order;
        }),
      ) as Answers,
    );
    for (const option of visibleOptions(node, before)) {
      variants.push({ ...complete, [node.id]: option.id });
    }
  }
  return variants;
}

describe("the default build of every bike the tree produces", () => {
  it("has no error on the 10 root combinations", () => {
    for (const [name, answers] of Object.entries(ROOT_COMBOS)) {
      expect(errorsOf(buildOf(answers)), name).toEqual([]);
    }
  });

  it("has no error on any single deviation from them", () => {
    let count = 0;
    for (const [name, root] of Object.entries(ROOT_COMBOS)) {
      for (const answers of deviations(root)) {
        count++;
        expect(errorsOf(buildOf(answers)), `${name} + ${JSON.stringify(answers)}`).toEqual([]);
      }
    }
    // ≈ 70 per the plan: at least one variant per visible option of every root.
    expect(count).toBeGreaterThanOrEqual(70);
  });

  it("has no error on the seven presets", () => {
    for (const preset of PRESET_IDS) {
      expect(errorsOf(buildOf(BIKE_PRESETS[preset])), preset).toEqual([]);
    }
  });

  it("has no error whatever the visitor answers", () => {
    const optionIds = [...new Set(DECISION_TREE.flatMap((node) => node.options.map((o) => o.id)))];
    const answers = fc.dictionary(
      fc.constantFrom(...QUESTION_IDS),
      fc.constantFrom(...optionIds),
    ) as unknown as fc.Arbitrary<Answers>;
    fc.assert(
      fc.property(answers, (start) => {
        expect(errorsOf(buildOf(start))).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });
});

// ── Semantics ────────────────────────────────────────────────────────────────

const byId = (id: RuleId) => RULES.find((rule) => rule.id === id)!;

describe("the engine", () => {
  it("does not apply a rule whose condition is false for the bike", () => {
    expect(ruleStatus(byId("rotor-frame-max"), buildOf(ROAD_RIM))).toBe("not-applicable");
  });

  it("does not apply a rule about a part the bike does not have", () => {
    expect(ruleStatus(byId("chain-cassette-speeds"), buildOf(CITY_E))).toBe("not-applicable");
  });

  it("skips a rule when an attribute is unset, and says which", () => {
    const build = buildOf(ROAD_RIM);
    expect(ruleStatus(byId("seatpost-frame-diameter"), build)).toBe("missing");
    const seatpost = findPart(build, "seatpost")!;
    expect(missingAttributes(build, seatpost)).toEqual([
      { part: "seatpost", attr: "seatpost-diameter", askedBecause: "seatpost-frame-diameter" },
      { part: "frame", attr: "seatpost-diameter", askedBecause: "seatpost-frame-diameter" },
    ]);
    // Once measured, nothing is missing any more.
    const measured = withValues(build, {
      "frame.seatpost-diameter": 27.2,
      "seatpost.seatpost-diameter": 27.2,
    });
    expect(missingAttributes(measured, findPart(measured, "seatpost")!)).toEqual([]);
  });

  it("skips a table rule whose table has no entry for the value", () => {
    const build = withValues(buildOf(ROAD_RIM), { "wheel-rear.freehub": "igh" });
    expect(ruleStatus(byId("cassette-speeds-freehub"), build)).toBe("skipped");
    expect(ruleStatus(byId("cassette-freehub"), build)).toBe("fail");
  });

  it("is ok with warnings, and not ok with an error", () => {
    const warned = withValues(buildOf(MTB_HARDTAIL), { "cassette.largest-cog": 55 });
    expect(checkBuild(warned)).toMatchObject({ ok: true, issues: [{ severity: "warning" }] });
    const broken = withValues(buildOf(ROAD_RIM), { "stem.bar-clamp": 35 });
    expect(checkBuild(broken).ok).toBe(false);
  });

  it("checks a candidate in place of the fitted part, only against its own rules", () => {
    const build = buildOf(ROAD_RIM);
    const narrowChain = { partId: "chain", attributes: { speeds: 10, "e-rated": false } };
    const report = checkCompatibility(build, narrowChain);
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.ruleId)).toEqual(["chain-cassette-speeds"]);
    expect(RULES.filter((rule) => ruleTouches(rule, "chain")).map((rule) => rule.id)).toEqual([
      "chain-cassette-speeds",
      "chain-freewheel-speeds",
      "e-chain-rated",
    ]);
  });

  it("checks a candidate the bike does not have yet by adding it", () => {
    const build = buildOf(SEVEN_SPEED);
    const cassette = { partId: "cassette", attributes: { speeds: 11, freehub: "hg" } };
    const fitted = withCandidate(build, cassette);
    expect(fitted.parts).toHaveLength(build.parts.length + 1);
    expect(checkCompatibility(build, cassette).issues.map((issue) => issue.ruleId)).toEqual([
      "chain-cassette-speeds",
      "derailleur-cassette-speeds",
      "cassette-freehub",
    ]);
  });

  it("compares with String() on both sides and bounds with an optional margin", () => {
    expect(compareValues({ kind: "equal", a: "x.a", b: "y.b" }, [11, "11"])).toBe(true);
    expect(compareValues({ kind: "lte", a: "x.a", b: "y.b" }, [161, 160])).toBe(false);
    expect(compareValues({ kind: "lte", a: "x.a", b: "y.b", margin: 2 }, [161, 160])).toBe(true);
    const range: RuleCheck = { kind: "range", a: "x.a", b: "y.b", table: { "19": [28, 40] } };
    expect(compareValues(range, [19, 28])).toBe(true);
    expect(compareValues(range, [19, 41])).toBe(false);
    expect(compareValues(range, [19, 27])).toBe(false);
    expect(compareValues(range, [21, 30])).toBeNull();
    const allowed: RuleCheck = { kind: "allowed", a: "x.a", b: "y.b", table: { hg: ["hg"] } };
    expect(compareValues(allowed, ["hg", "hg"])).toBe(true);
    expect(compareValues(allowed, ["__proto__", "hg"])).toBeNull();
    expect(compareValues({ kind: "flag", a: "x.a", mustBe: true }, [true])).toBe(true);
    expect(compareValues({ kind: "flag", a: "x.a", mustBe: true }, ["true"])).toBe(false);
  });

  it("splits an attribute reference at its first dot", () => {
    expect(parseRef("brake-caliper-front.rotor-size")).toEqual({
      partId: "brake-caliper-front",
      key: "rotor-size",
    });
  });
});
