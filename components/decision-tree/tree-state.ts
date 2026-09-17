/**
 * The decision tree's URL state (§6.3), as pure functions the component and
 * its tests share.
 *
 *   /fr?drive=muscular&discipline=gravel&wheel-size=700c&step=brake-type
 *
 * - one query parameter per answered question, named by the question id; a
 *   trailing `~` marks an answer picked by "Je ne sais pas" (`disc-hydraulic~`);
 * - `step` is the question on screen. It may point back at an answered
 *   question (editing it), or at the next unanswered one; anything else — an
 *   unknown id, a question not asked of this bike, one beyond the first
 *   unanswered — is clamped to `nextQuestion(answers)`, so the URL and the
 *   engine never disagree about where the visitor is;
 * - every other parameter is left alone (`?utm_source=` survives answering).
 *
 * The query is untrusted: values are matched against the id pattern, then
 * `pruneAnswers` drops unknown questions, unknown or hidden options and answers
 * to questions no longer asked. The engine does the domain work
 * (`lib/domain/engine/decision.ts`); nothing here re-derives it.
 *
 * Zod-free and React-free: bundled into the home page.
 */
import { DECISION_TREE, isQuestionId, QUESTION_IDS } from "@/lib/domain/data/decision-tree";
import {
  defaultOption,
  evalCondition,
  isNodeVisible,
  nextQuestion,
  pruneAnswers,
  visibleQuestions,
} from "@/lib/domain/engine/decision";
import type {
  AnswerCondition,
  Answers,
  DecisionNode,
  QuestionId,
} from "@/lib/domain/schema/decision";

/** The query parameter holding the question on screen. */
export const STEP_PARAM = "step";

/** Suffix of an answer chosen by "Je ne sais pas". */
export const GUESSED_SUFFIX = "~";

const ANSWER_VALUE = /^([a-z0-9-]{1,32})(~?)$/;

export interface TreeState {
  /** Pruned: every answer is a visible option of a question that is asked. */
  answers: Answers;
  /** Questions whose answer is a default ("par défaut"), a subset of `answers`' keys. */
  guessed: readonly QuestionId[];
  /** The question the URL asks for, before clamping. */
  step: QuestionId | null;
}

export type TreeScreen =
  { kind: "question"; node: DecisionNode; editing: boolean } | { kind: "summary" };

/** Accepts `?a=b`, `a=b` or a `URLSearchParams`. */
function paramsOf(search: string | URLSearchParams): URLSearchParams {
  return typeof search === "string" ? new URLSearchParams(search) : search;
}

/** Keep only the guessed flags of answers that survived pruning, in tree order. */
function keptGuesses(answers: Answers, guessed: Iterable<QuestionId>): QuestionId[] {
  const flags = new Set(guessed);
  // eslint-disable-next-line security/detect-object-injection -- `id` iterates the literal question ids
  return QUESTION_IDS.filter((id) => flags.has(id) && answers[id] !== undefined);
}

/** Read the tree state from a query string. Never throws; invalid parts are dropped. */
export function parseTreeSearch(search: string | URLSearchParams): TreeState {
  const params = paramsOf(search);
  const raw: Answers = {};
  const guessed: QuestionId[] = [];
  for (const id of QUESTION_IDS) {
    const match = ANSWER_VALUE.exec(params.get(id) ?? "");
    if (match === null) continue;
    // eslint-disable-next-line security/detect-object-injection -- `id` iterates the literal question ids
    raw[id] = match[1];
    if (match[2] === GUESSED_SUFFIX) guessed.push(id);
  }
  const answers = pruneAnswers(raw);
  const step = params.get(STEP_PARAM);
  return {
    answers,
    guessed: keptGuesses(answers, guessed),
    step: step !== null && isQuestionId(step) ? step : null,
  };
}

/**
 * The query string for `state` (with its leading `?`, or `""`): the tree's
 * parameters in tree order, then every foreign parameter of `current` as it
 * was. `~` is left unescaped (`encodeURIComponent` keeps it), so the URL reads
 * `brake-type=disc-hydraulic~`.
 */
