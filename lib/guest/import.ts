/**
 * Turning a guest's `localStorage` into rows (§4.4).
 *
 * The interesting half of an import is not the copying, it is **doing it
 * twice**. A visitor signs in on their phone, imports, then signs in on the
 * laptop that still holds a three-day-old copy of the same guest bike — and
 * that second import must not produce a second bike, nor quietly overwrite the
 * first with the stale one. So:
 *
 *   - `Bike.guestLocalId` is the guest bike's own id, and `@@unique([userId,
 *     guestLocalId])` is what makes "already imported" a database fact rather
 *     than a race. A bike that is already there is reported `skipped:
 *     'already-imported'` and **nothing is written** — not the bike, not its
 *     checkups, not its lists. An older copy therefore cannot win; there is
 *     nothing to compare because there is no second write.
 *   - The same holds for the second device racing the first: the create is
 *     tried, and a P2002 on that constraint is read as the same "already
 *     imported" answer.
 *   - `Checkup.guestKey` is `${userId}:${CheckupState.id}` rather than the bare
 *     state id. The column is globally unique, and two people importing from
 *     one shared browser hold the same state id: without the user segment, the
 *     second import would collide on a row it cannot see and must not know
 *     about. A checkup the ACCOUNT already holds under that key is never
 *     written a second time, whichever bike carries it.
 *
 * ## The server re-plans (§5.4)
 *
 * A checkup arrives as answers keyed by step key and nothing else
 * (`lib/guest/schema.ts`). What each answer is ABOUT — which part, which guide,
 * which symptoms the step offers — is computed here: the plan is recomputed
 * from the bike this import derives and the checkup's scope ({@link
 * GuestImportDeps.plan}), and the payload is married to it by `fromStored`
 * (`reconcile`), exactly as `controle/actions.ts` does for a saved bike. An
 * answer whose key is not in the plan is dropped; so is a symptom the step does
 * not offer. The rows are `answeredItems(state)` — the same function
 * `writeItems` uses.
 *
 * A checkup none of whose answers survives writes NO row and is reported
 * `skipped: 'nothing-kept'`: an empty `Checkup` would show as a history entry,
 * and the browser keeps its copy.
 *
 * ## What a COMPLETED checkup does that an unfinished one does not
 *
 * A checkup is `COMPLETED` if and only if the payload carries a `completedAt`
 * — the visitor pressed "Créer ma liste" — and at least one of its answers
 * survived the re-plan. NOT "only if today's plan is fully answered", which is
 * what `reconcile` would say: a checkup finished a month ago is still finished
 * when the corpus has since grown a question, exactly as it is for the wizard
 * (a stored checkup with a `completedAt` is history, never resumed) and for an
 * account's own `COMPLETED` rows. Reopening it would also hand a FINISHED
 * checkup to the resume path, which is not where it belongs. The date is the
 * only thing taken from the payload here: what the checkup's answers are about
 * is still the plan's. A finished checkup then does here what "Créer ma liste"
 * does on an account (§4.2 b):
 *
 *   - **part states** — KO → `BROKEN`, OK → `OK` with `lastServicedAt`,
 *     SKIPPED → unchanged, on the part each ITEM names (the step's first
 *     reported part: one row, one part, one verdict). A KO is never undone by
 *     an OK of the same checkup; across checkups the most recently finished
 *     one stands;
 *   - **the list's links** — the imported `BuildList.checkupId`, and on every
 *     line whose `(action, partId)` pair `deriveBuildList(state)` derives, the
 *     `checkupItemId` of the step that derived it. A line the checkup does not
 *     derive (ticked by hand in a shop, left by an earlier run) keeps `null`.
 *
 * An IN_PROGRESS checkup is imported as `saveCheckupAction` would have left it
 * — the row and its items, no link, no part state — because it has not written
 * to the list yet. Its `startedAt` round-trips unchanged (it is only ever
 * clamped down to "now"), which is how `existingCheckup` recognises the run: a
 * FULL checkup is resumed and finished on the account as the SAME `Checkup`,
 * and `finishCheckupAction` links the list then
 * (`tests/integration/guest-import.test.ts`).
 *
 * What is NOT imported for a PARTIAL checkup is the set of parts the visitor
 * picked: `Checkup.scope` is `FULL | PARTIAL` and there is no column for the
 * ids. They are used here, to plan, and then they are gone — as they are for
 * a partial checkup started on the account itself, whose resume this import
 * neither changes nor relies on.
 *
 * The list's LINES still come from the payload — they hold what the visitor
 * typed (`refinement`, `chosenProduct`, the ticks) — and are never re-derived.
 *
 * ## All or nothing, per bike
 *
 * The bike, its part states, its checkups and items, its lists and lines are
 * ONE transaction, with the row ids the links need generated here. There is no
 * state in which the bike exists — after which every import answers "already
 * imported" and writes nothing — while a checkup the server accepted does not.
 *
 * Everything else is the ordinary write path: `deriveBike` is the only way the
 * three JSON columns are produced (§4.2 a), `validateBuild` is the only entry
 * for the parts the payload supplies (§1.2), `coerceFit` keeps the measurements
 * it recognises, and every timestamp is clamped to "now" — a guest's clock is
 * whatever their device says, and a checkup completed in 2087 would sit at the
 * top of their history for ever (§4.7).
 *
 * Plain Node: no `server-only`, no `next/*`, the database AND the planner
 * passed in. The planner is injected rather than imported because it reaches
 * the compiled corpus (`content-collections`, a generated tree): keeping it out
 * of this module is what lets `import.test.ts` drive the real planner over the
 * guides on disk, `tests/security/guest-import.test.ts` go through the action
 * against the recording fake, and the integration test against real Postgres.
 */
