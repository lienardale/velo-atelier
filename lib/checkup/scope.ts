/**
 * What a checkup is ABOUT (§5.4; `.debug/017` §5.10, §5.11, §5.12).
 *
 * Two questions, answered here and nowhere else:
 *
 *   inside the scope?   which parts a checkup limited to some parts may say
 *                       anything about — {@link partsInScope};
 *   which scope?        what a run's answers bear out, and what an unfinished
 *                       run is resumed on — {@link effectiveScope},
 *                       {@link resumeTarget}, both by {@link holds}.
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
 * ## Does a scope hold a run?
 *
 * Since the rule above, ONE question key covers different parts under
 * different scopes: `check-brakes-disc#pad-wear` asked in a checkup limited to
 * the rear caliper is about the rear pads, asked for the front caliper it is
 * about the front ones. So a page holds a run's answers only if it asks each
 * of them about what it was given for — {@link holds}:
 *
 *   - the page asks the question (an answer to a question the bike is no
 *     longer asked at all is the corpus's doing, and decides nothing);
 *   - it still offers the symptom a KO was given with — a narrower step that
 *     withholds it would drop it, and the next save with it (`.debug/017`
 *     §5.12, R5: a worn rim track turned into "clean the front pads");
 *   - and, where the run says which part an answer is recorded against (a
 *     saved bike's `CheckupItem.partId`), that part is inside the page's
 *     scope.
 *
 * One exception, for runs answered before 2026-10-22 (§5.12, B6): the planner
 * of then asked a partial checkup every question whose hosts met a picked
 * part's — `hose-leak` for a caliper — and today's rule no longer asks some of
 * them (their every finding is outside). Such a question is TOUCHED by the
 * scope ({@link scopeFacts}); an OK or a skip given to it has nothing to say
 * about a part inside, widens nothing, and is left out of the run's state —
 * the third reason an answer is dropped, beside a withdrawn verdict and a
 * question the corpus dropped. A KO there widens the run like any other: its
 * finding is kept.
 *
 * ## Which scope a run is
 *
 * A run NAMES a scope — the one its page planned, posted back with every
 * save — and its answers may bear it out or not. {@link effectiveScope} is the
 * rule the actions and the import share: the named scope while it holds the
 * run, the full checkup as soon as it does not. A scope that names no part is
 * read as naming nothing, never planned: planned, it asks no question
 * (`planCheckup` keeps that, and a caller that acted on it once deleted every
 * answer of a run — §5.10), so the server refuses one and everything else
 * reads it as "not confined to any part".
 *
 * {@link resumeTarget} is where an unfinished run is resumed when a page opens
 * it: the page's own scope when the page holds it; otherwise
 *
 *   - for a run that KNOWS its parts — a guest's, whose scope is stored whole —
 *     the run's own parts ({@link sameParts} is what tells), and from there the
 *     full checkup only when none of its answers was given for some of the
 *     parts its question names (then the full checkup asks every one of them
 *     about exactly what it was given for);
 *   - for a run that does NOT — a saved bike's `PARTIAL` row records no parts —
 *     the full checkup, which loses no answer and is said on screen, naming
 *     the questions whose answers now count for every part. That is not exact:
 *     an answer given for the rear pads then counts for both. Exact needs the
 *     row to record its parts, a column (`.debug/017` §5.12, escalated).
 *
 * A full run with answers is never narrowed into a partial one.
 *
 * Pure and zod-free, like the rest of this folder: the wizard imports it.
 */
import { clickTargetOf, PARTS, partDefinition, type PartId } from "@/lib/domain/data/parts";

import type { CheckStepKey, CheckStepRef, CheckupAnswer, CheckupScope } from "./types";

/** The full checkup — what a scope becomes when its answers go beyond it. */
export const FULL_SCOPE: CheckupScope = { kind: "full" };

/** A scope that names parts. */
export type PartsScope = Extract<CheckupScope, { kind: "parts" }>;

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
export function namesParts(scope: CheckupScope): scope is PartsScope {
  return scope.kind === "parts" && scope.partIds.length > 0;
}

/**
 * Do two scopes cover the same parts? Then the planner asks every question of
 * them alike — narrowed the same way, with the same symptoms — because a plan
 * depends on its scope only through {@link partsInScope}. Two full checkups
 * do; a full checkup and a partial one do not.
 */
