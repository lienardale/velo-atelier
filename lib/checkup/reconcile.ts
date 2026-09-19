/**
 * Re-planning a checkup the visitor already started (§5.4).
 *
 * A stored checkup holds answers, not questions: the plan is recomputed from
 * `(spec, scope)` every time the page is opened, and `reconcile` is what marries
 * the two. Three things can have moved in between — the corpus grew a step, the
 * bike changed (a rim-brake bike became a disc one), a guide dropped a symptom —
 * and none of them may cost the visitor an answer they can still keep.
 *
 *   kept      an answer, note or symptom whose step is still planned;
 *   dropped   one whose step is gone, and a symptom whose reason the step no
 *             longer offers (a KO that keeps a reason the guide retired would
 *             put a line on the list that nothing can explain);
 *   appended  the new steps, simply by being in the fresh plan;
 *   cursor    the first question with no verdict — "carry on where you were",
 *             which is also where a brand-new step lands.
 *
 * `completedAt` survives only if the fresh plan is still fully answered: a
 * checkup that was finished and has grown a question is in progress again, and
 * the resume banner is right to come back.
 */
import type { CheckStepKey, CheckStepRef, CheckupAnswer, CheckupState } from "./types";

/** The index of the first step with no verdict, or `steps.length` (the summary). */
export function firstUnanswered(
  steps: readonly CheckStepRef[],
  answers: Readonly<Record<CheckStepKey, CheckupAnswer>>,
): number {
  const index = steps.findIndex((step) => !Object.hasOwn(answers, step.key));
  return index < 0 ? steps.length : index;
}

/** `record` restricted to the keys `keep` contains, order preserved. */
function keepKeys<T>(
  record: Readonly<Record<string, T>>,
  keep: ReadonlySet<string>,
): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => keep.has(key)));
}

/**
 * The stored answers against a freshly computed plan.
 *
 * `contentVersion` defaults to the state's own: pass the corpus's current
 * version (`lib/content/generated/version.ts`, read by the page) so a state
 * that has been reconciled stops claiming to be older than it is.
 */
export function reconcile(
  state: CheckupState,
  freshPlan: readonly CheckStepRef[],
  contentVersion: string = state.contentVersion,
): CheckupState {
  const byKey = new Map(freshPlan.map((step) => [step.key, step]));
  const keys = new Set(byKey.keys());

  const answers = keepKeys(state.answers, keys);
  const notes = keepKeys(state.notes, keys);
  const symptoms = Object.fromEntries(
    Object.entries(keepKeys(state.symptoms, keys)).flatMap(([key, reasons]) => {
      const offered = new Set(byKey.get(key)?.ko.map((consequence) => consequence.reasonKey));
      const kept = reasons.filter((reasonKey) => offered.has(reasonKey));
      return kept.length === 0 ? [] : [[key, kept] as const];
    }),
  );

  const complete =
    freshPlan.length > 0 && freshPlan.every((step) => Object.hasOwn(answers, step.key));

  return {
    ...state,
    steps: freshPlan,
    answers,
    symptoms,
    notes,
    cursor: firstUnanswered(freshPlan, answers),
    completedAt: complete ? state.completedAt : undefined,
    contentVersion,
  };
}
