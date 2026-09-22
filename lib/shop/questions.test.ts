/**
 * The buying guide's questions (§5.5, §5.8 AC5, §6.8 AC7).
 *
 * Three things are worth holding here, and nothing else — the narrowing of the
 * options is `lib/domain/engine/buying-guide.test.ts`'s job:
 *
 *   1. `PART_QUESTIONS` follows the catalogue rather than a hand-written list;
 *   2. a stored refinement comes back in the ATTRIBUTE's type, which is what
 *      makes the query say "11 vitesses" and the rules compare like with like;
 *   3. an incompatible refinement produces an issue — the `role="alert"`
 *      callout of §6.8 AC7, whose data this is.
 */
import { describe, expect, it } from "vitest";

import { buildOf, deriveBike } from "@/lib/bike/rules";
import { PARTS, partDefinition } from "@/lib/domain/data/parts";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";

import {
  BRAND_TIERS,
  BRAND_TIER_KEY,
  brandFromRefinement,
  coerceAttributeValue,
  isBrandTier,
  PART_QUESTIONS,
  partQuestions,
  refinedPart,
  refinementAnswers,
  refinementIssues,
  shopConstraintsFor,
  shopQuestionsFor,
} from "./questions";

// Hoisted: three presets derived once for the whole file (`.debug/009`).
const gravel = buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"]));
const road = buildOf(deriveBike(BIKE_PRESETS["road-rim-2x11"]));
const tierLabels = { entry: "Entrée de gamme", mid: "Milieu de gamme", high: "Haut de gamme" };

describe("PART_QUESTIONS", () => {
  it("covers every part of the catalogue", () => {
    expect(Object.keys(PART_QUESTIONS).sort()).toEqual(PARTS.map((part) => part.id).sort());
  });

  it("asks about the editable attributes, and ends with the brand tier", () => {
    const questions = partQuestions("cassette");
    const editable = partDefinition("cassette")!.attributes.filter((a) => a.editable);
    expect(questions.map((question) => question.key)).toEqual([
      ...editable.map((attribute) => attribute.key),
      BRAND_TIER_KEY,
    ]);
    expect(questions.at(-1)).toMatchObject({
      key: BRAND_TIER_KEY,
      kind: "enum",
      labelKey: "shop.brand.label",
      values: BRAND_TIERS,
    });
  });

  it("carries message keys, never prose", () => {
    for (const questions of Object.values(PART_QUESTIONS)) {
      for (const question of questions) {
        expect(question.labelKey).toMatch(/^(parts\.attr\.[a-z0-9-]+\.label|shop\.brand\.label)$/);
        if (question.helpKey !== null) expect(question.helpKey).toMatch(/^[a-z][\w.-]*$/i);
      }
    }
  });

  it("never collides with a real attribute key", () => {
    const attributeKeys = new Set(
      PARTS.flatMap((part) => part.attributes.map((attribute) => attribute.key)),
    );
    expect(attributeKeys.has(BRAND_TIER_KEY)).toBe(false);
  });

  it("answers `[]` for an id the catalogue does not know", () => {
    expect(partQuestions("sprocket")).toEqual([]);
    expect(partQuestions("__proto__")).toEqual([]);
  });

  it("knows its three tiers", () => {
    expect(BRAND_TIERS).toEqual(["entry", "mid", "high"]);
    expect(isBrandTier("mid")).toBe(true);
    expect(isBrandTier("luxury")).toBe(false);
    expect(isBrandTier(undefined)).toBe(false);
  });
});

describe("shopQuestionsFor", () => {
  it("asks the part's own open attributes, in the visitor's language", () => {
    const questions = shopQuestionsFor(gravel, "cassette", "fr");
    expect(questions.map((question) => question.key)).toEqual(["range", "largest-cog", "freehub"]);
    expect(questions[0].label).toBe("Étagement");
    expect(questions[0].options?.some((option) => option.value === "11-34")).toBe(true);
    expect(questions.every((question) => question.partId === "cassette")).toBe(true);
  });

  it("does not ask what the rest of the bike already pins to one value", () => {
    // The chain decides the cassette's number of speeds, so it is a CONSTRAINT
    // to show, never a question to ask (§2.5).
    expect(shopQuestionsFor(gravel, "cassette", "fr").some((q) => q.key === "speeds")).toBe(false);
    expect(shopConstraintsFor(gravel, "cassette", "fr").map((c) => c.label)).toContain(
      "Vitesses : 11 vitesses",
    );
  });

  it("appends the brand tier only when the caller supplies the labels", () => {
    expect(shopQuestionsFor(gravel, "chain", "fr").some((q) => q.key === BRAND_TIER_KEY)).toBe(
      false,
    );
    const withTier = shopQuestionsFor(gravel, "chain", "fr", tierLabels, {
      label: "Gamme",
      help: null,
    });
    const tier = withTier.at(-1);
    expect(tier).toMatchObject({ key: BRAND_TIER_KEY, partId: "chain", label: "Gamme" });
    expect(tier?.options).toEqual([
      { value: "entry", label: "Entrée de gamme" },
      { value: "mid", label: "Milieu de gamme" },
      { value: "high", label: "Haut de gamme" },
    ]);
  });

  it("reports what the rest of the bike already decides", () => {
    const constraints = shopConstraintsFor(gravel, "cassette", "fr");
    expect(constraints.length).toBeGreaterThan(0);
    for (const constraint of constraints) expect(constraint.label).not.toBe("");
  });
});