export function sameParts(left: CheckupScope, right: CheckupScope): boolean {
  const ours = partsInScope(left);
  const theirs = partsInScope(right);
  if (ours === null || theirs === null) return ours === theirs;
  return ours.size === theirs.size && [...ours].every((partId) => theirs.has(partId));
}

/** The hosts the picked parts of `scope` are reached through — the meshes the visitor ticked. */
function pickedHosts(scope: PartsScope): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const partId of scope.partIds) {
    const definition = partDefinition(partId);
    if (definition !== undefined) hosts.add(clickTargetOf(definition.id));
  }
  return hosts;
}

/**
 * What a page knows of its scope against the bike's full checkup — plain
 * data, so that the page can hand it to the wizard, which decides for a guest
 * whose run it cannot read on the server.
 */
export interface ScopeFacts {
  /**
   * Every question the bike's full checkup asks. An answer to any other is to
   * a question the corpus dropped: it is dropped too, and decides nothing.
   */
  asked: readonly CheckStepKey[];
  /**
   * The questions this scope TOUCHES — the step's hosts meet a picked part's —
   * and does not ask: what the planner of before 2026-10-22 asked a partial
   * checkup and today's rule narrows away (`hose-leak` for a caliper, the
   * bottom bracket's two for the chainring). An OK or a skip given to one
   * widens nothing (see the header).
   */
  touched: readonly CheckStepKey[];
  /**
   * Per question this scope asks NARROWED, the symptoms the full checkup
   * offers and this scope does not: a KO given with one of them is not held.
   * A symptom neither offers is one the corpus retired, and decides nothing.
   */
  withheld: Readonly<Record<CheckStepKey, readonly string[]>>;
}

/** {@link ScopeFacts} of `scope`, from the bike's `full` plan and the scope's own `scoped` one. */
export function scopeFacts(
  scope: CheckupScope,
  full: readonly CheckStepRef[],
  scoped: readonly CheckStepRef[],
): ScopeFacts {
  const planned = new Map(scoped.map((step) => [step.key, step]));
  const hosts = scope.kind === "full" ? null : pickedHosts(scope);
  const touched: CheckStepKey[] = [];
  const withheld = new Map<CheckStepKey, string[]>();
  for (const step of full) {
    const mine = planned.get(step.key);
    if (mine === undefined) {
      if (hosts !== null && step.partIds.some((host) => hosts.has(host))) touched.push(step.key);
      continue;
    }
    const offered = new Set(mine.ko.map((consequence) => consequence.reasonKey));
    const missing = [...new Set(step.ko.map((consequence) => consequence.reasonKey))].filter(
      (reasonKey) => !offered.has(reasonKey),
    );
    if (missing.length > 0) withheld.set(step.key, missing);
  }
  return { asked: full.map((step) => step.key), touched, withheld: Object.fromEntries(withheld) };
}

/** A run's answers, as the rule reads them. */
export interface RunAnswers {
  answers: Readonly<Record<CheckStepKey, CheckupAnswer>>;
  symptoms: Readonly<Record<CheckStepKey, readonly string[]>>;
  /**
   * The part each answer is recorded against, where the caller read it from a
   * row — a saved bike's `CheckupItem.partId`. Absent for an answer a page
   * holds in memory: a payload's, a guest's storage.
   */
  recordedFor?: Readonly<Record<CheckStepKey, string>>;
}

/** `record[key]`, own properties only. */
function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * Does `scope`, whose plan is `scoped`, hold every answer of `run` as it was
 * given? See the header: each answered question still asked, with the
 * symptom a KO was given with, recorded against a part inside — a touched
 * question's OK or skip aside. A full checkup holds every run.
 */
