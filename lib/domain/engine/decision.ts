/**
 * Walking the decision tree (§2.1).
 *
 * Everything here is pure and zod-free: the home page runs it on every
 * keystroke of the URL, and `lib/domain/index.ts` re-exports it into the client
 * bundle.
 *
 * The one invariant that makes the walk safe: a condition may only read a
 * question asked **earlier** (enforced by `checkDecisionTree`). So evaluating
 * the tree front to back — as every function below does — always sees the
 * answers a condition depends on.
 */
import { DECISION_TREE } from "../data/decision-tree";
import type {
  Answers,
  AnswerCondition,
  CompleteAnswers,
  DecisionNode,
  DecisionOption,
  QuestionId,
} from "../schema/decision";

/**
 * Is `condition` true given `answers`?
 *
 * `in` and `notIn` are **both false** on an unanswered question (§2.1): before
 * the discipline is known, neither "is a city bike" nor "is not a city bike"
 * holds, so no default can quietly depend on an answer that has not been given.
 */
export function evalCondition(condition: AnswerCondition, answers: Answers): boolean {
  if ("q" in condition) {
    const answer = answers[condition.q];
    if (answer === undefined) return false;
    return "in" in condition ? condition.in.includes(answer) : !condition.notIn.includes(answer);
  }
  if ("all" in condition) return condition.all.every((child) => evalCondition(child, answers));
  if ("any" in condition) return condition.any.some((child) => evalCondition(child, answers));
  return !evalCondition(condition.not, answers);
}

/** Is this question asked at all, given the answers so far? */
export function isNodeVisible(node: DecisionNode, answers: Answers): boolean {
  return node.visibleWhen === undefined || evalCondition(node.visibleWhen, answers);
}

/** The options this node offers right now — 29ers are not shown to a city bike. */
export function visibleOptions(node: DecisionNode, answers: Answers): DecisionOption[] {
  return node.options.filter(
    (option) => option.visibleWhen === undefined || evalCondition(option.visibleWhen, answers),
  );
}

/**
 * What "Je ne sais pas" answers: the first matching conditional default, else
 * the fallback — and always an option that is actually on screen.
 *
 * The visibility filter is not paranoia: a conditional default and an option's
 * `visibleWhen` can be written by different hands, and offering an answer the
 * grid does not show would strand the visitor on a step with no selected card.
 */
export function defaultOption(node: DecisionNode, answers: Answers): string {
  const visible = visibleOptions(node, answers);
  const offered = (id: string) => visible.some((option) => option.id === id);

  for (const rule of node.default.when) {
    if (evalCondition(rule.when, answers) && offered(rule.option)) return rule.option;
  }
  if (offered(node.default.fallback)) return node.default.fallback;
  return visible.length > 0 ? visible[0].id : node.default.fallback;
}

/**
 * Drop everything that does not belong: unknown questions, unknown or currently
 * hidden option ids, and answers to questions that are no longer asked.
 *
 * This is what makes editing an earlier answer safe — switching the discipline
 * from `mtb` to `road` takes `suspension` out of the URL rather than leaving a
 * stale answer behind (§6.3).
 */
export function pruneAnswers(answers: Answers): Answers {
  const kept: Answers = {};
  for (const node of DECISION_TREE) {
    const answer = answers[node.id];
    if (answer === undefined) continue;
    if (!isNodeVisible(node, kept)) continue;
    if (!visibleOptions(node, kept).some((option) => option.id === answer)) continue;
    kept[node.id] = answer;
  }
  return kept;
}

/** The first question that is asked and still unanswered, or `null` when done. */
export function nextQuestion(answers: Answers): QuestionId | null {
  const kept = pruneAnswers(answers);
  for (const node of DECISION_TREE) {
    if (kept[node.id] === undefined && isNodeVisible(node, kept)) return node.id;
  }
  return null;
}

/** Are all the questions that apply to this bike answered? */
export function isComplete(answers: Answers): boolean {
  return nextQuestion(answers) === null;
}

/**
 * Fill every remaining question with its default — the only way to obtain
 * {@link CompleteAnswers}, and therefore the only way into `buildBikeSpec()`.
 *
 * Keys come out in tree order (pruning walks the tree, then so does the
 * filling), which keeps snapshots and URLs stable.
 */
export function answerWithDefaults(answers: Answers): CompleteAnswers {
  const complete: Answers = pruneAnswers(answers);
  for (const node of DECISION_TREE) {
    if (complete[node.id] !== undefined) continue;
    if (!isNodeVisible(node, complete)) continue;
    complete[node.id] = defaultOption(node, complete);
  }
  return complete as CompleteAnswers;
}

/**
 * The questions this bike will be asked, defaults included — the denominator of
 * the "3 / 12" progress indicator, which has to stop moving as the visitor
 * answers.
 */
export function visibleQuestions(answers: Answers): DecisionNode[] {
  const complete = answerWithDefaults(answers);
  return DECISION_TREE.filter((node) => isNodeVisible(node, complete));
}

/** Where the visitor is: 1-based step, total, and the node to render. */
export function progress(answers: Answers): {
  step: number;
  total: number;
  node: DecisionNode | null;
} {
  const questions = visibleQuestions(answers);
  const current = nextQuestion(answers);
  if (current === null) return { step: questions.length, total: questions.length, node: null };
  const index = questions.findIndex((node) => node.id === current);
  // eslint-disable-next-line security/detect-object-injection -- an index just returned by findIndex on that same array
  return { step: index + 1, total: questions.length, node: questions[index] };
}
