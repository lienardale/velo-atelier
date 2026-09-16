/**
 * Walking the tree (§2.1) — the deterministic half; `decision.property.test.ts`
 * holds the invariants that must survive any input.
 *
 * The case this file exists for is the acceptance criterion of W1-T1:
 * `answerWithDefaults({})` — a visitor who answers "je ne sais pas" sixteen
 * times — has to produce the muscular city-hybrid bike, spelled out below
 * rather than snapshotted, because every one of those twelve values is a
 * product decision someone can disagree with.
 */
import { describe, expect, it } from "vitest";

import {
  answerWithDefaults,
  defaultOption,
  evalCondition,
  isComplete,
  isNodeVisible,
  nextQuestion,
  nodeFor,
  progress,
  pruneAnswers,
  visibleOptions,
  visibleQuestions,
  type Answers,
  type DecisionNode,
  type QuestionId,
} from "@/lib/domain";
import { isQuestionId } from "@/lib/domain/data/decision-tree";

const optionIds = (node: DecisionNode, answers: Answers) =>
  visibleOptions(node, answers).map((option) => option.id);

describe("evalCondition", () => {
  const answers: Answers = { discipline: "mtb", drivetrain: "derailleur-1x" };

  it("matches in and notIn against an answer", () => {
    expect(evalCondition({ q: "discipline", in: ["mtb", "gravel"] }, answers)).toBe(true);
    expect(evalCondition({ q: "discipline", in: ["road"] }, answers)).toBe(false);
    expect(evalCondition({ q: "discipline", notIn: ["road"] }, answers)).toBe(true);
    expect(evalCondition({ q: "drivetrain", notIn: ["derailleur-1x"] }, answers)).toBe(false);
  });

  it("is false for BOTH in and notIn on an unanswered question", () => {
    // The rule that keeps a step-3 default from depending on a step-9 answer.
    expect(evalCondition({ q: "speeds", in: ["11"] }, answers)).toBe(false);
    expect(evalCondition({ q: "speeds", notIn: ["11"] }, answers)).toBe(false);
  });

  it("combines with all, any and not", () => {
    expect(
      evalCondition(
        {
          all: [
            { q: "discipline", in: ["mtb"] },
            { q: "drivetrain", in: ["derailleur-1x"] },
          ],
        },
        answers,
      ),
    ).toBe(true);
    expect(
      evalCondition(
        {
          all: [
            { q: "discipline", in: ["mtb"] },
            { q: "drivetrain", in: ["igh"] },
          ],
        },
        answers,
      ),
    ).toBe(false);
    expect(
      evalCondition(
        {
          any: [
            { q: "discipline", in: ["road"] },
            { q: "discipline", in: ["mtb"] },
          ],
        },
        answers,
      ),
    ).toBe(true);
    expect(evalCondition({ any: [{ q: "discipline", in: ["road"] }] }, answers)).toBe(false);
    expect(evalCondition({ not: { q: "discipline", in: ["road"] } }, answers)).toBe(true);
  });
});

describe("visibility", () => {
  it("asks a question only when it applies", () => {
    expect(isNodeVisible(nodeFor("drive"), {})).toBe(true);
    expect(isNodeVisible(nodeFor("brake-mount"), { "brake-type": "disc-hydraulic" })).toBe(true);
    expect(isNodeVisible(nodeFor("brake-mount"), { "brake-type": "v-brake" })).toBe(false);
    expect(isNodeVisible(nodeFor("e-motor"), { drive: "electric" })).toBe(true);
    expect(isNodeVisible(nodeFor("e-motor"), { drive: "muscular" })).toBe(false);
    expect(isNodeVisible(nodeFor("speeds"), { drivetrain: "singlespeed" })).toBe(false);
    expect(isNodeVisible(nodeFor("seatpost"), { discipline: "gravel" })).toBe(true);
    expect(isNodeVisible(nodeFor("suspension"), { discipline: "gravel" })).toBe(false);
  });

  it("offers only the wheel sizes the discipline is built around", () => {
    const wheels = nodeFor("wheel-size");
    expect(optionIds(wheels, { discipline: "road" })).toEqual(["700c", "650b"]);
    expect(optionIds(wheels, { discipline: "city-hybrid" })).toEqual([
      "700c",
      "650b",
      "27-5",
      "26",
    ]);
    expect(optionIds(wheels, { discipline: "mtb" })).toEqual(["29", "27-5", "26"]);
    expect(optionIds(wheels, { discipline: "kids" })).toEqual(["24", "20", "16"]);
  });

  it("splits the gear counts between hub gears and derailleurs", () => {
    const speeds = nodeFor("speeds");
    expect(optionIds(speeds, { drivetrain: "igh" })).toEqual(["3", "5", "7", "8", "11", "14"]);
    expect(optionIds(speeds, { drivetrain: "derailleur-2x" })).toEqual([
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
    ]);
  });
});

