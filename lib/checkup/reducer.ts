/**
 * The checkup reducer (§5.4) — six events, one immutable state.
 *
 * Everything the wizard does to a checkup goes through here, which is why this
 * file carries a 100 % statements/branches gate (§5.8 AC7): it is the code that
 * decides what lands on somebody's to-fix list, and it runs in the browser
 * where nothing else validates it.
 *
 * ## Two rules worth stating out loud
 *
 * **A verdict of KO does not advance on its own.** Pressing "ça ne marche pas"
 * records the verdict and stays put, because the symptom radios are what turn
 * one KO into one line of the list (§6.5); choosing a symptom is what moves on.
 * "Ça marche" advances immediately — there is nothing more to say.
 *
 * **An event that changes nothing returns the same object.** `BACK` on step 1,
 * `JUMP` to a key that is not in the plan, `FINISH` with a question still open,
 * `SKIP` on a step the author marked unskippable: all of them return `state`
 * itself, so React re-renders nothing and a "nothing happened" is visible in a
 * test as identity rather than as a deep comparison.
 *
 * Re-answering re-opens a finished checkup (`completedAt` is cleared): a
 * verdict edited from the summary has to be followed by "Créer ma liste"
 * again, and the list that comes out is the one the visitor last agreed to.
 */
import { isToolId, TOOL_IDS, type ToolId } from "@/lib/domain/data/tools";
import type { BikeRef } from "@/lib/bike/resolve-bike-ref";
import type { Locale } from "@/lib/i18n/routing";

import {
  CHECKUP_STATE_VERSION,
  type CheckStepKey,
  type CheckStepRef,
  type CheckupAnswer,
  type CheckupEvent,
  type CheckupScope,
  type CheckupState,
} from "./types";

/** Longest note kept, matching `CheckupItem.notes` (`VarChar(2000)`). */
export const MAX_NOTE_LENGTH = 2000;

/** How many symptoms one step may carry — its own `ko[]` is the real bound. */
export const MAX_SYMPTOMS = 12;

export interface CreateCheckupInput {
  id: string;
  bikeRef: BikeRef;
  scope: CheckupScope;
  locale: Locale;
  steps: readonly CheckStepRef[];
  contentVersion: string;
  /** ISO 8601; defaults to now. */
  startedAt?: string;
}

/** A fresh checkup over `steps`: nothing answered, cursor on the first question. */
export function createCheckupState(input: CreateCheckupInput): CheckupState {
  return {
    id: input.id,
    bikeRef: input.bikeRef,
    scope: input.scope,
    locale: input.locale,
    steps: input.steps,
    cursor: 0,
    answers: {},
    symptoms: {},
    notes: {},
    toolsMissing: [],
    startedAt: input.startedAt ?? new Date().toISOString(),
    contentVersion: input.contentVersion,
    version: CHECKUP_STATE_VERSION,
  };
}

/** The value stored under `key`, without tripping the object-injection rule. */
function at<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** `record` with `key` set. */
function withEntry<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  value: T,
): Record<string, T> {
  return { ...record, [key]: value };
}

/** `record` without `key` — and the same object when it was not there. */
function withoutEntry<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): Readonly<Record<string, T>> {
  if (!Object.hasOwn(record, key)) return record;
  const next = { ...record };
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  delete next[key];
  return next;
}

/** Where `key` sits in the plan, or `-1`. */
export function indexOfStep(steps: readonly CheckStepRef[], key: CheckStepKey): number {
  return steps.findIndex((step) => step.key === key);
}

/** Has every question a verdict (answered or deliberately skipped)? */
export function allAnswered(state: CheckupState): boolean {
  return state.steps.every((step) => at(state.answers, step.key) !== undefined);
}

/** The symptoms of `event`, kept to the reasons this step actually offers. */
function normaliseSymptoms(step: CheckStepRef, symptoms: readonly string[] | undefined): string[] {
  if (symptoms === undefined) return [];
  const offered = new Set(step.ko.map((consequence) => consequence.reasonKey));
  const kept: string[] = [];
  for (const reasonKey of symptoms) {
    if (offered.has(reasonKey) && !kept.includes(reasonKey)) kept.push(reasonKey);
    if (kept.length === MAX_SYMPTOMS) break;
  }
  return kept;
}

