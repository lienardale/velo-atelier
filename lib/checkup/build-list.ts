/**
 * From verdicts to a to-fix list (§5.4) — `deriveBuildList` is W3-T1's half of
 * the contract; the list PAGE (W3-T2) consumes what comes out and never
 * recomputes it.
 *
 * One line per thing to do, and "one thing" is a `(action, partId)` pair:
 * the brake pads named by the wear question and again by the contamination
 * question are one line, not two. The id is
 *
 *     `${stepKey}|${partId}|${action}`
 *
 * built from the FIRST step that produced the pair — deterministic without
 * hashing (§5.4), stable when a later step adds the same pair, and meaningful
 * when it turns up in a database row or a test failure. `sourceKeys` keeps
 * every step that contributed, in plan order, which is what a recheck consults.
 *
 * ## What a KO actually produces
 *
 * A KO step offers the symptoms of its `checkQuestion.ko[]`. The visitor picks
 * one (§6.5's radios) and that reason's consequences are the ones that land:
 * "garniture trop fine" replaces the pads, "trace de gras" cleans them. The
 * same reason can name several parts — pads wear front AND rear — and that is
 * two lines, correctly, because it is two parts to buy.
 *
 * A KO with **no** symptom is a verdict the visitor gave and then left: the
 * step's whole `ko[]` lands, which is §5.4's literal "one per ko consequence"
 * and errs towards showing too much rather than losing the problem.
 *
 * ## Skipped never creates, and a later OK closes — a line that already EXISTS
 *
 * "Passer" produces nothing — the visitor did not look.
 *
 * `recheck-ok` (§5.4, §6.7) is about a line that was already on the list when
 * this checkup started: re-running the brake check a month later and saying the
 * pads are fine is what closes it. {@link markRechecked} takes the persisted
 * list for exactly that, and it is the list page's to call.
 *
 * `deriveBuildList` does NOT apply it to the lines it has just derived, and
 * that is a fix, not an omission. `(action, partId)` is the identity of a LINE,
 * not of a question: on the demo bike alone, `check-brakes-disc#lever-feel`
 * ("levier spongieux") and `check-brakes-disc#hose-leak` both name
 * `inspect-shop brake-line-front`, and so do `check-wheels-tires#wheel-true`
 * ("roue voilée") and `#hub-play`. Closing across them meant a visitor who
 * reported a spongy lever and then said the hose was not leaking got their one
 * finding back already ticked done — 22 such pairs in a full demo checkup. A
 * line derived from a KO in THIS state stays open; the visitor said so.
 *
 * ## One rule for what a checkup closes, on both paths
 *
 * {@link recheckedLines} is the whole of it: the `(action, partId)` pairs named
 * by the `ko[]` of a step answered OK, minus every pair a KO in the same state
 * derives. A guest's merge ({@link markRechecked}, {@link mergeGuestBuildList})
 * and an account's `closeRecheckedItems` (`app/[locale]/velo/[id]/controle/
 * actions.ts`) both close exactly those — by PAIR, never by part: the server
 * once closed every open line on any part a step answered OK, so a hosted part
 * (brake pads, reached through the caliper) never closed and a line with a
 * different action on the same part did. `tests/unit/checkup/
 * line-identity.test.ts` holds both paths to that rule over all seven presets.
 */
import type { PartId } from "@/lib/domain/data/parts";

import type { BuildAction, BuildListItem, CheckStepKey, CheckStepRef, CheckupState } from "./types";

/** `(action, partId)` — the identity of one line. */
function pairOf(action: BuildAction, partId: string): string {
  return `${action}|${partId}`;
}

/** The consequences a KO verdict on this step produces. */
function consequencesFor(
  step: CheckStepRef,
  symptoms: readonly string[] | undefined,
): CheckStepRef["ko"] {
  if (symptoms === undefined || symptoms.length === 0) return step.ko;
  return step.ko.filter((consequence) => symptoms.includes(consequence.reasonKey));
}

/** One line's identity, as the server's `BuildListItem` row and the recheck rule see it. */
export interface BuildLine {
  action: BuildAction;
  partId: PartId;
}