import { randomUUID } from "node:crypto";

import { ok, fail, type ActionResult } from "@/lib/actions/result";
import { coerceFit, deriveBike, QUOTAS, withinJsonBudget, withinQuota } from "@/lib/bike/rules";
import { deriveBuildList } from "@/lib/checkup/build-list";
import { answeredItems, type AnsweredItem } from "@/lib/checkup/items";
import { fromStored } from "@/lib/checkup/storage";
import {
  CHECKUP_STATE_VERSION,
  type CheckStepRef,
  type CheckupScope,
  type CheckupState,
} from "@/lib/checkup/types";
import { isUniqueViolation } from "@/lib/db/errors";
import { PART_IDS } from "@/lib/domain/data/parts";
import { validateBuild } from "@/lib/domain/engine/validate-build";
import type { Answers } from "@/lib/domain/schema/decision";
import type { BikeBuild } from "@/lib/domain/schema/part";
import type { KoAction } from "@/lib/domain/schema/procedure";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { routing } from "@/lib/i18n/routing";

import {
  GUEST_CAPS,
  type GuestBikeImport,
  type GuestBuildList,
  type GuestCheckup,
  type GuestCheckupImport,
  type GuestImportSummary,
  type GuestState,
} from "./schema";

export type { GuestBikeImport, GuestCheckupImport, GuestImportSummary } from "./schema";

/** Just enough of the client to run an import; keeps the fakes small. */
export type GuestImportStore = Pick<
  PrismaClient,
  "bike" | "checkup" | "buildList" | "$transaction"
>;

export interface GuestImportDeps {
  /**
   * The plan the server computes for a build and a scope (§5.4) —
   * `planForBuild` (`lib/content/checkup-plan.ts`) in production, the same
   * function `controle/actions.ts` plans with.
   */
  plan: (build: BikeBuild, scope: CheckupScope) => readonly CheckStepRef[];
  /** Injectable clock — the clamp is what these tests are about. */
  now?: () => number;
}

const KNOWN_PART_IDS: ReadonlySet<string> = new Set<string>(PART_IDS);

const PRISMA_RESULT = { ok: "OK", ko: "KO", skipped: "SKIPPED" } as const;

const PRISMA_ACTION: Readonly<
  Record<KoAction, Prisma.BuildListItemCreateWithoutBuildListInput["action"]>
> = {
  replace: "REPLACE",
  fix: "FIX",
  clean: "CLEAN",
  adjust: "ADJUST",
  "inspect-shop": "INSPECT_SHOP",
};

