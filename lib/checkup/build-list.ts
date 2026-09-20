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

/** Could an OK on this step have closed a line about `(action, partId)`? */
function answers(step: CheckStepRef, item: Pick<BuildListItem, "partId" | "action">): boolean {
  return step.ko.some(
    (consequence) => consequence.partId === item.partId && consequence.action === item.action,
  );
}

/**
 * Close the lines of an EXISTING list that a fresh set of OK verdicts
 * contradicts (§6.7).
 *
 * For persisted rows only — the list page hands in what it stored before this
 * checkup ran. Never for the lines `deriveBuildList` has just produced from the
 * same state (see this file's header): there, an OK is a different question,
 * not a recheck.
 *
 * The only fields read are `partId`, `action` and `done`, and an item the
 * visitor ticked by hand keeps its `manual` reason.
 */
export function markRechecked(
  items: readonly BuildListItem[],
  state: CheckupState,
): BuildListItem[] {
  const cleared = state.steps.filter((step) => answerOf(state, step.key) === "ok");
  if (cleared.length === 0) return [...items];
  return items.map((item) =>
    item.done || !cleared.some((step) => answers(step, item))
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
 * What survives from the previous line is what the visitor typed: `done`,
 * `doneReason`, `refinement`, `chosenProduct` and its place in the list. What
 * comes from the new derivation is what the checkup found: `reasonKey`,
 * `guideSlug`, `sourceKeys`. Lines the checkup no longer produces are dropped,
 * again as the server does.
 */
export function mergeGuestBuildList(
  previous: readonly BuildListItem[],
  derived: readonly BuildListItem[],
  state: CheckupState,
): BuildListItem[] {
  const before = new Map(
    markRechecked(previous, state).map((item) => [pairOf(item.action, item.partId), item]),
  );

  return derived.map((item, index) => {
    const kept = before.get(pairOf(item.action, item.partId));
    if (kept === undefined) return { ...item, sortOrder: index };
    return {
      ...item,
      done: kept.done,
      ...(kept.doneReason === undefined ? {} : { doneReason: kept.doneReason }),
      ...(kept.refinement === undefined ? {} : { refinement: kept.refinement }),
      ...(kept.chosenProduct === undefined ? {} : { chosenProduct: kept.chosenProduct }),
      sortOrder: kept.sortOrder,
    };
  });
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