/** The pairs a KO in this state puts on the list — what {@link deriveBuildList} keys on. */
function derivedPairs(state: CheckupState): Set<string> {
  const pairs = new Set<string>();
  for (const step of state.steps) {
    if (answerOf(state, step.key) !== "ko") continue;
    for (const consequence of consequencesFor(step, symptomsOf(state, step.key))) {
      pairs.add(pairOf(consequence.action, consequence.partId));
    }
  }
  return pairs;
}

/**
 * The lines this checkup CLOSES on a list that existed before it (§5.4, §6.7):
 * every `(action, partId)` named by the `ko[]` of a step answered OK — "the
 * pads are fine" answers the question whose KO would have replaced them —
 * except the pairs a KO in this same state derives.
 *
 * The exception is what keeps a line alive when two questions of one checkup
 * name it and disagree (a spongy lever KO, a hose that does not leak OK, both
 * `inspect-shop brake-line-front`): the KO is a finding, the OK is a different
 * question, and the line stays open. In plan order, deduplicated.
 */
export function recheckedLines(state: CheckupState): BuildLine[] {
  const keep = derivedPairs(state);
  const seen = new Set<string>();
  const lines: BuildLine[] = [];
  for (const step of state.steps) {
    if (answerOf(state, step.key) !== "ok") continue;
    for (const consequence of step.ko) {
      const pair = pairOf(consequence.action, consequence.partId);
      if (keep.has(pair) || seen.has(pair)) continue;
      seen.add(pair);
      lines.push({ action: consequence.action, partId: consequence.partId as PartId });
    }
  }
  return lines;
}

/**
 * Close the lines of an EXISTING list that this checkup contradicts (§6.7) —
 * exactly the pairs of {@link recheckedLines}.
 *
 * The only fields read are `partId`, `action` and `done`, and an item the
 * visitor ticked by hand keeps its `manual` reason.
 */
export function markRechecked(
  items: readonly BuildListItem[],
  state: CheckupState,
): BuildListItem[] {
  const closes = new Set(recheckedLines(state).map((line) => pairOf(line.action, line.partId)));
  if (closes.size === 0) return [...items];
  return items.map((item) =>
    item.done || !closes.has(pairOf(item.action, item.partId))
      ? item
      : { ...item, done: true, doneReason: "recheck-ok" },
  );
}

function answerOf(state: CheckupState, key: CheckStepKey): string | undefined {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(state.answers, key) ? state.answers[key] : undefined;
}

function symptomsOf(state: CheckupState, key: CheckStepKey): readonly string[] | undefined {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(state.symptoms, key) ? state.symptoms[key] : undefined;
}

/**
 * The to-fix list this checkup implies, in plan order.
 *
 * Pure: the same state always yields the same items, ids included, which is
 * what lets the server derive the list independently of the browser that
 * answered the questions.
 */
export function deriveBuildList(state: CheckupState): BuildListItem[] {
  const byPair = new Map<string, BuildListItem>();

  for (const step of state.steps) {
    if (answerOf(state, step.key) !== "ko") continue;
    for (const consequence of consequencesFor(step, symptomsOf(state, step.key))) {
      const pair = pairOf(consequence.action, consequence.partId);
      const existing = byPair.get(pair);
      if (existing !== undefined) {
        if (!existing.sourceKeys.includes(step.key)) {
          existing.sourceKeys = [...existing.sourceKeys, step.key];
        }
        continue;
      }
      byPair.set(pair, {
        id: `${step.key}|${consequence.partId}|${consequence.action}`,
        stepKey: step.key,
        sourceKeys: [step.key],
        partId: consequence.partId as PartId,
        action: consequence.action,
        reasonKey: consequence.reasonKey,
        ...(consequence.guideSlug === undefined ? {} : { guideSlug: consequence.guideSlug }),
        done: false,
        sortOrder: byPair.size,
      });
    }
  }

  return [...byPair.values()];
}

