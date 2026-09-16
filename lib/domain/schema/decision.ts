/**
 * The decision tree — types, parsers and the build-time refinements (§2.1).
 *
 * The tree is the home page: 16 questions, one screen each, every one with a
 * default ("Je ne sais pas") and a visual aid. `data/decision-tree.ts` is the
 * data; `engine/decision.ts` walks it; this file is what makes a malformed tree
 * impossible to ship.
 *
 * Runtime imports point at `data/` (the id list) and never the other way round:
 * the data files import types from here, which erase, so the barrel stays
 * zod-free.
 */
import * as z from "zod";

import { ID_PATTERN, THUMBNAIL_THRESHOLD } from "../data/conventions";
import { QUESTION_IDS, type QuestionId } from "../data/decision-tree";
import { ILLUSTRATION_IDS, type IllustrationId } from "../data/illustrations";

export type { QuestionId };

/**
 * A predicate over the answers given so far.
 *
 * `in` / `notIn` on an **unanswered** question are both false (§2.1): "not a
 * city bike" must not be true before the discipline has been picked, or a
 * default computed at step 3 would contradict the answer given at step 5.
 */
export type AnswerCondition =
  | { q: QuestionId; in: readonly string[] }
  | { q: QuestionId; notIn: readonly string[] }
  | { all: readonly AnswerCondition[] }
  | { any: readonly AnswerCondition[] }
  | { not: AnswerCondition };

export interface DecisionOption {
  /** Unique within the node; becomes a message-key segment and a URL value. */
  id: string;
  /** `decision.<q>.options.<id>.label` */
  labelKey: string;
  /** `decision.<q>.options.<id>.description` — the one-line hint under the label. */
  descriptionKey?: string;
  /** `ill-<q>-<id>`; required when the node can show {@link THUMBNAIL_THRESHOLD} options or more. */
  illustrationId?: IllustrationId;
  /** Absent = always offered. */
  visibleWhen?: AnswerCondition;
}

/** "Je ne sais pas": the first matching `when`, else `fallback` (§2.1). */
export interface DecisionDefault {
  fallback: string;
  when: readonly { when: AnswerCondition; option: string }[];
}

export interface DecisionNode {
  id: QuestionId;
  /** 1-based, unique, ascending through the array. Conditions may only look at lower orders. */
  order: number;
  /** `decision.<q>.title` */
  titleKey: string;
  options: readonly DecisionOption[];
  default: DecisionDefault;
  /** Absent = always asked. */
  visibleWhen?: AnswerCondition;
  /** The check-it-on-your-own-bike aid: one paragraph and one drawing. */
  help: { textKey: string; illustrationId: IllustrationId };
}

const QuestionIdSchema = z.enum(QUESTION_IDS);
const OptionIdSchema = z.string().regex(ID_PATTERN).max(32);
/** Parsed against the registry itself, so an id with no drawing behind it fails here. */
const IllustrationIdSchema = z.enum(ILLUSTRATION_IDS);

export const AnswerConditionSchema: z.ZodType<AnswerCondition> = z.lazy(() =>
  z.union([
    z.strictObject({ q: QuestionIdSchema, in: z.array(OptionIdSchema).min(1) }),
    z.strictObject({ q: QuestionIdSchema, notIn: z.array(OptionIdSchema).min(1) }),
    z.strictObject({ all: z.array(AnswerConditionSchema).min(1) }),
    z.strictObject({ any: z.array(AnswerConditionSchema).min(1) }),
    z.strictObject({ not: AnswerConditionSchema }),
  ]),
);

export const DecisionOptionSchema: z.ZodType<DecisionOption> = z.strictObject({
  id: OptionIdSchema,
  labelKey: z.string().min(1),
  descriptionKey: z.string().min(1).optional(),
  illustrationId: IllustrationIdSchema.optional(),
  visibleWhen: AnswerConditionSchema.optional(),
});

export const DecisionNodeSchema: z.ZodType<DecisionNode> = z.strictObject({
  id: QuestionIdSchema,
  order: z.int().positive(),
  titleKey: z.string().min(1),
  options: z.array(DecisionOptionSchema).min(2),
  default: z.strictObject({
    fallback: OptionIdSchema,
    when: z.array(z.strictObject({ when: AnswerConditionSchema, option: OptionIdSchema })),
  }),
  visibleWhen: AnswerConditionSchema.optional(),
  help: z.strictObject({
    textKey: z.string().min(1),
    illustrationId: IllustrationIdSchema,
  }),
});

/**
 * The tree-wide refinements — the ones a single node cannot check on its own.
 * Returns one message per problem, empty for a well-formed tree.
 *
 * Exported so a test can feed it a deliberately broken tree; the catalogue
 * parser below runs it on every parse.
 */
