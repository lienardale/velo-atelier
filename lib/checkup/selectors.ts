/**
 * Read-side views over a `CheckupState` (§6.5) — what the wizard renders.
 *
 * Every one of them is a pure function of the state, so the wizard holds
 * exactly one piece of mutable data (the state) and nothing it shows can drift
 * from it. They live here rather than inside the components for the reason the
 * rest of this folder does: the rules about what a visitor sees — which symptom
 * radios, which tool substitutions, whether "Créer ma liste" is allowed yet —
 * are testable without a DOM, and the 100 % gate applies to them.
 */
import type { ToolId } from "@/lib/domain/data/tools";

import type {
  BuildAction,
  CheckStepKey,
  CheckStepRef,
  CheckupAnswer,
  CheckupState,
  ToolRef,
} from "./types";

/** The step the visitor is on, or `null` when they are on the summary. */
export function currentStep(state: CheckupState): CheckStepRef | null {
  return state.cursor >= 0 && state.cursor < state.steps.length ? state.steps[state.cursor] : null;
}

/** Is the cursor past the last question? */
export function isOnSummary(state: CheckupState): boolean {
  return state.cursor >= state.steps.length;
}

/** The verdict recorded for `key`, or `undefined`. */
export function verdictOf(state: CheckupState, key: CheckStepKey): CheckupAnswer | undefined {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(state.answers, key) ? state.answers[key] : undefined;
}

/** The symptoms ticked on `key`. */
export function symptomsOf(state: CheckupState, key: CheckStepKey): readonly string[] {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(state.symptoms, key) ? state.symptoms[key] : [];
}

/** The note written on `key`. */
export function noteOf(state: CheckupState, key: CheckStepKey): string {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(state.notes, key) ? state.notes[key] : "";
}

export interface CheckupProgress {
  /** How many questions have a verdict of any kind. */
  answered: number;
  total: number;
  ok: number;
  ko: number;
  skipped: number;
}

export function progressOf(state: CheckupState): CheckupProgress {
  const progress: CheckupProgress = {
    answered: 0,
    total: state.steps.length,
    ok: 0,
    ko: 0,
    skipped: 0,
  };
  for (const step of state.steps) {
    const verdict = verdictOf(state, step.key);
    if (verdict === undefined) continue;
    progress.answered += 1;
    if (verdict === "ok") progress.ok += 1;
    else if (verdict === "ko") progress.ko += 1;
    else progress.skipped += 1;
  }
  return progress;
}

/** "Créer ma liste" is allowed once every question has a verdict (§5.4). */
export function canFinish(state: CheckupState): boolean {
  return state.steps.length > 0 && progressOf(state).answered === state.steps.length;
}

/** One radio of the KO picker: a symptom, and what it will cost. */
export interface SymptomOption {
  reasonKey: string;
  /** The actions this reason implies, in the author's order. */
  actions: readonly BuildAction[];
  /** The parts it names — what the list will have a line for. */
  partIds: readonly string[];
  /** The guides that fix it, in the author's order. */
  guideSlugs: readonly string[];
}

/**
 * The symptoms a step offers, one per distinct `reasonKey`.
 *
 * Grouped by reason rather than listed per consequence, because "garniture trop
 * fine" is ONE thing the visitor recognises even when the author wrote it twice,
 * once for each wheel. Picking it still produces two lines — two pads to buy —
 * but it asks one question.
 */
export function symptomOptions(step: CheckStepRef): SymptomOption[] {
  const byReason = new Map<string, SymptomOption>();
  for (const consequence of step.ko) {
    const option = byReason.get(consequence.reasonKey);
    if (option === undefined) {
      byReason.set(consequence.reasonKey, {
        reasonKey: consequence.reasonKey,
        actions: [consequence.action],
        partIds: [consequence.partId],
        guideSlugs: consequence.guideSlug === undefined ? [] : [consequence.guideSlug],
      });
      continue;
    }
    if (!option.actions.includes(consequence.action)) {
      option.actions = [...option.actions, consequence.action];
    }
    if (!option.partIds.includes(consequence.partId)) {
      option.partIds = [...option.partIds, consequence.partId];
    }
    if (consequence.guideSlug !== undefined && !option.guideSlugs.includes(consequence.guideSlug)) {
      option.guideSlugs = [...option.guideSlugs, consequence.guideSlug];
    }
  }
  return [...byReason.values()];
}

/**
 * The substitutions to show inside a step: the tools it needs that the visitor
 * said they do not have, with what they can use instead (§6.5, §6.8 AC6).
 *
 * A missing tool with no stand-in is still returned — "you need a chain whip
 * and there is no way round it" is the honest answer, and the component says so.
 */
export function toolSubstitutions(step: CheckStepRef, missing: readonly ToolId[]): ToolRef[] {
  return step.tools.filter((tool) => missing.includes(tool.toolId));
}

/** The summary's three sections, in the order §6.5 shows them. */
export const SUMMARY_GROUPS = ["ko", "ok", "skipped"] as const;

export type SummaryGroup = (typeof SUMMARY_GROUPS)[number];

export interface SummarySection {
  group: SummaryGroup;
  steps: CheckStepRef[];
}

/** The answered steps grouped by verdict; unanswered ones belong to no group. */
export function summarySections(state: CheckupState): SummarySection[] {
  return SUMMARY_GROUPS.map((group) => ({
    group,
    steps: state.steps.filter((step) => verdictOf(state, step.key) === group),
  }));
}

/** The questions still open — what "reprendre" jumps to. */
export function openSteps(state: CheckupState): CheckStepRef[] {
  return state.steps.filter((step) => verdictOf(state, step.key) === undefined);
}

/** The step `?step=` names, when the plan still has it. */
export function stepIndexOf(state: CheckupState, key: string | null | undefined): number {
  if (key === null || key === undefined) return -1;
  return state.steps.findIndex((step) => step.key === key);
}