export function serializeTreeSearch(state: TreeState, current = ""): string {
  const guessed = new Set(state.guessed);
  const pairs: string[] = [];
  for (const node of DECISION_TREE) {
    const answer = state.answers[node.id];
    if (answer === undefined) continue;
    const value = guessed.has(node.id) ? `${answer}${GUESSED_SUFFIX}` : answer;
    pairs.push(`${node.id}=${encodeURIComponent(value)}`);
  }
  if (state.step !== null) pairs.push(`${STEP_PARAM}=${encodeURIComponent(state.step)}`);

  const owned = new Set<string>([...QUESTION_IDS, STEP_PARAM]);
  for (const [key, value] of paramsOf(current)) {
    if (!owned.has(key)) pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
}

/** Only the tree's own part of a query — to tell whether a URL change concerns the tree. */
export function treeQuery(search: string | URLSearchParams): string {
  return serializeTreeSearch(parseTreeSearch(search));
}

/** Which screen `state` shows, after clamping `step`. */
export function resolveScreen(state: TreeState): TreeScreen {
  const next = nextQuestion(state.answers);
  if (state.step !== null) {
    const node = DECISION_TREE.find((candidate) => candidate.id === state.step);
    if (node !== undefined && isNodeVisible(node, state.answers)) {
      if (state.answers[node.id] !== undefined) return { kind: "question", node, editing: true };
      if (node.id === next) return { kind: "question", node, editing: false };
    }
  }
  if (next === null) return { kind: "summary" };
  const node = DECISION_TREE.find((candidate) => candidate.id === next) as DecisionNode;
  return { kind: "question", node, editing: false };
}

/**
 * Record an answer and move on: dependants of a changed answer are pruned, and
 * the visitor lands on the first unanswered question — or the summary.
 */
export function applyAnswer(
  state: TreeState,
  question: QuestionId,
  option: string,
  guessed: boolean,
): TreeState {
  const answers = pruneAnswers({ ...state.answers, [question]: option });
  const flags = new Set(state.guessed);
  if (guessed) flags.add(question);
  else flags.delete(question);
  return { answers, guessed: keptGuesses(answers, flags), step: nextQuestion(answers) };
}

/** 1-based position of `node` among the questions this bike will be asked, and their count. */
export function positionOf(node: DecisionNode, answers: Answers): { step: number; total: number } {
  const questions = visibleQuestions(answers);
  const index = questions.findIndex((candidate) => candidate.id === node.id);
  return { step: index + 1, total: questions.length };
}

/** The answered, visible question just before `node`, or `null` on the first one. */
export function previousQuestion(node: DecisionNode, answers: Answers): QuestionId | null {
  let previous: QuestionId | null = null;
  for (const candidate of DECISION_TREE) {
    if (candidate.order >= node.order) break;
    if (answers[candidate.id] !== undefined && isNodeVisible(candidate, answers)) {
      previous = candidate.id;
    }
  }
  return previous;
}

/** The question ids a condition reads, in reading order, without duplicates. */
function questionsRead(condition: AnswerCondition): QuestionId[] {
  if ("q" in condition) return [condition.q];
  const children =
    "all" in condition ? condition.all : "any" in condition ? condition.any : [condition.not];
  return [...new Set(children.flatMap(questionsRead))];
}

/**
 * What "Je ne sais pas" picks here, and why: the answers the matching
 * conditional default is based on (`[{question: "discipline", option: "city-hybrid"}]`),
 * or none when the plain fallback applies.
 */
export function defaultChoice(
  node: DecisionNode,
  answers: Answers,
): { option: string; basedOn: Array<{ question: QuestionId; option: string }> } {
  const option = defaultOption(node, answers);
  const rule = node.default.when.find(
    (candidate) => candidate.option === option && evalCondition(candidate.when, answers),
  );
  const basedOn =
    rule === undefined
      ? []
      : questionsRead(rule.when).flatMap((question) => {
          // eslint-disable-next-line security/detect-object-injection -- a QuestionId read from the tree's own condition
          const answer = answers[question];
          return answer === undefined ? [] : [{ question, option: answer }];
        });
  return { option, basedOn };
}