/**
 * A JSON column's value. Prisma's `InputJsonValue` is an object/array union
 * that a precise domain type does not structurally satisfy, and weakening the
 * domain to please the ORM is the wrong direction (same cast as
 * `mes-velos/actions.ts`).
 */
function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * `at`, never later than `now`.
 *
 * The clock that wrote these timestamps is the visitor's own, and a phone an
 * hour ahead (or a year) is not exotic. An unparsable date falls back to `now`
 * rather than to `Invalid Date`, which Postgres would refuse.
 *
 * A date that is NOT in the future comes back as the same instant. That is
 * load-bearing for `startedAt`: it is how the account recognises an imported
 * run when the visitor resumes it (`existingCheckup`).
 */
function clamp(at: string, now: number): Date {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return new Date(now);
  return new Date(Math.min(parsed, now));
}

/** The user-scoped idempotency key of an imported checkup (`Checkup.guestKey` is globally unique). */
export function guestCheckupKey(userId: string, guestKey: string): string {
  return `${userId}:${guestKey}`;
}

/** `(action, partId)` — the identity of a list line (`lib/checkup/build-list.ts`). */
function pairOf(action: KoAction, partId: string): string {
  return `${action}|${partId}`;
}

/** The payload's checkups, one per `guestKey` — the first to name a key wins. */
function distinctCheckups(checkups: readonly GuestCheckup[]): GuestCheckup[] {
  return checkups.filter(
    (checkup, index, all) =>
      all.findIndex((other) => other.guestKey === checkup.guestKey) === index,
  );
}

/**
 * The `guestKey`s of `checkups` this ACCOUNT already holds, on any of its bikes.
 *
 * A read, never a write, with the owner in the `where` (§4.7). It serves two
 * answers: on a bike that is already imported, WHICH of the browser's checkups
 * the account has (so the browser may forget exactly those); and on a new bike,
 * which ones must not be written again — the column is globally unique, so a
 * second insert would abort the whole bike.
 */
async function heldCheckupKeys(
  db: GuestImportStore,
  userId: string,
  checkups: readonly GuestCheckup[],
): Promise<Set<string>> {
  if (checkups.length === 0) return new Set();
  const rows = await db.checkup.findMany({
    where: {
      bike: { userId },
      guestKey: { in: checkups.map((checkup) => guestCheckupKey(userId, checkup.guestKey)) },
    },
    select: { guestKey: true },
  });
  const rowKeys = new Set(rows.map((row) => row.guestKey));
  return new Set(
    checkups
      .filter((checkup) => rowKeys.has(guestCheckupKey(userId, checkup.guestKey)))
      .map((checkup) => checkup.guestKey),
  );
}

/** What the browser is told about a bike the account already had: nothing was written. */
async function alreadyImported(
  db: GuestImportStore,
  userId: string,
  localId: string,
  bikeId: string,
  checkups: readonly GuestCheckup[],
): Promise<GuestBikeImport> {
  const held = await heldCheckupKeys(db, userId, checkups);
  return {
    localId,
    bikeId,
    skipped: "already-imported",
    checkups: checkups.map((checkup) =>
      held.has(checkup.guestKey)
        ? { guestKey: checkup.guestKey, status: "already-imported" }
        : { guestKey: checkup.guestKey, status: "skipped", reason: "bike-already-imported" },
    ),
  };
}

/** One checkup of the payload, accepted against the plan and given its row ids. */
interface AcceptedCheckup {
  guestKey: string;
  /** The `Checkup` row's id — generated here, so the list can point at it. */
  id: string;
  state: CheckupState;
  items: (AnsweredItem & { id: string })[];
  startedAt: Date;
  /** `null` while IN_PROGRESS: the payload carried no `completedAt` (see the header). */
  completedAt: Date | null;
}

/**
 * The payload against the plan the server just computed, or `null` when
 * nothing of it is about a question this bike is asked.
 */
