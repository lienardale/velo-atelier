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
 *     about.
 *
 * Everything else is the ordinary write path: `deriveBike` is the only way the
 * three JSON columns are produced (§4.2 a), `validateBuild` is the only entry
 * for the parts the payload supplies (§1.2), `coerceFit` keeps the measurements
 * it recognises, and every timestamp is clamped to "now" — a guest's clock is
 * whatever their device says, and a checkup completed in 2087 would sit at the
 * top of their history for ever (§4.7).
 *
 * Plain Node: no `server-only`, no `next/*`, the database passed in. That is
 * what lets `import.test.ts` and `tests/security/guest-import.test.ts` drive it
 * against the recording fake, and the integration test against real Postgres.
 */
import { ok, fail, type ActionResult } from "@/lib/actions/result";
import { coerceFit, deriveBike, QUOTAS, withinJsonBudget, withinQuota } from "@/lib/bike/rules";
import { isUniqueViolation } from "@/lib/db/errors";
import { PART_IDS } from "@/lib/domain/data/parts";
import { validateBuild } from "@/lib/domain/engine/validate-build";
import type { Answers } from "@/lib/domain/schema/decision";
import type { KoAction } from "@/lib/domain/schema/procedure";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

import { GUEST_CAPS, type GuestBike, type GuestCheckup, type GuestState } from "./schema";

/** Just enough of the client to run an import; keeps the fakes small. */
export type GuestImportStore = Pick<PrismaClient, "bike">;

export interface GuestBikeImport {
  /** `va:bike:local`'s id — what the browser knows this bike as. */
  localId: string;
  /** The row's uuid, whether it was created now or by an earlier import. */
  bikeId: string;
  /** Present when the bike was already in the account: nothing was written. */
  skipped?: "already-imported";
}

export interface GuestImportSummary {
  /** Where `/import` sends the visitor — the first bike of the payload. */
  bikeId: string | null;
  bikes: GuestBikeImport[];
  imported: number;
  skipped: number;
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
 */
function clamp(at: string | undefined, now: number): Date {
  if (at === undefined) return new Date(now);
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return new Date(now);
  return new Date(Math.min(parsed, now));
}

/** The user-scoped idempotency key of an imported checkup (`Checkup.guestKey` is globally unique). */
export function guestCheckupKey(userId: string, guestKey: string): string {
  return `${userId}:${guestKey}`;
}

/** The `Checkup` + `CheckupItem` nested create for one guest checkup. */
function checkupCreate(userId: string, checkup: GuestCheckup, now: number) {
  const startedAt = clamp(checkup.startedAt, now);
  const completedAt = checkup.completedAt === undefined ? null : clamp(checkup.completedAt, now);
  const items = checkup.items
    // A part the catalogue no longer has cannot be rendered, only shown as a
    // missing message key. The corpus moves under a guest who has not been
    // back in months; the rest of their checkup is still worth keeping.
    .filter((item) => KNOWN_PART_IDS.has(item.partId))
    // `@@unique([checkupId, stepKey])`: a payload naming a step twice is one row.
    .filter(
      (item, index, all) => all.findIndex((other) => other.stepKey === item.stepKey) === index,
    )
    .map((item) => ({
      stepKey: item.stepKey,
      partId: item.partId,
      guideSlug: item.guideSlug,
      result: PRISMA_RESULT[item.result],
      ...(item.notes === undefined ? {} : { notes: item.notes }),
    }));

  return {
    guestKey: guestCheckupKey(userId, checkup.guestKey),
    scope: checkup.scope === "full" ? ("FULL" as const) : ("PARTIAL" as const),
    status: completedAt === null ? ("IN_PROGRESS" as const) : ("COMPLETED" as const),
    startedAt,
    // A device whose clock ran backwards between the two writes would otherwise
    // store a checkup that finished before it started.
    ...(completedAt === null
      ? {}
      : { completedAt: completedAt < startedAt ? startedAt : completedAt }),
    items: { create: items },
  };
}

/**
 * The part statuses a COMPLETED checkup implies (§4.2 b): KO → BROKEN, OK → OK
 * with a service date, SKIPPED → unchanged.
 *
 * `completeCheckupAction` writes these when the checkup finishes on the server
 * (W3-T1). An imported checkup finished in the visitor's browser, so the same
 * conclusion has to be drawn here, or a bike arrives with a completed checkup
 * and forty parts still `UNKNOWN`. Checkups are applied oldest first, so the
 * most recent verdict on a part is the one that stands.
 */
function partStatesFrom(checkups: readonly GuestCheckup[], now: number) {
  const byPart = new Map<string, { status: "OK" | "BROKEN"; lastServicedAt: Date | null }>();
  const completed = checkups
    .filter((checkup) => checkup.completedAt !== undefined)
    .sort((a, b) => Date.parse(a.completedAt ?? "") - Date.parse(b.completedAt ?? ""));

  for (const checkup of completed) {
    const at = clamp(checkup.completedAt, now);
    for (const item of checkup.items) {
      if (item.result === "skipped" || !KNOWN_PART_IDS.has(item.partId)) continue;
      byPart.set(
        item.partId,
        item.result === "ko"
          ? { status: "BROKEN", lastServicedAt: null }
          : { status: "OK", lastServicedAt: at },
      );
    }
  }
  return byPart;
}

/** The `BuildList` + `BuildListItem` nested creates for one guest bike. */
function buildListCreates(bike: GuestBike) {
  return bike.lists.map((list) => ({
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
        .map((item, index) => ({
          partId: item.partId,
          action: PRISMA_ACTION[item.action],
          reasonKey: item.reasonKey,
          ...(item.guideSlug === undefined ? {} : { guideSlug: item.guideSlug }),
          done: item.done,
          sortOrder: Number.isInteger(item.sortOrder) ? item.sortOrder : index,
          ...(item.refinement === undefined ? {} : { refinement: json(item.refinement) }),
          ...(item.chosenProduct === undefined ? {} : { chosenProduct: json(item.chosenProduct) }),
        })),
    },
  }));
}

