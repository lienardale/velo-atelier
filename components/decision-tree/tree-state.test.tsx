/**
 * The URL ↔ state contract of the decision tree (§6.3). `.tsx` only so the
 * `ui` Vitest project (`components/**\/*.test.tsx`) picks it up next to the
 * components it serves.
 */
import { describe, expect, it } from "vitest";

import { DECISION_TREE } from "@/lib/domain/data/decision-tree";
import type { DecisionNode, QuestionId } from "@/lib/domain/schema/decision";

import {
  applyAnswer,
  defaultChoice,
  parseTreeSearch,
  positionOf,
  previousQuestion,
  resolveScreen,
  serializeTreeSearch,
  treeQuery,
  type TreeState,
} from "./tree-state";

const node = (id: QuestionId): DecisionNode => DECISION_TREE.find((n) => n.id === id)!;

describe("parseTreeSearch", () => {
  it("reads answers, guessed flags and the step", () => {
    expect(
      parseTreeSearch("?drive=muscular&discipline=gravel&wheel-size=700c~&step=brake-type"),
    ).toEqual({
      answers: { drive: "muscular", discipline: "gravel", "wheel-size": "700c" },
      guessed: ["wheel-size"],
      step: "brake-type",
    });
  });

  it("accepts a percent-encoded ~ and a URLSearchParams", () => {
    expect(parseTreeSearch(new URLSearchParams("brake-type=v-brake%7E")).guessed).toEqual([
      "brake-type",
    ]);
  });

  it("drops what is not an answer the tree would keep", () => {
    const state = parseTreeSearch(
      [
        "drive=muscular",
        "discipline=road",
        "suspension=front", // not asked of a road bike
        "wheel-size=29", // hidden for road
        "cockpit=DROP", // not an id
        "pedals=flat~~", // two suffixes
        "colour=red", // not a question
        "step=nope",
      ].join("&"),
    );
    expect(state).toEqual({
      answers: { drive: "muscular", discipline: "road" },
      guessed: [],
      step: null,
    });
  });

  it("forgets a guessed flag whose answer was pruned", () => {
    expect(parseTreeSearch("discipline=road&suspension=front~").guessed).toEqual([]);
  });
});

describe("serializeTreeSearch", () => {
  it("writes answers in tree order, ~ unescaped, then foreign params untouched", () => {
    const state: TreeState = {
      answers: { discipline: "gravel", drive: "muscular", "brake-type": "disc-hydraulic" },
      guessed: ["brake-type"],
      step: "brake-mount",
    };
    expect(serializeTreeSearch(state, "?utm_source=x%20y&drive=electric&step=drive")).toBe(
      "?drive=muscular&discipline=gravel&brake-type=disc-hydraulic~&step=brake-mount&utm_source=x%20y",
    );
  });

  it("is empty for an empty state and round-trips through parse", () => {
    expect(serializeTreeSearch({ answers: {}, guessed: [], step: null })).toBe("");
    const query = "?drive=electric&discipline=mtb~&step=wheel-size";
    expect(serializeTreeSearch(parseTreeSearch(query))).toBe(query);
    expect(treeQuery("utm=1&drive=electric")).toBe("?drive=electric");
  });
});

describe("resolveScreen", () => {
  const gravel3 = { drive: "muscular", discipline: "gravel", "wheel-size": "700c" };

  it("shows the next question when step is absent", () => {
    const screen = resolveScreen({ answers: gravel3, guessed: [], step: null });
    expect(screen).toEqual({ kind: "question", node: node("brake-type"), editing: false });
  });

  it("clamps a step beyond the next question to the next question", () => {
    const screen = resolveScreen({ answers: gravel3, guessed: [], step: "pedals" });
    expect(screen.kind === "question" && screen.node.id).toBe("brake-type");
  });

  it("clamps a step to a question not asked of this bike", () => {
    const screen = resolveScreen({ answers: gravel3, guessed: [], step: "e-motor" });
    expect(screen.kind === "question" && screen.node.id).toBe("brake-type");
  });

  it("opens an answered question for editing", () => {
    expect(resolveScreen({ answers: gravel3, guessed: [], step: "discipline" })).toEqual({
      kind: "question",
      node: node("discipline"),
      editing: true,
    });
  });

  it("shows the summary once every question is answered", () => {
    let state: TreeState = { answers: {}, guessed: [], step: null };
    for (let guard = 0; guard < 20; guard++) {
      const screen = resolveScreen(state);
      if (screen.kind === "summary") break;
      state = applyAnswer(
        state,
        screen.node.id,
        defaultChoice(screen.node, state.answers).option,
        true,
      );
    }
    expect(resolveScreen(state)).toEqual({ kind: "summary" });
    expect(state.step).toBeNull();
    expect(state.guessed).toEqual(Object.keys(state.answers));
  });
});