describe("defaultOption", () => {
  it("takes the first matching conditional default, else the fallback", () => {
    expect(defaultOption(nodeFor("brake-type"), { discipline: "gravel" })).toBe("disc-hydraulic");
    expect(defaultOption(nodeFor("brake-type"), { discipline: "city-hybrid" })).toBe("v-brake");
    expect(defaultOption(nodeFor("wheel-size"), { discipline: "mtb" })).toBe("29");
    expect(defaultOption(nodeFor("wheel-size"), { discipline: "kids" })).toBe("20");
    expect(defaultOption(nodeFor("wheel-size"), { discipline: "road" })).toBe("700c");
    // igh wins over the discipline rules, because it comes first in the list.
    expect(defaultOption(nodeFor("speeds"), { discipline: "road", drivetrain: "igh" })).toBe("7");
    expect(
      defaultOption(nodeFor("speeds"), { discipline: "road", drivetrain: "derailleur-2x" }),
    ).toBe("11");
    expect(defaultOption(nodeFor("shifter"), { cockpit: "drop" })).toBe("sti-integrated");
    expect(defaultOption(nodeFor("shifter"), { discipline: "city-hybrid" })).toBe("grip");
    expect(defaultOption(nodeFor("shifter"), {})).toBe("trigger");
  });

  // A conditional default and an option's own visibility are written in
  // different places; the engine must never hand back an answer the grid does
  // not show, or the visitor lands on a step with nothing selected.
  describe("never returns an option that is not on screen", () => {
    const hidden: DecisionNode = {
      id: "speeds",
      order: 9,
      titleKey: "decision.speeds.title",
      options: [
        {
          id: "3",
          labelKey: "decision.speeds.options.3.label",
          visibleWhen: { q: "drive", in: ["electric"] },
        },
        { id: "5", labelKey: "decision.speeds.options.5.label" },
      ],
      default: { fallback: "3", when: [{ when: { q: "drive", in: ["muscular"] }, option: "3" }] },
      help: { textKey: "decision.speeds.help", illustrationId: "ill-speeds" },
    };

    it("skips a matching rule whose option is hidden, and a hidden fallback", () => {
      expect(defaultOption(hidden, { drive: "muscular" })).toBe("5");
    });

    it("uses the fallback when it is visible", () => {
      expect(defaultOption(hidden, { drive: "electric" })).toBe("3");
    });

    it("falls back to the declared option when nothing at all is visible", () => {
      const invisible: DecisionNode = {
        ...hidden,
        options: hidden.options.map((option) => ({
          ...option,
          visibleWhen: { q: "drive", in: ["electric"] },
        })),
      };
      expect(defaultOption(invisible, {})).toBe("3");
    });
  });
});

describe("pruneAnswers", () => {
  it("drops an answer whose question is no longer asked", () => {
    // The §6.3 case: editing the discipline from mtb to road takes the
    // suspension answer out of the URL instead of leaving it behind.
    const answers: Answers = { discipline: "road", suspension: "front", seatpost: "dropper" };
    expect(pruneAnswers(answers)).toEqual({ discipline: "road" });
  });

  it("drops an option the new context no longer offers", () => {
    expect(pruneAnswers({ discipline: "road", "wheel-size": "29" })).toEqual({
      discipline: "road",
    });
    expect(pruneAnswers({ drivetrain: "igh", speeds: "12" })).toEqual({ drivetrain: "igh" });
  });

  it("drops an option id that is not in the tree at all", () => {
    expect(pruneAnswers({ drive: "steam", discipline: "road" })).toEqual({ discipline: "road" });
  });

  it("keeps a valid set untouched and is idempotent", () => {
    const answers: Answers = { drive: "muscular", discipline: "mtb", "wheel-size": "29" };
    expect(pruneAnswers(answers)).toEqual(answers);
    expect(pruneAnswers(pruneAnswers(answers))).toEqual(pruneAnswers(answers));
  });
});