export function holds(
  scope: CheckupScope,
  run: RunAnswers,
  scoped: readonly CheckStepRef[],
  facts: ScopeFacts,
): boolean {
  const inside = partsInScope(scope);
  const planned = new Set(scoped.map((step) => step.key));
  const asked = new Set(facts.asked);
  const touched = new Set(facts.touched);
  for (const [key, answer] of Object.entries(run.answers)) {
    if (!asked.has(key)) continue;
    if (!planned.has(key)) {
      if (touched.has(key) && answer !== "ko") continue;
      return false;
    }
    const withheld = own(facts.withheld, key) ?? [];
    if (answer === "ko" && (own(run.symptoms, key) ?? []).some((r) => withheld.includes(r))) {
      return false;
    }
    const recorded = own(run.recordedFor, key);
    if (inside !== null && recorded !== undefined && !inside.has(recorded)) return false;
  }
  return true;
}

/**
 * The scope a run's answers bear out: `scope` while it {@link holds} them,
 * the full checkup as soon as it does not — or when `scope` names no part at
 * all. `plan` is called at most once, and never for a full scope or one that
 * names nothing.
 */
export function effectiveScope(
  scope: CheckupScope,
  run: RunAnswers,
  plan: () => { scoped: readonly CheckStepRef[]; facts: ScopeFacts },
): CheckupScope {
  if (!namesParts(scope)) return FULL_SCOPE;
  const { scoped, facts } = plan();
  return holds(scope, run, scoped, facts) ? scope : FULL_SCOPE;
}

/** What {@link resumeTarget} needs to know of the run a page is about to open. */
export interface ResumedRun extends RunAnswers {
  /** The scope the run was stored with — a saved bike's `PARTIAL` row reads as one naming no part. */
  scope: CheckupScope;
  /**
   * Does the run know its parts? A guest's does: its scope is stored whole. A
   * saved bike's does not: `Checkup.scope` is `FULL | PARTIAL`.
   */
  knowsItsParts: boolean;
}

/** Where an unfinished run is resumed — see {@link resumeTarget}. */
export type ResumeTarget = { kind: "page" } | { kind: "full" } | { kind: "own"; scope: PartsScope };

const PAGE: ResumeTarget = { kind: "page" };
const FULL: ResumeTarget = { kind: "full" };

/**
 * How the visitor reached this page, when the wizard sent them: `full`, for a
 * run the parts asked for could not hold (`?resume=full`); `own`, for a run
 * brought back to its own parts (`?resume=own`). `null` for any other visit.
 */
export type ResumeArrival = "full" | "own" | null;

/** Is one of the run's answers to a question `scoped` asks of only some of the parts it names? */
function narrowedAnswer(run: RunAnswers, scoped: readonly CheckStepRef[]): boolean {
  return scoped.some(
    (step) => step.coveredParts !== undefined && Object.hasOwn(run.answers, step.key),
  );
}

/**
 * Where the unfinished `run` is resumed by a page planned for `page` (its plan
 * `scoped`, its {@link ScopeFacts} `facts`):
 *
 *   no answer the bike is still asked   → the page: there is nothing to keep;
 *   a full run                           → the full checkup: a partial page
 *                                          never narrows it, never trims it;
 *   a run that knows its parts, opened
 *   on other parts or on the full page   → its own parts (`own`), unless the
 *                                          wizard has just sent it here;
 *   …back on its own parts from there    → the full checkup when no answer was
 *                                          given for only some of the parts
 *                                          its question names, which is the
 *                                          one case a full checkup asks every
 *                                          answered question about what it was
 *                                          given for; its own parts otherwise;
 *   the page holds it                    → the page;
 *   otherwise                            → the full checkup.
 */
export function resumeTarget(
  run: ResumedRun,
  page: CheckupScope,
  scoped: readonly CheckStepRef[],
  facts: ScopeFacts,
  arrived: ResumeArrival = null,
): ResumeTarget {
  const asked = new Set(facts.asked);
  if (!Object.keys(run.answers).some((key) => asked.has(key))) return PAGE;
  if (run.scope.kind === "full") return page.kind === "full" ? PAGE : FULL;
  if (run.knowsItsParts && namesParts(run.scope)) {
    if (!sameParts(run.scope, page)) {
      if (arrived === null) return { kind: "own", scope: run.scope };
    } else if (arrived === "own") {
      if (!holds(page, run, scoped, facts)) return FULL;
      return narrowedAnswer(run, scoped) ? PAGE : FULL;
    }
  }
  if (page.kind === "full") return PAGE;
  return holds(page, run, scoped, facts) ? PAGE : FULL;
}
