/**
 * The decision tree: 16 questions that turn "my bike" into a `BikeSpec` (§2.1).
 *
 * Reading order is the running order: `order` is the 1-based position in this
 * array, and a condition may only look at a question asked **earlier**. That
 * single rule is what makes the walk monotone — `nextQuestion()` never sends
 * the visitor backwards, and a default computed at step 3 can never be
 * contradicted by an answer given at step 9.
 *
 * Message keys and illustration ids are derived by {@link node} from the
 * question and option ids, so they cannot drift:
 *
 *   `decision.<q>.title` `decision.<q>.help`
 *   `decision.<q>.options.<option>.label` / `.description`
 *   `ill-<q>` for the help aid, `ill-<q>-<option>` for a thumbnail
 *
 * Zod-free (`import type` only): this module is re-exported by the barrel.
 */
import type { AnswerCondition, DecisionNode, DecisionOption } from "../schema/decision";

import { THUMBNAIL_THRESHOLD } from "./conventions";
import type { IllustrationId } from "./illustrations";

/** The 16 questions, in the order they are asked. */
export const QUESTION_IDS = [
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
] as const;

export type QuestionId = (typeof QUESTION_IDS)[number];

/** Type guard for question ids arriving from a URL or from storage. */
export function isQuestionId(value: string): value is QuestionId {
  return (QUESTION_IDS as readonly string[]).includes(value);
}

// ── Condition helpers ────────────────────────────────────────────────────────

const answered = (q: QuestionId, ...options: string[]): AnswerCondition => ({ q, in: options });
const notAnswered = (q: QuestionId, ...options: string[]): AnswerCondition => ({
  q,
  notIn: options,
});

/** `discipline` is the strongest default-setter: eight of the sixteen defaults read it. */
const discipline = (...ids: string[]): AnswerCondition => answered("discipline", ...ids);

const DERAILLEURS = ["derailleur-1x", "derailleur-2x", "derailleur-3x"] as const;

// ── Node builder ─────────────────────────────────────────────────────────────

interface OptionSpec {
  id: string;
  /** Absent = always offered. */
  visibleWhen?: AnswerCondition;
}

interface NodeSpec {
  id: QuestionId;
  order: number;
  options: readonly OptionSpec[];
  /** "Je ne sais pas" when nothing more specific matches. */
  fallback: string;
  /** Context-dependent defaults, first match wins. */
  when?: readonly { when: AnswerCondition; option: string }[];
  /** Absent = always asked. */
  visibleWhen?: AnswerCondition;
}

function node(spec: NodeSpec): DecisionNode {
  const numericOnly = spec.options.every((option) => /^[0-9]+$/.test(option.id));
  const thumbnails = spec.options.length >= THUMBNAIL_THRESHOLD && !numericOnly;

  const options: DecisionOption[] = spec.options.map((option) => ({
    id: option.id,
    labelKey: `decision.${spec.id}.options.${option.id}.label`,
    descriptionKey: `decision.${spec.id}.options.${option.id}.description`,
    ...(thumbnails ? { illustrationId: `ill-${spec.id}-${option.id}` as IllustrationId } : {}),
    ...(option.visibleWhen ? { visibleWhen: option.visibleWhen } : {}),
  }));

  return {
    id: spec.id,
    order: spec.order,
    titleKey: `decision.${spec.id}.title`,
    options,
    default: { fallback: spec.fallback, when: spec.when ?? [] },
    ...(spec.visibleWhen ? { visibleWhen: spec.visibleWhen } : {}),
    help: {
      textKey: `decision.${spec.id}.help`,
      illustrationId: `ill-${spec.id}` as IllustrationId,
    },
  };
}

// ── The tree ─────────────────────────────────────────────────────────────────