/**
 * A guest's stored list, brought up to date by a checkup that has just finished.
 *
 * `va:buildlist:<ref>` holds ONE list per bike, so this is where a guest's
 * §5.4 "a later OK closes an open line" lives: the previous list is
 * {@link markRechecked} against the new state before anything is merged into
 * it. An account's equivalent is `finishCheckupAction`, which closes matching
 * open lines on the bike's other lists after writing this checkup's.
 *
 * Merged on `(action, partId)`, NOT on `id` — the id embeds the first step that
 * produced the line, and a re-run can reach the same line from a different
 * question. Deliberately the same key the server merges on
 * (`writeBuildList`), so the two agree.
 *
 * And, like the server, it treats a re-run of the SAME checkup differently from
 * a later one: `writeBuildList` prunes the lines its own checkup no longer
 * produces, while `closeRecheckedItems` only ever closes lines on OTHER lists.
 * A guest has one list key per bike, so `sameCheckup` is what carries that
 * distinction here.
 *
 * What survives from the previous line is what the visitor typed:
 * `refinement`, `chosenProduct` and its place in the list. What comes from the
 * new derivation is what the checkup found: `reasonKey`, `guideSlug`,
 * `sourceKeys`. Lines the checkup no longer produces are dropped, again as the
 * server does.
 *
 * ## A line a KO derived is open
 *
 * `done` survives only a re-run of the SAME checkup, and only when the visitor
 * ticked it — the server's `writeBuildList` never touches `done` on the list of
 * the checkup being re-finished. A LATER checkup whose KO derives the line
 * again is a new finding: the line comes back open, whatever closed it before,
 * exactly as it does on the fresh list the server writes for that checkup. And
 * a `recheck-ok` is never carried onto a line a KO derived: it is the bike's
 * earlier answer, and this KO is its newer one. Before W4 both were carried, so
 * a line could come back from a KO already ticked "closed by a recheck".
 */
export function mergeGuestBuildList(
  previous: readonly BuildListItem[],
  derived: readonly BuildListItem[],
  state: CheckupState,
  /** Did the SAME checkup write `previous`? (`StoredBuildList.checkupId`) */
  sameCheckup: boolean,
): BuildListItem[] {
  const before = new Map(
    markRechecked(previous, state).map((item) => [pairOf(item.action, item.partId), item]),
  );

  const ticked = (kept: BuildListItem) =>
    sameCheckup && kept.done && kept.doneReason !== "recheck-ok";
  const carry = (item: BuildListItem, kept: BuildListItem | undefined, sortOrder: number) =>
    kept === undefined
      ? { ...item, sortOrder }
      : {
          ...item,
          ...(ticked(kept)
            ? {
                done: true,
                ...(kept.doneReason === undefined ? {} : { doneReason: kept.doneReason }),
              }
            : {}),
          ...(kept.refinement === undefined ? {} : { refinement: kept.refinement }),
          ...(kept.chosenProduct === undefined ? {} : { chosenProduct: kept.chosenProduct }),
          sortOrder: kept.sortOrder,
        };

  const merged = derived.map((item, index) =>
    carry(item, before.get(pairOf(item.action, item.partId)), index),
  );
  if (sameCheckup) return merged;

  // A LATER checkup does not delete what an earlier one found — it can only
  // contradict it, which `markRechecked` has already recorded as
  // `recheck-ok`. Only a re-run of the same checkup prunes, because there the
  // missing line means the visitor withdrew the verdict that created it.
  const seen = new Set(merged.map((item) => pairOf(item.action, item.partId)));
  const survivors = [...before.values()].filter(
    (item) => !seen.has(pairOf(item.action, item.partId)),
  );
  return [...merged, ...survivors].map((item, index) => ({ ...item, sortOrder: index }));
}

/**
 * The per-part tint the viewer shows after a checkup (§6.4 `status`).
 *
 * Host-expanded, like `CheckStepRef.partIds`: a hosted part has no mesh of its
 * own, so its verdict colours the part it is reached through. KO wins over OK —
 * a caliper whose pads are worn is not fine because its alignment is — and a
 * step with no verdict yet leaves `todo`.
 */
export function statusByPart(state: CheckupState): Partial<Record<PartId, "ok" | "ko" | "todo">> {
  const status: Partial<Record<PartId, "ok" | "ko" | "todo">> = {};
  for (const step of state.steps) {
    const answer = answerOf(state, step.key);
    const tone = answer === "ko" ? "ko" : answer === "ok" ? "ok" : "todo";
    for (const partId of step.partIds) {
      /* eslint-disable security/detect-object-injection -- `partId` is a PartId from the plan */
      const current = status[partId];
      if (current === "ko") continue;
      if (current === "ok" && tone === "todo") continue;
      status[partId] = tone;
      /* eslint-enable security/detect-object-injection */
    }
  }
  return status;
}