describe("refinementAnswers", () => {
  it("puts a `<select>` string back into the attribute's own type", () => {
    const answers = refinementAnswers(gravel, "cassette", { speeds: "11" });
    expect(answers.speeds).toBe(11);
    expect(typeof answers.speeds).toBe("number");
  });

  it("starts from the bike's current attributes", () => {
    const answers = refinementAnswers(gravel, "chain");
    expect(answers).toEqual(gravel.parts.find((part) => part.partId === "chain")?.attributes);
  });

  it("reads a boolean and a number back", () => {
    expect(refinementAnswers(gravel, "chain", { "e-rated": "true" })["e-rated"]).toBe(true);
    expect(refinementAnswers(gravel, "chain", { "e-rated": "false" })["e-rated"]).toBe(false);
  });

  it("drops a value the attribute does not accept instead of guessing", () => {
    const answers = refinementAnswers(gravel, "cassette", { speeds: "42" });
    expect(answers.speeds).not.toBe(42);
    expect(answers.speeds).toBe(
      gravel.parts.find((part) => part.partId === "cassette")?.attributes.speeds,
    );
  });

  it("ignores the brand tier and any other key that is not an attribute", () => {
    const refinement: Record<string, string> = { [BRAND_TIER_KEY]: "high", nonsense: "x" };
    // An OWN `__proto__` key, as a stored refinement could carry one. A literal
    // `__proto__: "poison"` sets no key at all (a string cannot be a prototype),
    // so the input never held it — CodeQL #14.
    Object.defineProperty(refinement, "__proto__", {
      value: "poison",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(Object.keys(refinement)).toContain("__proto__");
    const answers = refinementAnswers(gravel, "chain", refinement);
    expect(answers).not.toHaveProperty(BRAND_TIER_KEY);
    expect(answers).not.toHaveProperty("nonsense");
    expect(Object.hasOwn(answers, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(answers)).toBe(Object.prototype);
  });

  it("answers `{}` for an unknown part", () => {
    expect(refinementAnswers(gravel, "sprocket" as "chain")).toEqual({});
  });

  it("builds a candidate part the compatibility engine can read", () => {
    expect(refinedPart(gravel, "chain", { speeds: "11" })).toEqual({
      partId: "chain",
      attributes: expect.objectContaining({ speeds: 11 }),
    });
  });
});

describe("refinementIssues (§6.8 AC7 — the role=alert callout)", () => {
  it("is quiet when the refinement matches the bike", () => {
    expect(refinementIssues(gravel, "chain", { speeds: "11" })).toEqual([]);
  });

  it("complains when the new chain does not match the cassette", () => {
    const issues = refinementIssues(gravel, "chain", { speeds: "12" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].partIds).toContain("chain");
    expect(issues[0].messageKey).toMatch(/^rules\./);
  });

  it("puts errors before warnings", () => {
    const issues = refinementIssues(road, "chain", { speeds: "13" });
    const severities = issues.map((issue) => issue.severity);
    expect(severities).toEqual(
      [...severities].sort((a, b) => (a === b ? 0 : a === "error" ? -1 : 1)),
    );
  });
});

describe("coerceAttributeValue", () => {
  const speeds = partDefinition("chain")!.attributes.find((a) => a.key === "speeds")!;

  it("keeps the catalogue's own spelling of an enum value", () => {
    expect(coerceAttributeValue(speeds, "11")).toBe(11);
    expect(coerceAttributeValue(speeds, "single")).toBe("single");
    expect(coerceAttributeValue(speeds, "11.0")).toBeUndefined();
  });

  it("refuses a number that is not finite", () => {
    const number = { ...speeds, kind: "number" as const, values: undefined };
    expect(coerceAttributeValue(number, "17")).toBe(17);
    expect(coerceAttributeValue(number, "nope")).toBeUndefined();
  });

  it("takes text as it comes", () => {
    const text = { ...speeds, kind: "text" as const, values: undefined };
    expect(coerceAttributeValue(text, "CN-HG601")).toBe("CN-HG601");
  });
});

describe("brandFromRefinement", () => {
  const brands = { entry: ["KMC Z"], mid: ["Shimano HG601"], high: [] as string[] };

  it("is the tier's first brand", () => {
    expect(brandFromRefinement({ [BRAND_TIER_KEY]: "mid" }, brands)).toBe("Shimano HG601");
  });

  it("is nothing when no tier was picked, the tier is unknown, or it is empty", () => {
    expect(brandFromRefinement({}, brands)).toBeUndefined();
    expect(brandFromRefinement({ [BRAND_TIER_KEY]: "luxury" }, brands)).toBeUndefined();
    expect(brandFromRefinement({ [BRAND_TIER_KEY]: "high" }, brands)).toBeUndefined();
    expect(brandFromRefinement({ [BRAND_TIER_KEY]: "mid" }, null)).toBeUndefined();
  });
});
