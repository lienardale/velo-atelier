/**
 * What a checkup is ABOUT (§5.4; `.debug/017` §5.10, §5.11).
 *
 * Two questions, answered here and nowhere else:
 *
 *   inside the scope?   which parts a checkup limited to some parts may say
 *                       anything about — {@link partsInScope};
 *   which scope?        what a run's answers bear out, and what an unfinished
 *                       run is resumed on — {@link effectiveScope},
 *                       {@link resumeScope}.
 *
 * ## Inside the scope
 *
 * The parts the visitor picked, the host each one is reached through, and the
 * parts a picked host carries: pick the rear caliper and its pads are inside
 * (they have no mesh, they are picked through it — `hostPartId`, §1.2); pick
 * the rear pads and their caliper is; pick a tyre and its tube is. NOT the
 * other parts an unpicked host carries: the chainring and the bottom bracket
 * are both reached through the crankset, and picking the chainring says
 * nothing about the bearings.
 *
 * Every reader of a partial checkup goes through this one set, because the
 * PLAN does (`planCheckup`): a step is asked when it names a part inside, its
 * `partIds` are the hosts of the parts inside it names, and its `ko` keeps the
 * consequences about parts inside. What a checkup stores against a part
 * (`answeredItems`), the statuses it writes (`statusByPart`), the lines it
 * closes (`recheckedLines`) and derives (`deriveBuildList`) all read the plan,
 * so a checkup limited to the rear caliper says nothing about the front one —
 * on an account and on a guest bike alike. Until 2026-10-22 the scope chose
 * the QUESTIONS and nothing after that: a step about both calipers was asked
 * whole, and its OK wrote "Bon état" on the front caliper and lever, its KO
 * put both sides' pads on the list (`.debug/017` §5.11).
 *
 * A full checkup has no such set (`null`): it is about every part the bike
 * carries, exactly as before.
 *
 * ## Which scope a run is
 *
 * A run NAMES a scope — the one its page planned, posted back with every
 * save — and its answers may bear it out or not. {@link effectiveScope} is the
 * rule the actions, the import and the page share: the named scope while every
 * answered question is one that scope asks, the full checkup as soon as one is
 * not. A scope that names no part is read as naming nothing, never planned:
 * planned, it asks no question (`planCheckup` keeps that, and a caller that
 * acted on it once deleted every answer of a run — §5.10), so the server
 * refuses one and everything else reads it as "not confined to any part".
 *
 * {@link resumeScope} is what an unfinished run is resumed on when a page
 * opens it: the page's own scope when that scope asks every question the run
 * has answered (a reload on the same `?parts=`, the resume banner of a guest)
 * and the run was not a full one; otherwise the full checkup. The run wins
 * over the page — it is never trimmed to fit a narrower one — and a full run
 * is never narrowed into a partial one.
 *
 * Pure and zod-free, like the rest of this folder: the wizard imports it.
 */
import { PARTS, partDefinition, type PartId } from "@/lib/domain/data/parts";

import type { CheckStepKey, CheckupScope } from "./types";

/** The full checkup — what a scope becomes when its answers go beyond it. */
export const FULL_SCOPE: CheckupScope = { kind: "full" };

/** host → the parts it carries, from the catalogue's `hostPartId`. */
const CARRIED: ReadonlyMap<string, readonly PartId[]> = (() => {
  const carried = new Map<string, PartId[]>();
  for (const part of PARTS) {
    if (part.hostPartId === undefined) continue;
    carried.set(part.hostPartId, [...(carried.get(part.hostPartId) ?? []), part.id]);
  }
  return carried;
})();

/**
 * The parts a checkup limited to `scope` is about, or `null` for a full
 * checkup. Ids that are not parts are ignored, so a hand-written `?parts=`
 * widens nothing.
 */
export function partsInScope(scope: CheckupScope): ReadonlySet<string> | null {
  if (scope.kind === "full") return null;
  const inside = new Set<string>();
  for (const partId of scope.partIds) {
    const definition = partDefinition(partId);
    if (definition === undefined) continue;
    inside.add(definition.id);
    if (definition.hostPartId !== undefined) inside.add(definition.hostPartId);
    for (const carried of CARRIED.get(definition.id) ?? []) inside.add(carried);
  }
  return inside;
}

/** Does `scope` name at least one part? A `parts` scope naming none names nothing. */
export function namesParts(scope: CheckupScope): scope is { kind: "parts"; partIds: PartId[] } {
  return scope.kind === "parts" && scope.partIds.length > 0;
}

/**
 * The scope a run's answers bear out: `scope` while every answered question
 * is one it asks, the full checkup as soon as one is not — or when `scope`
 * names no part at all.
 *
 * `answered` is what the caller holds of the run, already restricted to the
 * questions the bike is still asked (a question the corpus dropped is not a
 * reason to widen). `asks` is called at most once, and never for a full scope
 * or one that names nothing.
 */
export function effectiveScope(
  scope: CheckupScope,
  answered: Iterable<CheckStepKey>,
  asks: () => ReadonlySet<CheckStepKey>,
): CheckupScope {
  if (!namesParts(scope)) return FULL_SCOPE;
  const asked = asks();
  for (const key of answered) if (!asked.has(key)) return FULL_SCOPE;
  return scope;
}

/** What {@link resumeScope} needs to know of the run a page is about to open. */
export interface ResumedRun {
  /** The scope the run was stored with — a saved bike's `PARTIAL` row reads as one naming no part. */
  scope: CheckupScope;
  /** Its answered questions that the bike is still asked. */
  answered: readonly CheckStepKey[];
}

/**
 * The scope an unfinished run is resumed on, by a page planned for `page`.
 *
 *   the page is a full checkup          → the full checkup;
 *   the run is a full one with answers  → the full checkup: a partial page
 *                                         never narrows it, and never trims it;
 *   otherwise                           → `effectiveScope(page, …)`: the
 *                                         page's scope when it asks every
 *                                         question the run has answered, the
 *                                         full checkup when it does not.
 */
export function resumeScope(
  run: ResumedRun,
  page: CheckupScope,
  pageAsks: () => ReadonlySet<CheckStepKey>,
): CheckupScope {
  if (page.kind === "full") return page;
  if (run.scope.kind === "full" && run.answered.length > 0) return FULL_SCOPE;
  return effectiveScope(page, run.answered, pageAsks);
}