function acceptCheckup(
  checkup: GuestCheckup,
  steps: readonly CheckStepRef[],
  bikeId: string,
  now: number,
): AcceptedCheckup | null {
  // `fromStored` reconciles: keys that are not in the plan and symptoms the
  // step does not offer are gone by the time anything is written — the same
  // call `acceptedState` makes for a saved bike. The locale, the missing tools
  // and the content version are the wizard's own business and are not stored.
  const state = fromStored(
    {
      version: CHECKUP_STATE_VERSION,
      id: checkup.guestKey,
      bikeRef: { kind: "db", id: bikeId },
      scope: checkup.scope as CheckupScope,
      locale: routing.defaultLocale,
      answers: checkup.answers,
      symptoms: checkup.symptoms,
      notes: checkup.notes,
      toolsMissing: [],
      startedAt: checkup.startedAt,
      ...(checkup.completedAt === undefined ? {} : { completedAt: checkup.completedAt }),
      contentVersion: "",
    },
    steps,
    "",
  );
  const items = answeredItems(state).map((item) => ({ ...item, id: randomUUID() }));
  if (items.length === 0) return null;

  const startedAt = clamp(checkup.startedAt, now);
  // The PAYLOAD's `completedAt`, not the reconciled state's: `reconcile` drops
  // it as soon as today's plan has a question this checkup did not answer, and
  // a checkup the visitor finished stays finished (see the header).
  const completedAt = checkup.completedAt === undefined ? null : clamp(checkup.completedAt, now);
  return {
    guestKey: checkup.guestKey,
    id: randomUUID(),
    state,
    items,
    startedAt,
    // A device whose clock ran backwards between the two writes would otherwise
    // store a checkup that finished before it started.
    completedAt: completedAt !== null && completedAt < startedAt ? startedAt : completedAt,
  };
}

/** The finished checkups, oldest first — the order their verdicts are applied in. */
function completedOf(accepted: readonly AcceptedCheckup[]) {
  return accepted
    .flatMap((checkup) =>
      checkup.completedAt === null ? [] : [{ ...checkup, completedAt: checkup.completedAt }],
    )
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
}

/**
 * The part statuses the COMPLETED checkups imply (§4.2 b): KO → BROKEN, OK → OK
 * with a service date, SKIPPED → unchanged.
 *
 * Computed from the rows this import writes, so from the plan: the part is the
 * one each item names (`answeredItems` — the step's first reported part), never
 * an id the payload supplied. Within one checkup a KO stands whatever a later
 * question about the same part answered — a caliper whose pads are worn is not
 * fine because it is aligned — and checkups are applied oldest first, so the
 * most recent one to finish has the last word on a part.
 */
function partStatesFrom(completed: ReturnType<typeof completedOf>) {
  const byPart = new Map<string, { status: "OK" | "BROKEN"; lastServicedAt: Date | null }>();
  for (const checkup of completed) {
    const verdicts = new Map<string, "ok" | "ko">();
    for (const item of checkup.items) {
      if (item.result === "skipped" || verdicts.get(item.partId) === "ko") continue;
      verdicts.set(item.partId, item.result);
    }
    for (const [partId, verdict] of verdicts) {
      byPart.set(
        partId,
        verdict === "ko"
          ? { status: "BROKEN", lastServicedAt: null }
          : { status: "OK", lastServicedAt: checkup.completedAt },
      );
    }
  }
  return byPart;
}

/** What the finished checkup that wrote the list LAST says about its lines. */
interface ListLinks {
  checkupId: string;
  /** `(action, partId)` → the `CheckupItem` of the step that derived the pair. */
  itemIdByPair: ReadonlyMap<string, string>;
}

/**
 * The links a finished checkup owns on the bike's list (§4.2 b), or `null`
 * when no imported checkup is COMPLETED.
 *
 * `BuildList.checkupId` is "the last checkup that wrote here" (W5), so with
 * several finished checkups it is the one that finished last. The pairs are
 * `deriveBuildList(state)`'s — the server's own derivation over the re-planned
 * state — and the item is the one of the FIRST step that named the pair, which
 * is the `stepKey` `finishCheckupAction` links too.
 */
function listLinksOf(completed: ReturnType<typeof completedOf>): ListLinks | null {
  const last = completed.at(-1);
  if (last === undefined) return null;
  const itemIdByStep = new Map(last.items.map((item) => [item.stepKey, item.id]));
  const itemIdByPair = new Map<string, string>();
  for (const line of deriveBuildList(last.state)) {
    // Always there — a line is derived from a KO, and a KO has an item — but
    // the map cannot know that, and an unlinked line is the safe way to be wrong.
    const itemId = itemIdByStep.get(line.stepKey);
    if (itemId !== undefined) itemIdByPair.set(pairOf(line.action, line.partId), itemId);
  }
  return { checkupId: last.id, itemIdByPair };
}