describe("nextQuestion / isComplete", () => {
  it("walks the tree in order and skips what does not apply", () => {
    expect(nextQuestion({})).toBe("drive");
    expect(nextQuestion({ drive: "muscular" })).toBe("discipline");
    expect(nextQuestion({ drive: "muscular", discipline: "road", "wheel-size": "700c" })).toBe(
      "brake-type",
    );
    // Rim brakes: brake-mount is skipped entirely.
    expect(
      nextQuestion({
        drive: "muscular",
        discipline: "road",
        "wheel-size": "700c",
        "brake-type": "rim-caliper",
      }),
    ).toBe("cockpit");
  });

  it("is null — and isComplete true — once everything that applies is answered", () => {
    const complete = answerWithDefaults({});
    expect(nextQuestion(complete)).toBeNull();
    expect(isComplete(complete)).toBe(true);
    expect(isComplete({})).toBe(false);
  });
});

describe("answerWithDefaults", () => {
  it('answers "je ne sais pas" sixteen times with a muscular city bike', () => {
    expect(answerWithDefaults({})).toEqual({
      drive: "muscular",
      discipline: "city-hybrid",
      "wheel-size": "700c",
      "brake-type": "v-brake",
      cockpit: "flat",
      drivetrain: "igh",
      transmission: "chain",
      speeds: "7",
      shifter: "grip",
      pedals: "flat",
      suspension: "rigid",
      "tire-system": "clincher-tube",
    });
  });

  it("keeps the answers given and fills in the rest", () => {
    const answers = answerWithDefaults({ discipline: "mtb" });
    expect(answers).toMatchObject({
      discipline: "mtb",
      "wheel-size": "29",
      "brake-type": "disc-hydraulic",
      "brake-mount": "post-mount",
      cockpit: "riser",
      drivetrain: "derailleur-1x",
      speeds: "12",
      shifter: "trigger",
      suspension: "front",
      seatpost: "rigid",
      "tire-system": "tubeless",
    });
    expect(answers.transmission).toBeUndefined();
  });

  it("asks the two e-bike questions only of an e-bike", () => {
    expect(answerWithDefaults({ drive: "electric" })).toMatchObject({
      "e-motor": "mid-drive",
      "e-battery": "integrated",
    });
    expect(answerWithDefaults({})["e-motor"]).toBeUndefined();
  });

  it("is idempotent and prunes as it goes", () => {
    const once = answerWithDefaults({ discipline: "road", suspension: "full" });
    expect(once.suspension).toBeUndefined();
    expect(answerWithDefaults(once)).toEqual(once);
  });
});

describe("progress", () => {
  it("counts the questions this bike will be asked, defaults included", () => {
    const start = progress({});
    expect(start.step).toBe(1);
    expect(start.node?.id).toBe("drive");
    expect(start.total).toBe(visibleQuestions({}).length);
    expect(start.total).toBe(12);

    // An e-bike is asked two more questions than a muscular one.
    expect(visibleQuestions({ drive: "electric" }).length).toBe(14);
  });

  it("stops at the end without a node", () => {
    const done = progress(answerWithDefaults({}));
    expect(done.node).toBeNull();
    expect(done.step).toBe(done.total);
  });
});

describe("question ids", () => {
  it("recognises its own ids and nothing else", () => {
    expect(isQuestionId("wheel-size")).toBe(true);
    expect(isQuestionId("wheel_size")).toBe(false);
  });

  it("throws on a node that does not exist", () => {
    expect(() => nodeFor("saddle-height" as QuestionId)).toThrow(/Unknown question id/);
  });
});