describe("applyAnswer", () => {
  it("moves to the next question and records the guessed flag", () => {
    const next = applyAnswer({ answers: {}, guessed: [], step: null }, "drive", "muscular", true);
    expect(next).toEqual({
      answers: { drive: "muscular" },
      guessed: ["drive"],
      step: "discipline",
    });
  });

  it("clears the guessed flag when the visitor picks the answer themselves", () => {
    const state: TreeState = { answers: { drive: "muscular" }, guessed: ["drive"], step: "drive" };
    expect(applyAnswer(state, "drive", "muscular", false).guessed).toEqual([]);
  });

  it("prunes dependants of a changed answer and jumps to the first unanswered (mtb → road)", () => {
    let state: TreeState = { answers: {}, guessed: [], step: null };
    const walk: Array<[QuestionId, string]> = [
      ["drive", "muscular"],
      ["discipline", "mtb"],
      ["wheel-size", "27-5"],
      ["brake-type", "disc-hydraulic"],
      ["brake-mount", "post-mount"],
      ["cockpit", "riser"],
      ["drivetrain", "derailleur-1x"],
      ["speeds", "12"],
      ["shifter", "trigger"],
      ["pedals", "flat"],
      ["suspension", "front"],
    ];
    for (const [question, option] of walk) state = applyAnswer(state, question, option, false);
    expect(state.answers.suspension).toBe("front");

    const edited = applyAnswer({ ...state, step: "discipline" }, "discipline", "road", false);
    expect(edited.answers.suspension).toBeUndefined();
    expect(edited.answers["wheel-size"]).toBeUndefined(); // 27.5 is not a road size
    expect(edited.step).toBe("wheel-size");
    expect(serializeTreeSearch(edited)).not.toContain("suspension");
  });
});

describe("positionOf / previousQuestion", () => {
  it("counts the questions this bike will be asked", () => {
    const answers = { drive: "muscular", discipline: "gravel", "wheel-size": "700c" };
    const { step, total } = positionOf(node("brake-type"), answers);
    expect(step).toBe(4);
    expect(total).toBeGreaterThan(4);
    expect(total).toBeLessThanOrEqual(DECISION_TREE.length);
  });

  it("skips questions that are not asked when going back", () => {
    const answers = {
      drive: "muscular",
      discipline: "road",
      "wheel-size": "700c",
      "brake-type": "rim-caliper",
    };
    // brake-mount is not asked of rim brakes: back from cockpit is brake-type.
    expect(previousQuestion(node("cockpit"), answers)).toBe("brake-type");
    expect(previousQuestion(node("drive"), answers)).toBeNull();
  });
});

describe("defaultChoice", () => {
  it("explains a context-dependent default by the answers it reads", () => {
    expect(defaultChoice(node("brake-type"), { discipline: "city-hybrid" })).toEqual({
      option: "v-brake",
      basedOn: [{ question: "discipline", option: "city-hybrid" }],
    });
  });

  it("has no context for the plain fallback", () => {
    expect(defaultChoice(node("brake-type"), { discipline: "gravel" })).toEqual({
      option: "disc-hydraulic",
      basedOn: [],
    });
  });

  it("reads through nested conditions without duplicates", () => {
    const synthetic: DecisionNode = {
      ...node("pedals"),
      default: {
        fallback: "flat",
        when: [
          {
            when: {
              all: [
                {
                  any: [
                    { q: "discipline", in: ["road"] },
                    { q: "discipline", in: ["gravel"] },
                  ],
                },
                { not: { q: "drive", in: ["electric"] } },
              ],
            },
            option: "spd",
          },
        ],
      },
    };
    expect(defaultChoice(synthetic, { drive: "muscular", discipline: "gravel" })).toEqual({
      option: "spd",
      basedOn: [
        { question: "discipline", option: "gravel" },
        { question: "drive", option: "muscular" },
      ],
    });
  });
});