/** One `BuildList` + its `BuildListItem`s, as an unchecked create under `bikeId`. */
function buildListCreate(bikeId: string, list: GuestBuildList, links: ListLinks | null) {
  return {
    bikeId,
    ...(links === null ? {} : { checkupId: links.checkupId }),
    name: list.name,
    items: {
      create: list.items
        .filter((item) => KNOWN_PART_IDS.has(item.partId))
        // `@@unique([buildListId, partId, action])`: the same pair twice is one row.
        .filter(
          (item, index, all) =>
            all.findIndex(
              (other) => other.partId === item.partId && other.action === item.action,
            ) === index,
        )
        .map((item, index) => {
          const checkupItemId = links?.itemIdByPair.get(pairOf(item.action, item.partId));
          return {
            partId: item.partId,
            action: PRISMA_ACTION[item.action],
            reasonKey: item.reasonKey,
            ...(item.guideSlug === undefined ? {} : { guideSlug: item.guideSlug }),
            done: item.done,
            sortOrder: Number.isInteger(item.sortOrder) ? item.sortOrder : index,
            ...(item.refinement === undefined ? {} : { refinement: json(item.refinement) }),
            ...(item.chosenProduct === undefined
              ? {}
              : { chosenProduct: json(item.chosenProduct) }),
            // Set only on a line the finished checkup derives; every other line
            // is the visitor's own and stays unlinked.
            ...(checkupItemId === undefined ? {} : { checkupItemId }),
          };
        }),
    },
  };
}

/** One `Checkup` + its `CheckupItem`s — the columns `writeItems` writes. */
function checkupCreate(userId: string, bikeId: string, checkup: AcceptedCheckup) {
  return {
    id: checkup.id,
    bikeId,
    guestKey: guestCheckupKey(userId, checkup.guestKey),
    scope: checkup.state.scope.kind === "full" ? ("FULL" as const) : ("PARTIAL" as const),
    status: checkup.completedAt === null ? ("IN_PROGRESS" as const) : ("COMPLETED" as const),
    startedAt: checkup.startedAt,
    ...(checkup.completedAt === null ? {} : { completedAt: checkup.completedAt }),
    items: {
      create: checkup.items.map((item) => ({
        id: item.id,
        stepKey: item.stepKey,
        partId: item.partId,
        guideSlug: item.guideSlug,
        result: PRISMA_RESULT[item.result],
        ...(item.notes === null ? {} : { notes: item.notes }),
        reasonKeys: item.reasonKeys,
      })),
    },
  };
}

/**
 * Import `state` into `userId`'s account.
 *
 * Never throws for an expected failure: a full garage is `TOO_MANY`, a bike
 * that is already there is a `skipped` entry in the summary, and a checkup the
 * server wrote no row for is a `skipped` entry under its bike, with the reason.
 * All of them are sentences the page can show.
 */