export function checkDecisionTree(nodes: readonly DecisionNode[]): string[] {
  const errors: string[] = [];
  const orderOf = new Map<QuestionId, number>();

  nodes.forEach((node, index) => {
    if (orderOf.has(node.id)) errors.push(`${node.id}: duplicate question id`);
    if (node.order !== index + 1) {
      errors.push(`${node.id}: order ${node.order} is not its 1-based position ${index + 1}`);
    }
    orderOf.set(node.id, node.order);
  });

  for (const node of nodes) {
    const optionIds = new Set<string>();
    const numericOnly = node.options.every((option) => /^[0-9]+$/.test(option.id));
    const needsThumbnails = node.options.length >= THUMBNAIL_THRESHOLD && !numericOnly;

    for (const option of node.options) {
      if (optionIds.has(option.id)) errors.push(`${node.id}.${option.id}: duplicate option id`);
      optionIds.add(option.id);

      const labelKey = `decision.${node.id}.options.${option.id}.label`;
      if (option.labelKey !== labelKey) {
        errors.push(`${node.id}.${option.id}: labelKey must be "${labelKey}"`);
      }
      const descriptionKey = `decision.${node.id}.options.${option.id}.description`;
      if (option.descriptionKey !== undefined && option.descriptionKey !== descriptionKey) {
        errors.push(`${node.id}.${option.id}: descriptionKey must be "${descriptionKey}"`);
      }
      const thumbnailId = `ill-${node.id}-${option.id}`;
      if (option.illustrationId !== undefined && option.illustrationId !== thumbnailId) {
        errors.push(`${node.id}.${option.id}: illustrationId must be "${thumbnailId}"`);
      }
      if (needsThumbnails && option.illustrationId === undefined) {
        errors.push(
          `${node.id}.${option.id}: a node with ${node.options.length} options needs a thumbnail on every option`,
        );
      }
    }

    if (node.titleKey !== `decision.${node.id}.title`) {
      errors.push(`${node.id}: titleKey must be "decision.${node.id}.title"`);
    }
    if (node.help.textKey !== `decision.${node.id}.help`) {
      errors.push(`${node.id}: help.textKey must be "decision.${node.id}.help"`);
    }
    if (node.help.illustrationId !== `ill-${node.id}`) {
      errors.push(`${node.id}: help.illustrationId must be "ill-${node.id}"`);
    }
    if (!optionIds.has(node.default.fallback)) {
      errors.push(`${node.id}: default fallback "${node.default.fallback}" is not an option`);
    }
    for (const rule of node.default.when) {
      if (!optionIds.has(rule.option)) {
        errors.push(`${node.id}: conditional default "${rule.option}" is not an option`);
      }
    }

    for (const condition of conditionsOf(node)) {
      for (const referenced of questionsOf(condition)) {
        const order = orderOf.get(referenced);
        if (order === undefined) {
          errors.push(`${node.id}: condition references unknown question "${referenced}"`);
        } else if (order >= node.order) {
          errors.push(
            `${node.id}: condition references "${referenced}" (order ${order}), which is not asked earlier`,
          );
        }
      }
    }
  }

  return errors;
}

/** Every condition attached to a node: its own, its options', its defaults'. */
function conditionsOf(node: DecisionNode): AnswerCondition[] {
  const conditions: AnswerCondition[] = [];
  if (node.visibleWhen) conditions.push(node.visibleWhen);
  for (const option of node.options) if (option.visibleWhen) conditions.push(option.visibleWhen);
  for (const rule of node.default.when) conditions.push(rule.when);
  return conditions;
}

/** The question ids a condition reads, however deeply nested. */
function questionsOf(condition: AnswerCondition): QuestionId[] {
  if ("q" in condition) return [condition.q];
  if ("all" in condition) return condition.all.flatMap(questionsOf);
  if ("any" in condition) return condition.any.flatMap(questionsOf);
  return questionsOf(condition.not);
}

/** Parses a whole tree: every node, then the tree-wide refinements. */
export const DecisionTreeSchema = z.array(DecisionNodeSchema).check((ctx) => {
  for (const message of checkDecisionTree(ctx.value)) {
    ctx.issues.push({ code: "custom", message, input: ctx.value });
  }
});

/**
 * Answers as they are persisted and as they travel in the URL: a partial map of
 * question id → option id.
 *
 * `z.partialRecord` (zod 4) rather than `z.record(z.enum(…), …)`, which is
 * exhaustive in v4 and would demand all 16 keys.
 */
export const AnswersSchema = z.partialRecord(QuestionIdSchema, OptionIdSchema);

export type Answers = z.infer<typeof AnswersSchema>;

declare const completeAnswers: unique symbol;

/**
 * Answers with every currently visible question answered.
 *
 * The brand is unforgeable outside `engine/decision.ts`: only
 * `answerWithDefaults()` produces one, so `buildBikeSpec()` cannot be handed a
 * half-filled map.
 */
export type CompleteAnswers = Answers & { readonly [completeAnswers]: true };