export const DECISION_TREE: readonly DecisionNode[] = [
  // 1. Electric or not decides whether questions 15 and 16 are ever asked, and
  //    whether the bike has a bottom bracket or a mid-drive motor in its place.
  node({
    id: "drive",
    order: 1,
    options: [{ id: "muscular" }, { id: "electric" }],
    fallback: "muscular",
  }),

  // 2. The discipline drives most other defaults; it is never conditional itself.
  node({
    id: "discipline",
    order: 2,
    options: [
      { id: "road" },
      { id: "gravel" },
      { id: "mtb" },
      { id: "city-hybrid" },
      { id: "kids" },
    ],
    fallback: "city-hybrid",
  }),

  // 3. Only the sizes a given discipline is actually built around are offered;
  //    the help text sends the reader to the ETRTO number on the sidewall.
  node({
    id: "wheel-size",
    order: 3,
    options: [
      { id: "700c", visibleWhen: discipline("road", "gravel", "city-hybrid") },
      { id: "650b", visibleWhen: discipline("road", "gravel", "city-hybrid") },
      { id: "29", visibleWhen: discipline("mtb") },
      { id: "27-5", visibleWhen: discipline("mtb", "city-hybrid") },
      { id: "26", visibleWhen: discipline("mtb", "city-hybrid") },
      { id: "24", visibleWhen: discipline("kids") },
      { id: "20", visibleWhen: discipline("kids") },
      { id: "16", visibleWhen: discipline("kids") },
    ],
    fallback: "700c",
    when: [
      { when: discipline("mtb"), option: "29" },
      { when: discipline("kids"), option: "20" },
    ],
  }),

  // 4. Hub and coaster brakes are out of scope (§Scope): the help text tells
  //    those riders to pick V-brake so the rest of the bike still works.
  node({
    id: "brake-type",
    order: 4,
    options: [
      { id: "rim-caliper" },
      { id: "v-brake" },
      { id: "cantilever" },
      { id: "disc-mechanical" },
      { id: "disc-hydraulic" },
    ],
    fallback: "disc-hydraulic",
    when: [{ when: discipline("city-hybrid", "kids"), option: "v-brake" }],
  }),

  // 5. Disc bikes only: the mount decides which adapters and rotor sizes fit.
  node({
    id: "brake-mount",
    order: 5,
    options: [{ id: "flat-mount" }, { id: "post-mount" }, { id: "is-mount" }],
    fallback: "flat-mount",
    when: [{ when: discipline("mtb", "city-hybrid"), option: "post-mount" }],
    visibleWhen: answered("brake-type", "disc-mechanical", "disc-hydraulic"),
  }),

  // 6. The bar shape decides the shifter family, the grips or tape, and the 3D
  //    cockpit geometry.
  node({
    id: "cockpit",
    order: 6,
    options: [{ id: "drop" }, { id: "flat" }, { id: "riser" }, { id: "swept" }],
    fallback: "flat",
    when: [
      { when: discipline("road", "gravel"), option: "drop" },
      { when: discipline("mtb"), option: "riser" },
    ],
  }),

  // 7. Chainring count and gear system in one question — counting chainrings is
  //    the one thing anyone can do without knowing a single brand name.
  node({
    id: "drivetrain",
    order: 7,
    options: [
      { id: "derailleur-1x" },
      { id: "derailleur-2x" },
      { id: "derailleur-3x" },
      { id: "igh" },
      { id: "singlespeed" },
    ],
    fallback: "derailleur-1x",
    when: [
      { when: discipline("road"), option: "derailleur-2x" },
      { when: discipline("city-hybrid"), option: "igh" },
      { when: discipline("kids"), option: "singlespeed" },
    ],
  }),

  // 8. Belts exist only where there is no derailleur to run them through.
  node({
    id: "transmission",
    order: 8,
    options: [{ id: "chain" }, { id: "belt" }],
    fallback: "chain",
    visibleWhen: answered("drivetrain", "igh", "singlespeed"),
  }),

  // 9. Plain numbers, so the grid renders without thumbnails (§2.1). Hub gears
  //    and derailleurs share 7, 8 and 11; everything else belongs to one family.
  node({
    id: "speeds",
    order: 9,
    options: [
      { id: "3", visibleWhen: answered("drivetrain", "igh") },
      { id: "5", visibleWhen: answered("drivetrain", "igh") },
      { id: "7" },
      { id: "8" },
      { id: "9", visibleWhen: answered("drivetrain", ...DERAILLEURS) },
      { id: "10", visibleWhen: answered("drivetrain", ...DERAILLEURS) },
      { id: "11" },
      { id: "12", visibleWhen: answered("drivetrain", ...DERAILLEURS) },
      { id: "13", visibleWhen: answered("drivetrain", ...DERAILLEURS) },
      { id: "14", visibleWhen: answered("drivetrain", "igh") },
    ],
    fallback: "8",
    when: [
      { when: answered("drivetrain", "igh"), option: "7" },
      { when: discipline("road", "gravel"), option: "11" },
      { when: discipline("mtb"), option: "12" },
    ],
    visibleWhen: notAnswered("drivetrain", "singlespeed"),
  }),

  // 10. What the hand touches. Drop bars almost always mean integrated levers.
  node({
    id: "shifter",
    order: 10,
    options: [
      { id: "sti-integrated" },
      { id: "trigger" },
      { id: "grip" },
      { id: "thumb" },
      { id: "bar-end" },
      { id: "electronic" },
    ],
    fallback: "trigger",
    when: [
      { when: answered("cockpit", "drop"), option: "sti-integrated" },
      { when: discipline("city-hybrid"), option: "grip" },
    ],
    visibleWhen: notAnswered("drivetrain", "singlespeed"),
  }),

  // 11. Pedals decide the cleat guides and half of the "what do I buy" answers.
  node({
    id: "pedals",
    order: 11,
    options: [
      { id: "flat" },
      { id: "spd" },
      { id: "road-clipless" },
      { id: "toe-clips" },
      { id: "combo" },
    ],
    fallback: "flat",
    when: [
      { when: discipline("road"), option: "road-clipless" },
      { when: discipline("gravel"), option: "spd" },
    ],
  }),

  // 12. Road and gravel frames are rigid by definition here; full suspension is
  //     drawn but its kinematics are out of scope (§Scope).
  node({
    id: "suspension",
    order: 12,
    options: [{ id: "rigid" }, { id: "front" }, { id: "full" }],
    fallback: "rigid",
    when: [{ when: discipline("mtb"), option: "front" }],
    visibleWhen: discipline("mtb", "city-hybrid", "kids"),
  }),

  // 13. Asked where droppers are common. Gravel bikes get the question but not
  //     the suspension question, so the `full` default simply never fires there.
  node({
    id: "seatpost",
    order: 13,
    options: [{ id: "rigid" }, { id: "dropper" }],
    fallback: "rigid",
    when: [{ when: answered("suspension", "full"), option: "dropper" }],
    visibleWhen: discipline("mtb", "gravel"),
  }),

  // 14. Decides whether the bike has inner tubes or sealant, and which
  //     puncture guide applies.
  node({
    id: "tire-system",
    order: 14,
    options: [{ id: "clincher-tube" }, { id: "tubeless" }],
    fallback: "clincher-tube",
    when: [{ when: discipline("mtb", "gravel"), option: "tubeless" }],
  }),

  // 15. Electric only. Front-hub motors are out of scope (§Scope).
  node({
    id: "e-motor",
    order: 15,
    options: [{ id: "mid-drive" }, { id: "hub-rear" }],
    fallback: "mid-drive",
    visibleWhen: answered("drive", "electric"),
  }),

  // 16. Electric only. Where the battery sits changes the frame drawing and the
  //     charging / storage advice.
  node({
    id: "e-battery",
    order: 16,
    options: [{ id: "integrated" }, { id: "external-downtube" }, { id: "rack" }],
    fallback: "integrated",
    visibleWhen: answered("drive", "electric"),
  }),
];

/** The tree indexed by question id — `engine/decision.ts` looks nodes up constantly. */
export const NODES_BY_ID: ReadonlyMap<QuestionId, DecisionNode> = new Map(
  DECISION_TREE.map((entry) => [entry.id, entry]),
);

/** The node for `id`. Throws on an unknown id: every caller has a `QuestionId`. */
export function nodeFor(id: QuestionId): DecisionNode {
  const found = NODES_BY_ID.get(id);
  if (!found) throw new Error(`Unknown question id: ${id}`);
  return found;
}
