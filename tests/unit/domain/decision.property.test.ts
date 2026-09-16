/**
 * Invariants of the decision walk (§2.6) — the things that must hold for every
 * possible set of answers, including sets no UI would ever produce (a stale
 * URL, a hand-edited one, an option removed from the tree since the visitor
 * bookmarked it).
 *
 * 1. the walk terminates in at most one step per question;
 * 2. pruning is idempotent, and so is filling in the defaults;
 * 3. at every step the grid shows between two and {@link MAX_VISIBLE_OPTIONS}
 *    options, and the "je ne sais pas" answer is one of them;
 * 4. whatever the visitor answers, the result builds a spec that parses.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  answerWithDefaults,
  buildBikeSpec,
  DECISION_TREE,
  defaultOption,
  isNodeVisible,
  MAX_VISIBLE_OPTIONS,
  nextQuestion,
  nodeFor,
  pruneAnswers,
  QUESTION_IDS,
  visibleOptions,
  type Answers,
} from "@/lib/domain";
import { AnswersSchema } from "@/lib/domain/schema/decision";
import { BikeSpecSchema } from "@/lib/domain/schema/bike-spec";

const OPTION_IDS = [...new Set(DECISION_TREE.flatMap((node) => node.options.map((o) => o.id)))];

/** Answers as they arrive from a URL: real question ids, plausible and junk values. */
const answersArbitrary = fc.dictionary(
  fc.constantFrom(...QUESTION_IDS),
  fc.constantFrom(...OPTION_IDS, "definitely-not-an-option"),
) as unknown as fc.Arbitrary<Answers>;

/** One walk of the tree: at each step, take the option at `choices[step]`. */
function walk(start: Answers, choices: readonly number[]) {
  let answers = pruneAnswers(start);
  const steps: string[] = [];

  for (let index = 0; index < QUESTION_IDS.length + 1; index++) {
    const question = nextQuestion(answers);
    if (question === null) return { answers, steps };

    const node = nodeFor(question);
    const visible = visibleOptions(node, answers);

    expect(visible.length, `${question} shows too few options`).toBeGreaterThanOrEqual(2);
    expect(visible.length, `${question} shows too many options`).toBeLessThanOrEqual(
      MAX_VISIBLE_OPTIONS,
    );
    const fallback = defaultOption(node, answers);
    expect(
      visible.map((option) => option.id),
      `${question}: the default is not on screen`,
    ).toContain(fallback);

    steps.push(question);
    // eslint-disable-next-line security/detect-object-injection -- indices into arrays we just built
    const choice = visible[(choices[index] ?? 0) % visible.length];
    answers = { ...answers, [question]: choice.id };
  }

  throw new Error(`the walk did not terminate: ${steps.join(" → ")}`);
}

describe("the decision walk", () => {
  it("terminates in at most one step per question, from any starting point", () => {
    fc.assert(
      fc.property(
        answersArbitrary,
        fc.array(fc.nat({ max: 20 }), { maxLength: 20 }),
        (start, choices) => {
          const { answers, steps } = walk(start, choices);
          expect(steps.length).toBeLessThanOrEqual(QUESTION_IDS.length);
          expect(new Set(steps).size).toBe(steps.length); // never asks twice
          expect(nextQuestion(answers)).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("prunes idempotently, and never invents an answer", () => {
    fc.assert(
      fc.property(answersArbitrary, (start) => {
        const once = pruneAnswers(start);
        expect(pruneAnswers(once)).toEqual(once);
        for (const [question, option] of Object.entries(once)) {
          expect(start[question as keyof Answers]).toBe(option);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("fills in defaults idempotently, and answers exactly the visible questions", () => {
    fc.assert(
      fc.property(answersArbitrary, (start) => {
        const complete = answerWithDefaults(start);
        expect(answerWithDefaults(complete)).toEqual(complete);
        expect(AnswersSchema.safeParse(complete).success).toBe(true);

        for (const node of DECISION_TREE) {
          const answered = complete[node.id] !== undefined;
          expect(answered, `${node.id}`).toBe(isNodeVisible(node, complete));
        }
      }),
      { numRuns: 200 },
    );
  });

  it("always produces a spec that parses", () => {
    fc.assert(
      fc.property(
        answersArbitrary,
        fc.array(fc.nat({ max: 20 }), { maxLength: 20 }),
        (start, choices) => {
          const { answers } = walk(start, choices);
          const parsed = BikeSpecSchema.safeParse(buildBikeSpec(answerWithDefaults(answers)));
          expect(parsed.success ? null : parsed.error.issues).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});
