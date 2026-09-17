import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { BIKE_PRESETS, PRESET_IDS } from "@/lib/domain/data/presets";
import { DECISION_TREE } from "@/lib/domain/data/decision-tree";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import {
  answerWithDefaults,
  defaultOption,
  nextQuestion,
  pruneAnswers,
  visibleOptions,
} from "@/lib/domain/engine/decision";
import type { Answers } from "@/lib/domain/schema/decision";

import { decodeAnswers, decodeSpec, encodeSpec, SPEC_CODE_VERSION } from "./spec-codec";

/** A random walk through the tree: at each step either stop, or pick a visible option. */
const answersArbitrary = fc
  .array(fc.nat({ max: 20 }), { minLength: 0, maxLength: 16 })
  .map((picks) => {
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

describe("encodeSpec / decodeSpec (§5.4 guest spec transport)", () => {
  it("round-trips every preset to the same spec, in far fewer than 120 characters", () => {
    for (const id of PRESET_IDS) {
      // eslint-disable-next-line security/detect-object-injection -- a literal preset id
      const answers = BIKE_PRESETS[id];
      const code = encodeSpec(answers);
      expect(code.length).toBeLessThan(120);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeAnswers(code)).toEqual(pruneAnswers(answers));
      expect(decodeSpec(code)).toEqual(buildBikeSpec(answerWithDefaults(answers)));
    }
  });

  it("round-trips any partial walk through the tree (property)", () => {
    fc.assert(
      fc.property(answersArbitrary, (answers) => {
        const code = encodeSpec(answers);
        expect(decodeAnswers(code)).toEqual(pruneAnswers(answers));
      }),
    );
  });

  it("encodes the empty answers as the all-defaults bike", () => {
    const code = encodeSpec({});
    expect(decodeAnswers(code)).toEqual({});
    expect(decodeSpec(code)).toEqual(buildBikeSpec(answerWithDefaults({})));
  });

  it("is canonical: stale and hidden answers do not change the code", () => {
    const clean: Answers = { discipline: "road", "wheel-size": "700c" };
    // `suspension` is not asked of a road bike; `bogus` is not a question.
    const noisy = { ...clean, suspension: "front", bogus: "x" } as Answers;
    expect(encodeSpec(noisy)).toBe(encodeSpec(clean));
  });

  it("rejects anything encodeSpec would not have written", () => {
    const valid = encodeSpec({ discipline: "gravel" });
    const bytes = (values: number[]) =>
      btoa(String.fromCharCode(...values))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const zeros = new Array<number>(DECISION_TREE.length).fill(0);

    const invalid: unknown[] = [
      undefined,
      null,
      42,
      "",
      "not base64!",
      `${valid}=`, // padding is not part of the alphabet
      "a".repeat(65),
      bytes([SPEC_CODE_VERSION, ...zeros.slice(1)]), // one byte short
      bytes([SPEC_CODE_VERSION, ...zeros, 0]), // one byte long
      bytes([2, ...zeros]), // unknown version
      bytes([SPEC_CODE_VERSION, 3, ...zeros.slice(1)]), // drive has 2 options
      // wheel-size 29 (index 3) on a road bike: an option the tree hides
      bytes([SPEC_CODE_VERSION, 1, 1, 3, ...zeros.slice(3)]),
      // suspension answered on a road bike: a question the tree does not ask
      bytes([SPEC_CODE_VERSION, 0, 1, ...zeros.slice(2, 11), 1, ...zeros.slice(12)]),
    ];
    for (const code of invalid) {
      expect(decodeAnswers(code), String(code)).toBeNull();
      expect(decodeSpec(code), String(code)).toBeNull();
    }
  });

  it("rejects a non-canonical spelling of valid bytes", () => {
    const code = encodeSpec({ drive: "electric" });
    // Flip the unused low bits of the last base64 character: same bytes, different string.
    const last = code.at(-1)!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const sibling = alphabet[(alphabet.indexOf(last) & ~0b11) | 0b01];
    const variant = `${code.slice(0, -1)}${sibling}`;
    expect(variant).not.toBe(code);
    expect(decodeAnswers(variant)).toBeNull();
  });

  it("defaults decode to the same spec as the tree's own defaults", () => {
    const answers: Answers = { discipline: "city-hybrid" };
    const node = DECISION_TREE.find((candidate) => candidate.id === "brake-type")!;
    expect(defaultOption(node, answers)).toBe("v-brake");
    expect(decodeSpec(encodeSpec(answers))?.brakes.type).toBe("v-brake");
  });
});
