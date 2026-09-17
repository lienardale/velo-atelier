import fc from "fast-check";
import { describe as suite, expect, it } from "vitest";

import { DECISION_TREE } from "@/lib/domain/data/decision-tree";
import { BIKE_PRESETS, PRESET_IDS } from "@/lib/domain/data/presets";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import { answerWithDefaults, nextQuestion, visibleOptions } from "@/lib/domain/engine/decision";
import type { Answers } from "@/lib/domain/schema/decision";

import { answersFromSpec, describe, describeDetails } from "./describe";

const walk = fc.array(fc.nat({ max: 20 }), { maxLength: 16 }).map((picks) => {
  const answers: Answers = {};
  for (const pick of picks) {
    const next = nextQuestion(answers);
    if (next === null) break;
    const node = DECISION_TREE.find((candidate) => candidate.id === next)!;
    const options = visibleOptions(node, answers);
    answers[node.id] = options[pick % options.length].id;
  }
  return answers;
});

suite("answersFromSpec", () => {
  it("inverts buildBikeSpec for every bike the tree can describe (property)", () => {
    fc.assert(
      fc.property(walk, (answers) => {
        const complete = answerWithDefaults(answers);
        expect(answersFromSpec(buildBikeSpec(complete))).toEqual({ ...complete });
      }),
    );
  });
});

suite("describe(spec, locale)", () => {
  it("describes the demo gravel bike in French with the tree's own words", () => {
    const spec = buildBikeSpec(answerWithDefaults(BIKE_PRESETS["gravel-1x11"]));
    const sentence = describe(spec, "fr");
    expect(sentence.startsWith("Vélo décrit : ")).toBe(true);
    expect(sentence.endsWith(".")).toBe(true);
    expect(sentence).toContain("Pratique : Gravel");
    expect(sentence).toContain("Freins : Disque hydraulique");
    expect(sentence).not.toContain("Batterie");
  });

  it("describes an electric bike in English, battery included", () => {
    const spec = buildBikeSpec(answerWithDefaults(BIKE_PRESETS["emtb-mid-1x12"]));
    const sentence = describe(spec, "en");
    expect(sentence).toMatch(/^Bike described: /);
    expect(sentence).toContain("Assistance: Electric");
    expect(sentence).toContain("Motor: Mid-drive motor");
    expect(sentence).toContain("Battery: ");
  });

  it("gives one detail per question asked of the bike, never an unresolved key", () => {
    for (const id of PRESET_IDS) {
      // eslint-disable-next-line security/detect-object-injection -- a literal preset id
      const complete = answerWithDefaults(BIKE_PRESETS[id]);
      const spec = buildBikeSpec(complete);
      for (const locale of ["fr", "en"] as const) {
        const details = describeDetails(spec, locale);
        expect(details).toHaveLength(Object.keys(complete).length);
        for (const detail of details) expect(detail).not.toMatch(/decision\.|questions\.|\{/);
      }
    }
  });
});