/** A note as it is stored: trimmed and capped. */
function normaliseNote(notes: string | undefined): string | undefined {
  return notes === undefined ? undefined : notes.trim().slice(0, MAX_NOTE_LENGTH);
}

/** `notes` with the step's note set, cleared, or untouched. */
function applyNote(
  notes: Readonly<Record<CheckStepKey, string>>,
  key: CheckStepKey,
  note: string | undefined,
): Readonly<Record<CheckStepKey, string>> {
  if (note === undefined) return notes;
  return note === "" ? withoutEntry(notes, key) : withEntry(notes, key, note);
}

/** A verdict recorded on the step the visitor is looking at moves them on. */
function cursorAfterVerdict(state: CheckupState, index: number, advance: boolean): number {
  return advance && state.cursor === index ? index + 1 : state.cursor;
}

function record(
  state: CheckupState,
  index: number,
  result: CheckupAnswer,
  options: { symptoms?: string[]; note?: string | undefined; advance: boolean },
): CheckupState {
  // eslint-disable-next-line security/detect-object-injection -- `index` is a plan position from indexOfStep
  const key = state.steps[index].key;
  return {
    ...state,
    answers: withEntry(state.answers, key, result),
    symptoms:
      options.symptoms === undefined || options.symptoms.length === 0
        ? withoutEntry(state.symptoms, key)
        : withEntry(state.symptoms, key, options.symptoms),
    notes: applyNote(state.notes, key, options.note),
    cursor: cursorAfterVerdict(state, index, options.advance),
    // Editing a verdict re-opens the checkup: the list is rebuilt from the
    // answers the visitor last confirmed with "Créer ma liste".
    completedAt: undefined,
  };
}

/**
 * Apply one event.
 *
 * `now` is injected so a test can pin `completedAt` without fake timers; the
 * default is the only thing production ever passes.
 */
export function reduce(
  state: CheckupState,
  event: CheckupEvent,
  now: () => Date = () => new Date(),
): CheckupState {
  switch (event.type) {
    case "ANSWER": {
      const index = indexOfStep(state.steps, event.key);
      if (index < 0) return state;
      // eslint-disable-next-line security/detect-object-injection -- `index` is a plan position from indexOfStep
      const symptoms = normaliseSymptoms(state.steps[index], event.symptoms);
      return record(state, index, event.result, {
        symptoms: event.result === "ko" ? symptoms : [],
        note: normaliseNote(event.notes),
        // A KO with no symptom yet keeps the visitor on the step, where the
        // radios have just appeared. Everything else moves on.
        advance: event.result === "ok" || symptoms.length > 0,
      });
    }

    case "SKIP": {
      const index = indexOfStep(state.steps, event.key);
      if (index < 0) return state;
      // eslint-disable-next-line security/detect-object-injection -- `index` is a plan position from indexOfStep
      if (!state.steps[index].skippable) return state;
      return record(state, index, "skipped", { advance: true });
    }

    case "BACK":
      return state.cursor === 0 ? state : { ...state, cursor: state.cursor - 1 };

    case "JUMP": {
      const index = indexOfStep(state.steps, event.key);
      return index < 0 || index === state.cursor ? state : { ...state, cursor: index };
    }

    case "FINISH":
      if (!allAnswered(state)) return state;
      return { ...state, cursor: state.steps.length, completedAt: now().toISOString() };

    case "TOOL_MISSING": {
      if (!isToolId(event.toolId)) return state;
      if (state.toolsMissing.includes(event.toolId) === event.missing) return state;
      const toolsMissing = event.missing
        ? TOOL_IDS.filter(
            (toolId) => toolId === event.toolId || state.toolsMissing.includes(toolId),
          )
        : state.toolsMissing.filter((toolId) => toolId !== event.toolId);
      return { ...state, toolsMissing };
    }
  }

  // Unreachable for a well-typed event; reached by anything that arrives from
  // storage, a stale bundle or a hand-written payload.
  return state;
}

/** Apply a whole sequence — what the property test and the server replay do. */
export function reduceAll(
  state: CheckupState,
  events: readonly CheckupEvent[],
  now?: () => Date,
): CheckupState {
  return events.reduce((current, event) => reduce(current, event, now), state);
}

/** The tools the visitor said they do not have, as a set. */
export function missingToolSet(state: CheckupState): ReadonlySet<ToolId> {
  return new Set(state.toolsMissing);
}