export interface ImportGuestStateOptions {
  /** Injectable clock — the clamp is what these tests are about. */
  now?: () => number;
}

/**
 * Import `state` into `userId`'s account.
 *
 * Never throws for an expected failure: a full garage is `TOO_MANY`, a bike
 * that is already there is a `skipped` entry in the summary. Both are sentences
 * the page can show.
 */
export async function importGuestState(
  db: GuestImportStore,
  userId: string,
  state: GuestState,
  { now = Date.now }: ImportGuestStateOptions = {},
): Promise<ActionResult<GuestImportSummary>> {
  const at = now();
  const bikes: GuestBikeImport[] = [];
  let owned = await db.bike.count({ where: { userId } });

  for (const bike of state.bikes.slice(0, GUEST_CAPS.bikes)) {
    const existing = await db.bike.findFirst({
      where: { userId, guestLocalId: bike.localId },
      select: { id: true },
    });
    if (existing !== null) {
      bikes.push({ localId: bike.localId, bikeId: existing.id, skipped: "already-imported" });
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

    const fit = coerceFit(bike.fit);
    const statuses = partStatesFrom(bike.checkups, at);
    const checkups = bike.checkups
      .slice(0, QUOTAS.checkupsPerBike)
      .map((checkup) => checkupCreate(userId, checkup, at));
    const lists = buildListCreates(bike).slice(0, QUOTAS.listsPerBike);

    try {
      const created = await db.bike.create({
        data: {
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
                ...(known?.lastServicedAt == null ? {} : { lastServicedAt: known.lastServicedAt }),
              };
            }),
          },
          ...(checkups.length === 0 ? {} : { checkups: { create: checkups } }),
          ...(lists.length === 0 ? {} : { buildLists: { create: lists } }),
        },
        select: { id: true },
      });
      owned += 1;
      bikes.push({ localId: bike.localId, bikeId: created.id });
    } catch (error) {
      // Two devices importing the same guest bike at the same moment: the
      // constraint decided, and the loser reports what the winner wrote.
      if (!isUniqueViolation(error)) throw error;
      const raced = await db.bike.findFirst({
        where: { userId, guestLocalId: bike.localId },
        select: { id: true },
      });
      if (raced === null) throw error;
      bikes.push({ localId: bike.localId, bikeId: raced.id, skipped: "already-imported" });
    }
  }

  return ok({
    bikeId: bikes[0]?.bikeId ?? null,
    bikes,
    imported: bikes.filter((bike) => bike.skipped === undefined).length,
    skipped: bikes.filter((bike) => bike.skipped !== undefined).length,
  });
}
