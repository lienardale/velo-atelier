/**
 * What a checkup is ABOUT (§5.4; `.debug/017` §5.10, §5.11, §5.12, §5.13).
 *
 * Two questions, answered here and nowhere else:
 *
 *   inside the scope?   which parts a checkup limited to some parts may say
 *                       anything about — {@link partsInScope};
 *   which scope?        what a run's answers bear out, and what an unfinished
 *                       run is resumed on — {@link effectiveScope},
 *                       {@link guestResumeTarget}, {@link savedResumeTarget}, all by
 *                       {@link holds}.
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
 *     saved bike's `CheckupItem.partId`), the page would record it against
 *     that same part — the first part its question reports on there. A row
 *     recorded against the rear caliper is not held by a page that asks its
 *     question about both calipers, whose row would name the front one
 *     (`.debug/017` §5.13: until then "the part is inside the page" was
 *     enough, and a rear-only OK closed the front pads' line).
 *
 * One exception, for runs answered before 2026-10-22 (§5.12, B6): the planner
 * of then asked a partial checkup every question whose hosts met a picked
 * part's — `hose-leak` for a caliper — and today's rule no longer asks some of
 * them (their every finding is outside). Such a question is TOUCHED by the
 * scope ({@link scopeFacts}); an OK or a skip given to it has nothing to say
 * about a part inside and widens nothing. It is KEPT — in a guest's storage,
 * as a saved bike's row, as an imported row — and never acted on: no status,
 * no line (§5.13, V1-3: until then a guest's copy was dropped at the next
 * save, and the import left it out). A KO there widens the run like any
 * other: its finding is kept and acted on, by the full checkup.
 *
 * ## Which scope a run is
 *
 * A run NAMES a scope — the one its page planned, posted back with every
 * save — and its answers may bear it out or not. {@link effectiveScope} is the
 * rule the actions share: the named scope while it holds the run, the full
 * checkup as soon as it does not. A scope that names no part is read as
 * naming nothing, never planned: planned, it asks no question (`planCheckup`
 * keeps that, and a caller that acted on it once deleted every answer of a
 * run — §5.10), so the server refuses one and everything else reads it as
 * "not confined to any part".
 *
 * Where an unfinished run is resumed depends on what is known of the parts it
 * was opened on:
 *
 *   - a GUEST's run knows them — its scope is stored whole. It is resumed on
 *     them and nowhere else ({@link guestResumeTarget}): opened anywhere else, it
 *     is sent back to its own parts, whatever the address says it came for
 *     (§5.13, V1-1: a stale `?resume=own` once held a front-caliper run on the
 *     rear caliper); and on from there to the full checkup only when the full
 *     checkup asks every one of its answers about what it was given for —
 *     which the full page checks again for itself, from the parts its own
 *     address names, rather than taking `?resume=full` at its word (V1-2);
 *   - a SAVED bike's run does not: `Checkup.scope` is `FULL | PARTIAL`, and
 *     there is no column for the parts. {@link savedResumeTarget} reads them
 *     from two things that can say it. The page's own address, when it
 *     carries the run's `startedAt` (`?run=`, written by the wizard beside
 *     `?parts=` on the page that shows the run — a reload, Back, Forward).
 *     And the run's rows, when they tell ({@link recordedScope}): each row
 *     names the FIRST part its question reported on in the run's scope, so a
 *     row on the rear caliper says the run was about the rear pads and not
 *     the front ones, while a row on the front caliper cannot tell the front
 *     caliper alone from both — nor from any part at all, for a row written
 *     before 2026-10-22, which always named the first. Told, the run is
 *     resumed on those parts (§5.13, B1/B2/RA-3); not told, on the full
 *     checkup, which loses no answer, says so, and puts the answers it now
 *     counts for every part their question names back in front of the
 *     visitor (RA-1).
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

/**
 * A planned question as the rule reads it: its key, the parts it reports on
 * (hosts, first one first) and — when the scope left some out — the parts its
 * verdict is recorded for. What the page hands the wizard of a plan it does
 * not show (`WizardProps.widenedFrom`).
 */
export type PlannedQuestion = Pick<CheckStepRef, "key" | "partIds" | "coveredParts">;

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

/**
 * `scope` with only the ids the catalogue knows, once each — what a page
 * planning it from `?parts=` reads back (`parsePartIds`) — or `null` when that
 * leaves no part. A run is sent back to its own parts only through this: an
 * address the page would read as something else would send it back again.
 */