export async function importGuestState(
  db: GuestImportStore,
  userId: string,
  state: GuestState,
  { plan, now = Date.now }: GuestImportDeps,
): Promise<ActionResult<GuestImportSummary>> {
  const at = now();
  const bikes: GuestBikeImport[] = [];
  let owned = await db.bike.count({ where: { userId } });

  for (const bike of state.bikes.slice(0, GUEST_CAPS.bikes)) {
    const checkups = distinctCheckups(bike.checkups).slice(0, QUOTAS.checkupsPerBike);

    const existing = await db.bike.findFirst({
      where: { userId, guestLocalId: bike.localId },
      select: { id: true },
    });
    if (existing !== null) {
      bikes.push(await alreadyImported(db, userId, bike.localId, existing.id, checkups));
      continue;
    }

    if (!withinQuota(owned, QUOTAS.bikesPerUser)) return fail("TOO_MANY");

    // `answers` is the source of truth; the parts the payload carries are read
    // only through `validateBuild`, and only to keep the owner's attribute
    // edits. Anything it refuses is replaced by the defaults for this spec.
    const base = deriveBike(bike.answers as Answers);
    const checked = validateBuild({ spec: base.spec, parts: bike.parts });
    const derived = checked.ok ? deriveBike(bike.answers as Answers, checked.build.parts) : base;
    // The same ceiling `createBikeAction` applies, on the same column: `parts`
    // is the only one a payload can inflate (the answers are a partial map over
    // twelve known question ids, and the spec is derived from them). It is
    // deliberately belt-and-braces — the largest build `validateBuild` accepts
    // today measures under 4 KB against a 32 KB column — because the catalogue
    // grows and a `TOO_MANY` is a sentence while a Postgres error is a 500.
    if (!withinJsonBudget(derived.parts)) return fail("TOO_MANY");

    // Row ids are generated HERE: the list has to point at a checkup, and a
    // line at an item, that are created in the same transaction.
    const bikeId = randomUUID();
    const build: BikeBuild = { spec: derived.spec, parts: derived.parts };
    const held = await heldCheckupKeys(db, userId, checkups);
    const accepted: AcceptedCheckup[] = [];
    const reports: GuestCheckupImport[] = [];
    for (const checkup of checkups) {
      if (held.has(checkup.guestKey)) {
        reports.push({ guestKey: checkup.guestKey, status: "already-imported" });
        continue;
      }
      // The plan of THIS bike, as derived above — the one `planFor` will
      // compute from the row once it exists.
      const one = acceptCheckup(checkup, plan(build, checkup.scope as CheckupScope), bikeId, at);
      if (one === null) {
        reports.push({ guestKey: checkup.guestKey, status: "skipped", reason: "nothing-kept" });
        continue;
      }
      accepted.push(one);
      reports.push({ guestKey: checkup.guestKey, status: "imported" });
    }

    const fit = coerceFit(bike.fit);
    const completed = completedOf(accepted);
    const statuses = partStatesFrom(completed);
    const links = listLinksOf(completed);
    const lists = bike.lists.slice(0, QUOTAS.listsPerBike);

    try {
      // ONE transaction: the bike, then the checkups it owns, then the lists
      // that point at them. Any failure — the unique constraint a second
      // device loses on, or anything Postgres refuses further down — leaves no
      // row at all.
      await db.$transaction([
        db.bike.create({
          data: {
            id: bikeId,
            userId,
            name: bike.name,
            answers: json(derived.answers),
            spec: json(derived.spec),
            parts: json(derived.parts),
            fit: Object.keys(fit).length === 0 ? undefined : json(fit),
            guestLocalId: bike.localId,
            updatedAt: clamp(bike.updatedAt, at),
            partStates: {
              create: derived.parts.map((part) => {
                const known = statuses.get(part.partId);
                return {
                  partId: part.partId,
                  status: known?.status ?? ("UNKNOWN" as const),
                  ...(known?.lastServicedAt == null
                    ? {}
                    : { lastServicedAt: known.lastServicedAt }),
                };
              }),
            },
          },
          select: { id: true },
        }),
        ...accepted.map((checkup) =>
          db.checkup.create({
            data: checkupCreate(userId, bikeId, checkup),
            select: { id: true },
          }),
        ),
        ...lists.map((list) =>
          db.buildList.create({
            data: buildListCreate(bikeId, list, links),
            select: { id: true },
          }),
        ),
      ]);
      owned += 1;
      bikes.push({ localId: bike.localId, bikeId, checkups: reports });
    } catch (error) {
      // Two devices importing the same guest bike at the same moment: the
      // constraint decided, and the loser reports what the winner wrote.
      if (!isUniqueViolation(error)) throw error;
      const raced = await db.bike.findFirst({
        where: { userId, guestLocalId: bike.localId },
        select: { id: true },
      });
      if (raced === null) throw error;
      bikes.push(await alreadyImported(db, userId, bike.localId, raced.id, checkups));
    }
  }

  return ok({
    bikeId: bikes[0]?.bikeId ?? null,
    bikes,
    imported: bikes.filter((bike) => bike.skipped === undefined).length,
    skipped: bikes.filter((bike) => bike.skipped !== undefined).length,
  });
}