export function knownParts(scope: CheckupScope): PartsScope | null {
  if (scope.kind === "full") return null;
  const ids: PartId[] = [];
  for (const partId of scope.partIds) {
    const definition = partDefinition(partId);
    if (definition !== undefined && !ids.includes(definition.id)) ids.push(definition.id);
  }
  return ids.length === 0 ? null : { kind: "parts", partIds: ids };
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
 * The part an answer to a question `scope` only TOUCHES is recorded against:
 * the first part the whole question reports on that the scope picked — the
 * rear caliper, for `hose-leak` in a rear-caliper checkup. `undefined` when
 * the scope does not touch it.
 */
export function touchedPart(scope: PartsScope, step: PlannedQuestion): PartId | undefined {
  const hosts = pickedHosts(scope);
  return step.partIds.find((host) => hosts.has(host));
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
   * widens nothing and is kept, unacted on (see the header).
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
  const touched: CheckStepKey[] = [];
  const withheld = new Map<CheckStepKey, string[]>();
  for (const step of full) {
    const mine = planned.get(step.key);
    if (mine === undefined) {
      if (scope.kind === "parts" && touchedPart(scope, step) !== undefined) touched.push(step.key);
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

/** Has the run an answer to a question the bike is still asked? */
function answersAnything(run: RunAnswers, facts: ScopeFacts): boolean {
  const asked = new Set(facts.asked);
  return Object.keys(run.answers).some((key) => asked.has(key));
}

/**
 * Does `scope`, whose plan is `scoped`, hold every answer of `run` as it was
 * given? See the header: each answered question still asked, with the
 * symptom a KO was given with, recorded against the part the scope would
 * record it against — a touched question's OK or skip aside. A full checkup
 * holds every run.
 */
export function holds(
  scope: CheckupScope,
  run: RunAnswers,
  scoped: readonly PlannedQuestion[],
  facts: ScopeFacts,
): boolean {
  const planned = new Map(scoped.map((step) => [step.key, step]));
  const asked = new Set(facts.asked);
  const touched = new Set(facts.touched);
  for (const [key, answer] of Object.entries(run.answers)) {
    if (!asked.has(key)) continue;
    const step = planned.get(key);
    if (step === undefined) {
      if (touched.has(key) && answer !== "ko") continue;
      return false;
    }
    const withheld = own(facts.withheld, key) ?? [];
    if (answer === "ko" && (own(run.symptoms, key) ?? []).some((r) => withheld.includes(r))) {
      return false;
    }
    const recorded = own(run.recordedFor, key);
    if (scope.kind === "parts" && recorded !== undefined && step.partIds[0] !== recorded) {
      return false;
    }
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
  plan: () => { scoped: readonly PlannedQuestion[]; facts: ScopeFacts },
): CheckupScope {
  if (!namesParts(scope)) return FULL_SCOPE;
  const { scoped, facts } = plan();
  return holds(scope, run, scoped, facts) ? scope : FULL_SCOPE;
}

/** Is one of the run's answers to a question `scoped` asks of only some of the parts it names? */
export function narrowedAnswer(run: RunAnswers, scoped: readonly PlannedQuestion[]): boolean {
  return scoped.some(
    (step) => step.coveredParts !== undefined && Object.hasOwn(run.answers, step.key),
  );
}

/**
 * Does the full checkup take over a run whose parts are `scope` (its plan
 * `scoped`) — asking every one of its answers about what it was given for, or
 * being the only page that holds them? Then a visitor who came for other
 * parts carries on there rather than on the run's own parts: nothing it
 * counts an answer for is more than that answer was given for.
 *
 *   - `scope` does not hold the run: a run of before 2026-10-22, answered
 *     beyond its parts (§5.10, R1), or with a touched KO or a withheld
 *     symptom (§5.12) — its answers were given to whole questions;
 *   - or no answer is to a question `scope` asks of only some of its parts.
 */
export function carriedOnWhole(
  run: RunAnswers,
  scope: CheckupScope,
  scoped: readonly PlannedQuestion[],
  facts: ScopeFacts,
): boolean {
  return !holds(scope, run, scoped, facts) || !narrowedAnswer(run, scoped);
}

/** Where an unfinished run is resumed. */
export type ResumeTarget =
  | { kind: "page" }
  /** The full checkup; `from`, the parts a partial run was opened on. */
  | { kind: "full"; from?: PartsScope }
  | { kind: "own"; scope: PartsScope };

const PAGE: ResumeTarget = { kind: "page" };
const FULL: ResumeTarget = { kind: "full" };

/** A plan of a scope the page is NOT showing, with what that scope is against the full plan. */
export interface OtherPlan {
  scope: PartsScope;
  steps: readonly PlannedQuestion[];
  facts: ScopeFacts;
}

/** What {@link guestResumeTarget} needs to know of the run a page is about to open. */
export interface GuestRun extends RunAnswers {
  /** The scope the run was stored with — whole, in `localStorage`. */
  scope: CheckupScope;
}

/**
 * Where a GUEST's unfinished `run` is resumed by a page planned for `page`
 * (its plan `scoped`, its {@link ScopeFacts} `facts`):
 *
 *   no answer the bike is still asked   → the page: there is nothing to keep;
 *   a full run                           → the full checkup: a partial page
 *                                          never narrows it, never trims it;
 *   a partial run on other parts         → its own parts (`own`), whatever
 *                                          the address says it came for —
 *                                          but on the full checkup reached
 *                                          FOR it (`widenedFrom`: the run's
 *                                          own parts, planned by the page
 *                                          from `?parts=`) when the full
 *                                          checkup takes it over
 *                                          ({@link carriedOnWhole});
 *   on its own parts, sent there         → the full checkup when it takes the
 *   (`arrivedOwn`)                         run over, the page otherwise;
 *   on its own parts                     → the page when it holds the run,
 *                                          the full checkup otherwise.
 *
 * Nothing the address says decides which part an answer counts for: `?resume=`
 * only chooses between two pages that both ask every answer about what it was
 * given for (`.debug/017` §5.13, V1-1 and V1-2 — the address was once taken
 * at its word, and a stale one moved a run's answers).
 */
export function guestResumeTarget(
  run: GuestRun,
  page: CheckupScope,
  scoped: readonly PlannedQuestion[],
  facts: ScopeFacts,
  {
    arrivedOwn = false,
    widenedFrom = null,
  }: { arrivedOwn?: boolean; widenedFrom?: OtherPlan | null } = {},
): ResumeTarget {
  if (!answersAnything(run, facts)) return PAGE;
  if (run.scope.kind === "full") return page.kind === "full" ? PAGE : FULL;
  const mine = knownParts(run.scope);
  if (mine === null) {
    // A scope that names no part the catalogue knows: not confined to any.
    if (page.kind === "full") return PAGE;
    return holds(page, run, scoped, facts) ? PAGE : FULL;
  }
  if (!sameParts(mine, page)) {
    const takenOver =
      page.kind === "full" &&
      widenedFrom !== null &&
      sameParts(mine, widenedFrom.scope) &&
      carriedOnWhole(run, widenedFrom.scope, widenedFrom.steps, widenedFrom.facts);
    return takenOver ? PAGE : { kind: "own", scope: mine };
  }
  if (arrivedOwn) {
    return carriedOnWhole(run, page, scoped, facts) ? { kind: "full", from: mine } : PAGE;
  }
  return holds(page, run, scoped, facts) ? PAGE : { kind: "full", from: mine };
}

/**
 * The parts a saved bike's run was opened on, as far as its rows can tell —
 * or `null` when they cannot.
 *
 * Each row names the FIRST part its question reported on in the run's scope
 * (`answeredItems`), among the hosts the whole question names in a fixed
 * order (`full`). So a row tells two things:
 *
 *   named      its part was picked;
 *   excluded   every host the question names BEFORE it was not.
 *
 * The hosts the question names AFTER it are the doubt: the rear caliper is
 * the last of `pad-wear`'s two, so a row there is about the rear pads alone;
 * the front caliper is the first, so a row there is the front pads' or both
 * pads' — and a row written before 2026-10-22, which named the first host
 * whatever was picked, could be anything's. The rows answer each other's
 * doubt: a later host another row names, or another row excludes, is settled.
 *
 * The parts are told when every answered row's doubt is settled, the named
 * hosts excluded by none, and the named hosts planned as a scope give each
 * row back its own part (`plan` — a question only touched there by the first
 * host it names that was picked, {@link touchedPart}). Then that scope asks
 * every answered question about the parts it was asked about in the run
 * (this assumes a question reports on one part per host, which the corpus
 * does, and `tests/unit/checkup/recorded-scope.test.ts` replays on every
 * preset). The scope is the hosts the rows name — the parts the run has
 * ANSWERED about, which may be fewer than the ones it was opened on: those
 * had no answer to keep.
 */
export function recordedScope(
  run: RunAnswers,
  full: readonly PlannedQuestion[],
  plan: (scope: PartsScope) => readonly PlannedQuestion[],
): PartsScope | null {
  const byKey = new Map(full.map((step) => [step.key, step]));
  const rows: { step: PlannedQuestion; hosts: readonly string[]; at: number }[] = [];
  for (const key of Object.keys(run.answers)) {
    const step = byKey.get(key);
    if (step === undefined) continue;
    const hosts: readonly string[] = step.partIds;
    const recorded = own(run.recordedFor, key);
    const at = recorded === undefined ? -1 : hosts.indexOf(recorded);
    if (at < 0) return null;
    rows.push({ step, hosts, at });
  }
  if (rows.length === 0) return null;

  const named = new Set(rows.map((row) => row.hosts[row.at]));
  const excluded = new Set(rows.flatMap((row) => row.hosts.slice(0, row.at)));
  if ([...named].some((host) => excluded.has(host))) return null;
  const settled = rows.every((row) =>
    row.hosts.slice(row.at + 1).every((host) => named.has(host) || excluded.has(host)),
  );
  if (!settled) return null;

  const scope: PartsScope = {
    kind: "parts",
    partIds: PARTS.filter((part) => named.has(part.id)).map((part) => part.id),
  };
  const planned = new Map(plan(scope).map((step) => [step.key, step]));
  for (const row of rows) {
    const mine = planned.get(row.step.key);
    const first = mine === undefined ? touchedPart(scope, row.step) : mine.partIds[0];
    if (first !== row.hosts[row.at]) return null;
  }
  return scope;
}

/** Do two plans ask every answered question about the same parts, with the same findings? */
export function sameEffects(
  run: RunAnswers,
  left: readonly CheckStepRef[],
  right: readonly CheckStepRef[],
): boolean {
  const ours = new Map(left.map((step) => [step.key, step]));
  const theirs = new Map(right.map((step) => [step.key, step]));
  const findings = (step: CheckStepRef): string =>
    step.ko
      .map((consequence) => `${consequence.action}|${consequence.partId}|${consequence.reasonKey}`)
      .sort()
      .join(",");
  return Object.keys(run.answers).every((key) => {
    const a = ours.get(key);
    const b = theirs.get(key);
    if (a === undefined || b === undefined) return a === b;
    return a.partIds.join(",") === b.partIds.join(",") && findings(a) === findings(b);
  });
}

/** What {@link savedResumeTarget} needs to know of a saved bike's run. */
export interface SavedRun extends RunAnswers {
  /** `Checkup.scope`: a `PARTIAL` row reads as a scope naming no part. */
  scope: CheckupScope;
}

/** What tells a saved bike's run's parts — see {@link savedResumeTarget}. */
export interface SavedRunEvidence {
  /**
   * The page's address carries the run's `startedAt` (`?run=`): the wizard
   * wrote it beside `?parts=` on the page that showed this run — so its
   * parts are the run's own.
   */
  ownAddress: boolean;
  /** {@link recordedScope}, planned — `null` when the rows cannot tell. */
  recorded: (OtherPlan & { steps: readonly CheckStepRef[] }) | null;
}

/**
 * Where a SAVED bike's unfinished `run` is resumed by a page planned for
 * `page` (its plan `scoped`, its facts `facts`). Decided on the server, from
 * the rows:
 *
 *   no answer the bike is still asked   → the page;
 *   a full run                           → the full checkup, never narrowed;
 *   the page's address is the run's own,
 *   and the page holds the run           → the page (a reload, Back, Forward);
 *   the rows cannot tell its parts       → the full checkup, which loses no
 *                                          answer — said on screen, the
 *                                          answers it now counts for every
 *                                          part their question names put back
 *                                          in front of the visitor;
 *   the page holds the run, asking every
 *   answer as its parts did              → the page;
 *   the full checkup takes it over
 *   ({@link carriedOnWhole})             → the full checkup;
 *   otherwise                            → its parts (`own`), planned there
 *                                          by the page itself.
 */
export function savedResumeTarget(
  run: SavedRun,
  page: CheckupScope,
  scoped: readonly CheckStepRef[],
  facts: ScopeFacts,
  { ownAddress, recorded }: SavedRunEvidence,
): ResumeTarget {
  if (!answersAnything(run, facts)) return PAGE;
  if (run.scope.kind === "full") return page.kind === "full" ? PAGE : FULL;
  const held = page.kind === "parts" && holds(page, run, scoped, facts);
  if (held && ownAddress) return PAGE;
  if (recorded === null) return page.kind === "full" ? PAGE : FULL;
  if (held && sameEffects(run, scoped, recorded.steps)) return PAGE;
  if (carriedOnWhole(run, recorded.scope, recorded.steps, recorded.facts)) {
    return page.kind === "full" ? PAGE : FULL;
  }
  return { kind: "own", scope: recorded.scope };
}
