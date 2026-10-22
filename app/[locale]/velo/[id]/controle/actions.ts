"use server";

/**
 * A saved bike's checkup (§4.4, §5.4).
 *
 * ## The server re-plans; the browser only names a step
 *
 * Nothing the client sends is taken as a fact about the corpus. Every call
 * re-derives the bike from its stored `answers`, re-runs `planCheckup` over the
 * guides, and keeps only the verdicts whose key is in THAT plan. A payload
 * naming `check-brakes-disc#pad-wear` on a rim-brake bike is not an error to
 * report, it is a key that is simply not in the plan and is dropped — along
 * with any symptom the step does not offer.
 *
 * On top of that the zod schemas are pinned to the **generated** enums
 * (`lib/content/generated/{slugs,reason-keys}.ts`): a step key or a reason key
 * that no guide on disk declares never reaches the planner at all. Two layers
 * for one rule, because this is the payload that decides what someone is told
 * to buy.
 *
 * ## The scope the browser posts is a claim, and never a reason to delete
 *
 * A payload names a scope; the plan it is accepted against is the one that
 * scope's ANSWERS bear out (`effectiveScope`, `lib/checkup/scope.ts`): the
 * named scope while it holds every answer — asks it, with the symptom a KO
 * was given with, and, for a stored row, would record it against the part
 * the row is recorded against — and the full checkup as soon as it does not. "Answered" is the
 * payload's answers AND the run's stored ones it does not carry — a stored
 * answer the payload leaves out is kept, never read as withdrawn: the wizard
 * has no event that removes a verdict, so only a page that planned fewer
 * questions than the run holds, or a tab holding an older copy of the run,
 * leaves one out. Such a row is kept AS IT IS: a save writes the rows of the
 * questions the payload answers, and no other. The column follows on every
 * save and finish (`Checkup.scope`). A `parts` scope that names no part is
 * refused (`VALIDATION`) before anything is planned or written; a row is
 * deleted only when the bike is no longer asked its question at all — never
 * because a plan came back short, and a plan that would drop a stored
 * symptom widens instead. Until 2026-10-22 each of these was the other way
 * round: a partial run resumed after a reload lost every stored answer to a
 * save that said "Sauvegardé" (`.debug/017` §5.10), and a narrower page then
 * still stripped a stored symptom and moved its row (§5.12).
 *
 * Which page a run is resumed on — and so which scope its payloads name — is
 * the page's decision, not this module's (`savedResumeTarget`, `page.tsx`):
 * these actions cannot tell a run on the front caliper from one on both
 * calipers any better than the page can, and accept a scope that holds the
 * rows as the page that posted it. A payload naming the FULL checkup is a
 * full checkup's, and is acted on as one — both sides — whichever answers it
 * carries (`.debug/017` §5.13: the resume banner once posted that for a run
 * whose rows named the rear caliper alone).
 *
 * ## What is stored, and what is not
 *
 * `CheckupItem` holds one row per answered step — `(stepKey, partId, guideSlug,
 * result, notes, reasonKeys)`, unique on `(checkupId, stepKey)`. `reasonKeys`
 * is the symptom ticked on a KO (W4), so a reloaded in-progress checkup gets
 * back WHICH problem it was, not only that there was one; `load.ts` restores it.
 *
 * ## One OPEN build list per bike (W5)
 *
 * A finished checkup gets no list of its own. It merges into the bike's OPEN
 * `BuildList` — the newest one, the very row `/liste` renders
 * (`liste/load.ts`) — and creates it only when the bike has none.
 * `BuildList.checkupId` records the LAST checkup that wrote there, which is
 * all that still tells a re-finish of the same run from a later checkup.
 *
 * What a finish does to that list, mirroring the guest's
 * `mergeGuestBuildList`:
 *
 *   - a pair this checkup DERIVES updates its row (`reasonKey`, `guideSlug`,
 *     `checkupItemId`, `sortOrder`) and REOPENS it — a KO is a new finding,
 *     whatever closed the line before — while never touching the `refinement`
 *     or the `chosenProduct` the visitor typed;
 *   - a pair `recheckedLines(state)` names is closed on that same list,
 *     `done` with `doneReason: 'recheck-ok'` (§5.4, §6.7);
 *   - every other line survives, untouched, across as many checkups as the
 *     bike has.
 *
 * ## Quotas (§4.2 c), literally
 *
 * 50 checkups per bike, 10 lists per bike, 50 lines per list — each answered
 * `TOO_MANY` BEFORE anything is written, so a refused finish leaves the checkup
 * exactly as it was (the wizard shows the refusal; it never fails silently).
 * Counted in the request that would create the next one, like
 * `QUOTAS.bikesPerUser` in `mes-velos/actions.ts`.
 *
 * Since W5 the two list limits count what the open list will HOLD rather than
 * what this checkup alone produced: `listsPerBike` is checked only on the
 * create path — a bike with no open list — which the normal flow no longer
 * takes, so ten lists is reachable only by a bike whose lists a future list
 * lifecycle has closed; `itemsPerList` counts the union of the lines already
 * on the open list and the pairs this checkup derives.
 *
 * ## Ownership
 *
 * Every query names the owner inside its `where`, nesting `bike: { userId }`
 * for the rows that hang off a bike. A foreign id matches no row and answers
 * `NOT_FOUND` — 404, never 403 (§4.7).
 */

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { withUser, type ActionUser } from "@/lib/actions/with-user";
import { deriveBike, QUOTAS, withinQuota } from "@/lib/bike/rules";
import { deriveBuildList, recheckedLines, statusByPart } from "@/lib/checkup/build-list";
import { answeredItems } from "@/lib/checkup/items";
import { effectiveScope, FULL_SCOPE, scopeFacts } from "@/lib/checkup/scope";
import { fromStored, type StoredCheckup, type StoredCheckupSummary } from "@/lib/checkup/storage";
import {
  CHECKUP_ANSWERS,
  type BuildListItem,
  type CheckStepRef,
  type CheckupScope,
  type CheckupState,
} from "@/lib/checkup/types";
import { planForBuild } from "@/lib/content/checkup-plan";
import { CONTENT_VERSION } from "@/lib/content/generated/version";
import { REASON_KEYS } from "@/lib/content/generated/reason-keys";
import { GUIDE_STEP_KEYS } from "@/lib/content/generated/slugs";
import { prisma } from "@/lib/db/prisma";
import { TOOL_IDS } from "@/lib/domain/data/tools";
import type { Answers } from "@/lib/domain/schema/decision";
import type { BikeBuild, BikePart } from "@/lib/domain/schema/part";
import type { BuildAction, CheckupResult } from "@/lib/generated/prisma/client";
import { routing } from "@/lib/i18n/routing";

import { answersOfRows, loadStoredCheckup, type StoredItemRow } from "./load";

/*
 * Module-private on purpose: a `"use server"` file may only EXPORT async
 * functions — Next turns every export into a callable server reference and a
 * zod schema is an object, which fails the whole module at request time
 * (CLAUDE.md, `.debug/006`).
 */

const stepKeySchema = z.enum(GUIDE_STEP_KEYS);

/**
 * `min(1)`: a `parts` scope naming no part plans no question, and acting on one
 * deleted every answer of a run — the payload a resumed partial run posted
 * until 2026-10-22, which a tab still open on that bundle posts today. Refused
 * before anything is planned or written, so that tab gets "could not be
 * saved", never a silent delete (`.debug/017` §5.10).
 */
const scopeSchema = z.union([
  z.object({ kind: z.literal("full") }).strict(),
  z
    .object({
      kind: z.literal("parts"),
      partIds: z
        .array(z.string().regex(/^[a-z0-9-]{1,48}$/))
        .min(1)
        .max(64),
    })
    .strict(),
]);

const checkupSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    bikeRef: z.union([
      z.object({ kind: z.literal("demo") }).strict(),
      z.object({ kind: z.literal("local") }).strict(),
      z.object({ kind: z.literal("db"), id: z.uuid() }).strict(),
    ]),
    scope: scopeSchema,
    locale: z.enum(routing.locales),
    // `partialRecord`, not `record`: a record over an enum key is EXHAUSTIVE in
    // zod 4, and a checkup answers a handful of the 222 step keys, not all.
    answers: z.partialRecord(stepKeySchema, z.enum(CHECKUP_ANSWERS)),
    symptoms: z.partialRecord(stepKeySchema, z.array(z.enum(REASON_KEYS)).max(12)),
    notes: z.partialRecord(stepKeySchema, z.string().max(2000)),
    toolsMissing: z.array(z.enum(TOOL_IDS)).max(TOOL_IDS.length),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).optional(),
    contentVersion: z.string().max(64),
  })
  .strict();

const bikeOnlySchema = z.object({ bikeId: z.uuid("errors.VALIDATION") }).strict();

const saveSchema = z
  .object({ bikeId: z.uuid("errors.VALIDATION"), checkup: checkupSchema })
  .strict();

/** The verdict vocabulary, both ways. */
const TO_PRISMA: Record<string, CheckupResult> = { ok: "OK", ko: "KO", skipped: "SKIPPED" };
const TO_BUILD_ACTION: Record<string, BuildAction> = {
  replace: "REPLACE",
  fix: "FIX",
  clean: "CLEAN",
  adjust: "ADJUST",
  "inspect-shop": "INSPECT_SHOP",
};

/**
 * The bike as its stored answers derive it — what every plan is made from.
 *
 * `null` when the bike is not this user's — the caller turns that into
 * `NOT_FOUND` without ever saying whether the id exists.
 */
async function buildFor(user: ActionUser, bikeId: string): Promise<BikeBuild | null> {
  const row = await prisma.bike.findFirst({
    where: { id: bikeId, userId: user.id },
    select: { answers: true, parts: true },
  });
  if (row === null) return null;
  const derived = deriveBike(row.answers as Answers, asParts(row.parts));
  return { spec: derived.spec, parts: derived.parts };
}

function asParts(value: unknown): BikePart[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.filter(
    (part): part is BikePart =>
      typeof part === "object" && part !== null && typeof (part as BikePart).partId === "string",
  );
  return parts.length > 0 ? parts : undefined;
}

/** The payload's answers, and every answer of the stored run the payload does not carry. */
function withStoredAnswers(
  payload: z.infer<typeof checkupSchema>,
  rows: readonly StoredItemRow[],
): Pick<StoredCheckup, "answers" | "symptoms" | "notes"> {
  const kept = answersOfRows(rows.filter((row) => !Object.hasOwn(payload.answers, row.stepKey)));
  // The payload's verdict on a question is the newer one: it wins, with its
  // own symptom and note — the stored row's are not mixed into it.
  return {
    answers: { ...kept.answers, ...(payload.answers as StoredCheckup["answers"]) },
    symptoms: { ...kept.symptoms, ...(payload.symptoms as StoredCheckup["symptoms"]) },
    notes: { ...kept.notes, ...(payload.notes as StoredCheckup["notes"]) },
  };
}

/** What a save or a finish accepts of a payload, and what that makes of the run's row. */
interface Accepted {
  state: CheckupState;
  /** Every question this bike is asked: a stored row about any other is gone with it. */
  asked: ReadonlySet<string>;
  /**
   * The questions the PAYLOAD answers — the only rows a save writes. A stored
   * row it does not carry is kept as it is, part and symptoms included.
   */
  carried: ReadonlySet<string>;
  /** `Checkup.scope`, as the answers bear it out. */
  column: "FULL" | "PARTIAL";
}

/**
 * The payload — with the run's stored answers it does not carry — against the
 * plan its answers bear out (see the header).
 */
function acceptedState(
  payload: z.infer<typeof checkupSchema>,
  build: BikeBuild,
  bikeId: string,
  rows: readonly StoredItemRow[],
): Accepted {
  // `planForBuild` is the plan every server-side write uses — the guest import
  // too (`lib/content/checkup-plan.ts`): the French corpus, whose keys are the
  // same in both languages.
  const full = planForBuild(build, FULL_SCOPE);
  const asked = new Set(full.map((step) => step.key));
  const answers = withStoredAnswers(payload, rows);
  const named = payload.scope as CheckupScope;
  // A stored row the payload does not carry is held only by a scope that would
  // record it against the same part (`holds`): neither the front caliper's
  // page nor both calipers' holds the rear one's answer.
  const recordedFor = Object.fromEntries(
    rows
      .filter((row) => !Object.hasOwn(payload.answers, row.stepKey))
      .map((row) => [row.stepKey, row.partId]),
  );
  let scoped: CheckStepRef[] | null = null;
  const scopedPlan = (): CheckStepRef[] => (scoped ??= planForBuild(build, named));
  const effective = effectiveScope(named, { ...answers, recordedFor }, () => {
    const plan = scopedPlan();
    return { scoped: plan, facts: scopeFacts(named, full, plan) };
  });
  const steps = effective.kind === "full" ? full : scopedPlan();
  const stored: StoredCheckup = {
    version: 1,
    id: payload.id,
    bikeRef: { kind: "db", id: bikeId },
    scope: effective,
    locale: payload.locale,
    ...answers,
    toolsMissing: payload.toolsMissing,
    startedAt: payload.startedAt,
    ...(payload.completedAt === undefined ? {} : { completedAt: payload.completedAt }),
    contentVersion: payload.contentVersion,
  };
  // `fromStored` reconciles against the plan the answers bear out: a key that
  // is not in it is a question this bike is no longer asked — or, for a
  // PARTIAL run, an OK or a skip to one its scope only touches (`holds`),
  // which is acted on nowhere and whose stored row stays as it is — and a
  // symptom it does not offer is one no plan offers any more (one the scope
  // withholds would have widened it). Neither is written, and of the rest only
  // the payload's questions are (`writeItems`).
  return {
    state: fromStored(stored, steps, CONTENT_VERSION),
    asked,
    carried: new Set(Object.keys(payload.answers)),
    column: effective.kind === "full" ? "FULL" : "PARTIAL",
  };
}

/**
 * The row this run of the checkup belongs to, or `null` when it is new.
 *
 * Matched on `startedAt`, not on `status`: the client's own "when did I start"
 * is what identifies a run, so editing a verdict on the summary and pressing
 * "Créer ma liste" again updates the checkup that was just finished instead of
 * opening a second one. The client's `id` is deliberately NOT used — a row id
 * is the server's to choose.
 *
 * Since W5 that identity does one more job: a run that is already the open
 * list's `checkupId` is a RE-finish, the only case in which a line may be
 * pruned rather than merged ({@link prunedLines}).
 */
async function existingCheckup(
  bikeId: string,
  userId: string,
  startedAt: string,
): Promise<{ id: string; scope: "FULL" | "PARTIAL"; items: StoredItemRow[] } | null> {
  return prisma.checkup.findFirst({
    where: { bikeId, bike: { userId }, startedAt: new Date(startedAt) },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      scope: true,
      // What the run already holds: the answers a payload does not carry are
      // kept (see the header), and the part each is recorded against.
      items: {
        select: { stepKey: true, partId: true, result: true, notes: true, reasonKeys: true },
      },
    },
  });
}

/** Room for one more `Checkup` on this bike (`QUOTAS.checkupsPerBike`)? */
async function roomForCheckup(bikeId: string, userId: string): Promise<boolean> {
  const count = await prisma.checkup.count({ where: { bikeId, bike: { userId } } });
  return withinQuota(count, QUOTAS.checkupsPerBike);
}

/** Room for one more `BuildList` on this bike (`QUOTAS.listsPerBike`)? */
async function roomForList(bikeId: string, userId: string): Promise<boolean> {
  const count = await prisma.buildList.count({ where: { bikeId, bike: { userId } } });
  return withinQuota(count, QUOTAS.listsPerBike);
}

function createCheckup(
  bikeId: string,
  column: "FULL" | "PARTIAL",
  startedAt: string,
): Promise<{ id: string }> {
  return prisma.checkup.create({
    data: { bikeId, scope: column, startedAt: new Date(startedAt) },
    select: { id: true },
  });
}

/**
 * `Checkup.scope` as the run's answers now bear it out: a run resumed over a
 * wider plan is no longer `PARTIAL`, and one resumed on the parts it was
 * opened on is (`.debug/017` §5.10). Owner in the `where`, like every write.
 */
async function writeColumn(
  checkup: { id: string; scope: "FULL" | "PARTIAL" },
  userId: string,
  column: "FULL" | "PARTIAL",
): Promise<void> {
  if (checkup.scope === column) return;
  await prisma.checkup.updateMany({
    where: { id: checkup.id, bike: { userId } },
    data: { scope: column },
  });
}

/**
 * Which quota refused, as the key the wizard shows (§4.2 c). The code stays
 * `TOO_MANY`; the key says which of the three limits it was, so the visitor is
 * told something they can act on rather than "a limit was reached".
 */
const QUOTA_KEYS = {
  checkups: "checkup.finish.tooManyCheckups",
  lists: "checkup.finish.tooManyLists",
  lines: "checkup.finish.tooManyLines",
} as const;

function tooMany(quota: keyof typeof QUOTA_KEYS): ActionResult<never> {
  // eslint-disable-next-line security/detect-object-injection -- `quota` is one of three literals
  return fail("TOO_MANY", { fieldErrors: { form: QUOTA_KEYS[quota] } });
}

/**
 * One row per question the PAYLOAD answers; a row goes only when the bike is
 * no longer asked its question at all — `asked`, the keys of the bike's FULL
 * plan.
 *
 * A stored row the payload does not carry is left exactly as it is: its part,
 * its note and its symptoms. It is still part of the run — read back on the
 * next load, counted by a finish — but a payload that did not answer it is
 * not a reason to rewrite it: until 2026-10-22 it was rewritten from the plan
 * the payload was accepted against, so a narrower page dropped its symptom
 * (the worn rim track of `.debug/017` §5.12, R5) and a page planned for
 * other parts moved it to theirs.
 *
 * A row the payload DOES carry is written from the plan it was accepted
 * against, part included: on the full checkup, its whole question's first
 * part, as every full checkup's row. That is how the resume banner still
 * moved a rear caliper's row to the front caliper after the filter above
 * (§5.12, B2: the banner page restored and posted every stored answer); it
 * stopped when a run whose rows tell its parts stopped being carried on as
 * the full checkup (`savedResumeTarget`, §5.13).
 *
 * Never "the rows the payload did not carry": until 2026-10-22 that was the
 * rule, and a payload planned from a scope naming no part carried none, and
 * `notIn: []` — which Prisma compiles to `1=1` — deleted every row of the run
 * (`.debug/017` §5.10). And never on an empty `asked`: a corpus that failed to
 * load plans nothing, and is not a reason to delete anything either.
 *
 * `updateMany` + `create`, not `upsert`: an upsert's `where` is a unique
 * selector and cannot carry the owner, and §4.7 is that the ownership predicate
 * is IN the query — `tests/security/checkup-input.test.ts` walks every recorded
 * call and fails on one that is not.
 */
async function writeItems(
  checkupId: string,
  userId: string,
  state: CheckupState,
  { asked, carried }: Pick<Accepted, "asked" | "carried">,
): Promise<void> {
  // `answeredItems` is the one definition of a row (`lib/checkup/items.ts`),
  // shared with the guest import: only a KO has a symptom, and `acceptedState`
  // has already dropped any the re-planned step does not offer.
  const answered = answeredItems(state)
    .filter((item) => carried.has(item.stepKey))
    .map((item) => ({ ...item, result: TO_PRISMA[item.result] }));

  const owned = { checkup: { bike: { userId } } };
  if (asked.size > 0) {
    await prisma.checkupItem.deleteMany({
      where: { checkupId, stepKey: { notIn: [...asked] }, ...owned },
    });
  }
  for (const item of answered) {
    const updated = await prisma.checkupItem.updateMany({
      where: { checkupId, stepKey: item.stepKey, ...owned },
      data: {
        result: item.result,
        notes: item.notes,
        partId: item.partId,
        reasonKeys: item.reasonKeys,
      },
    });
    if (updated.count === 0) await prisma.checkupItem.create({ data: { checkupId, ...item } });
  }
}

/**
 * Read a saved bike's checkup back, symptoms included.
 *
 * `null` means "nothing in progress and nothing finished" — a fresh checkup.
 */
export const loadCheckupAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<StoredCheckup | null>> => {
    const parsed = bikeOnlySchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");
    return ok(await loadStoredCheckup(parsed.data.bikeId, user.id, user.locale));
  },
);

/** The checkups of one bike, newest first — what a resume banner needs. */
export const listCheckupsAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<StoredCheckupSummary[]>> => {
    const parsed = bikeOnlySchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");

    const rows = await prisma.checkup.findMany({
      where: { bikeId: parsed.data.bikeId, bike: { userId: user.id } },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        scope: true,
        startedAt: true,
        completedAt: true,
        _count: { select: { items: true } },
      },
    });

    return ok(
      rows.map((row) => ({
        id: row.id,
        bikeRef: { kind: "db" as const, id: parsed.data.bikeId },
        scope: row.scope === "FULL" ? { kind: "full" as const } : { kind: "parts", partIds: [] },
        startedAt: row.startedAt.toISOString(),
        ...(row.completedAt === null ? {} : { completedAt: row.completedAt.toISOString() }),
        answered: row._count.items,
      })),
    );
  },
);

/** Autosave: the verdicts so far, against the plan the server just recomputed. */
export const saveCheckupAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<null>> => {
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");

    const build = await buildFor(user, parsed.data.bikeId);
    if (build === null) return fail("NOT_FOUND");

    const bikeId = parsed.data.bikeId;
    const run = await existingCheckup(bikeId, user.id, parsed.data.checkup.startedAt);
    const accepted = acceptedState(parsed.data.checkup, build, bikeId, run?.items ?? []);
    const { state, column } = accepted;
    let checkupId: string;
    if (run === null) {
      if (!(await roomForCheckup(bikeId, user.id))) return tooMany("checkups");
      checkupId = (await createCheckup(bikeId, column, state.startedAt)).id;
    } else {
      await writeColumn(run, user.id, column);
      checkupId = run.id;
    }
    await writeItems(checkupId, user.id, state, accepted);

    revalidatePath("/[locale]/velo/[id]", "page");
    return ok(null);
  },
);

/**
 * "Créer ma liste": close the checkup and write the list the server derives
 * from it (§5.4 — the browser never says what is on it).
 */
export const finishCheckupAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<{ buildListId: string }>> => {
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");

    const build = await buildFor(user, parsed.data.bikeId);
    if (build === null) return fail("NOT_FOUND");

    const bikeId = parsed.data.bikeId;
    const run = await existingCheckup(bikeId, user.id, parsed.data.checkup.startedAt);
    const accepted = acceptedState(parsed.data.checkup, build, bikeId, run?.items ?? []);
    const { state, column } = accepted;

    // Every quota is checked before the first write, so a refusal leaves the
    // checkup exactly as the visitor left it — nothing half-finished. Which
    // means every read the decision needs comes first: the run, the bike's
    // open list with the lines it already holds, and (for a re-finish) the
    // `CheckupItem` ids this run owns BEFORE `writeItems` rewrites them.
    const items = deriveBuildList(state);
    const derived = new Set(items.map((item) => pairKey(toBuildAction(item.action), item.partId)));
    let checkup: { id: string } | null = run;
    const open = await openList(bikeId, user.id);
    const { reFinish, pruned } = await reFinishOf(open, checkup, user.id, derived);

    // The lines the open list will HOLD, not the ones this checkup produced.
    const after = new Set([
      ...(open?.lines ?? []).filter((row) => !pruned.has(row.id)).map(rowPair),
      ...derived,
    ]);
    if (after.size > QUOTAS.itemsPerList) return tooMany("lines");
    if (open === null && !(await roomForList(bikeId, user.id))) return tooMany("lists");
    if (checkup === null) {
      if (!(await roomForCheckup(bikeId, user.id))) return tooMany("checkups");
      checkup = await createCheckup(bikeId, column, state.startedAt);
    }

    await writeItems(checkup.id, user.id, state, accepted);
    await prisma.checkup.updateMany({
      where: { id: checkup.id, bike: { userId: user.id } },
      data: { status: "COMPLETED", completedAt: new Date(), scope: column },
    });

    const buildListId = await writeBuildList({
      bikeId,
      userId: user.id,
      checkupId: checkup.id,
      items,
      open,
      pruned,
      reFinish,
    });
    await closeRecheckedItems(bikeId, user.id, state);
    await writePartStates(bikeId, user.id, state);

    revalidatePath("/[locale]/velo/[id]", "page");
    revalidatePath("/[locale]/velo/[id]/liste", "page");
    return ok({ buildListId });
  },
);

/** `(action, partId)` — the identity of a line, in the Prisma spelling. */
function pairKey(action: BuildAction, partId: string): string {
  return `${action}|${partId}`;
}

/** One line of the open list, as the merge needs to read it. */
interface OpenLine {
  id: string;
  partId: string;
  action: BuildAction;
  checkupItemId: string | null;
  done: boolean;
  doneReason: string | null;
}

const rowPair = (row: OpenLine): string => pairKey(row.action, row.partId);

/** The bike's one open list, as the merge reads it. */
interface OpenBuildList {
  id: string;
  /** The last checkup that wrote here — `null` on a list no checkup made. */
  checkupId: string | null;
  lines: OpenLine[];
}

/**
 * The bike's OPEN build list and the lines it holds, or `null`.
 *
 * The newest one, by exactly the rule `/liste` renders with
 * (`loadBuildList`): whatever this writes has to be what the visitor is then
 * shown. One query, its lines included — they are what both the line quota
 * and the merge read, and reading them twice would only invite the two to
 * disagree.
 */
async function openList(bikeId: string, userId: string): Promise<OpenBuildList | null> {
  const row = await prisma.buildList.findFirst({
    where: { bikeId, bike: { userId }, status: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      checkupId: true,
      items: {
        select: {
          id: true,
          partId: true,
          action: true,
          checkupItemId: true,
          done: true,
          doneReason: true,
        },
      },
    },
  });
  return row === null ? null : { id: row.id, checkupId: row.checkupId, lines: row.items };
}

/**
 * The `CheckupItem` ids this run owns, read BEFORE `writeItems` runs.
 *
 * Before, because `writeItems` deletes the row of a question that lost its
 * verdict, and `onDelete: SetNull` then nulls the `checkupItemId` of the line
 * that question produced — after which nothing could tell that line apart
 * from a line an older checkup left behind, and withdrawing a verdict would
 * leave its line on the list for ever.
 */
async function ownItemIds(checkupId: string, userId: string): Promise<Set<string>> {
  const rows = await prisma.checkupItem.findMany({
    where: { checkupId, checkup: { bike: { userId } } },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * Is this a RE-finish — the same run that last wrote to the open list — and
 * which of that list's lines may it therefore delete?
 *
 * The ones this very run wrote and no longer derives, because the visitor
 * withdrew the verdict behind them. Deliberately narrower than the guest's
 * `mergeGuestBuildList`, which also drops the survivors of earlier runs when
 * it prunes. The guest can: its `va:buildlist:<ref>` is rewritten whole. Here
 * one list is shared by every checkup the bike ever had — "lines survive
 * across checkups" is the W5 ruling — so deleting a line ANOTHER run found
 * would be data loss the visitor never asked for. A line of an earlier run
 * that this one contradicts is closed `recheck-ok` by
 * {@link closeRecheckedItems}, never deleted.
 */
async function reFinishOf(
  open: OpenBuildList | null,
  checkup: { id: string } | null,
  userId: string,
  derived: ReadonlySet<string>,
): Promise<{ reFinish: boolean; pruned: Set<string> }> {
  if (open === null || checkup === null || open.checkupId !== checkup.id) {
    return { reFinish: false, pruned: new Set() };
  }
  const own = await ownItemIds(checkup.id, userId);
  const pruned = open.lines
    .filter(
      (row) =>
        row.checkupItemId !== null && own.has(row.checkupItemId) && !derived.has(rowPair(row)),
    )
    .map((row) => row.id);
  return { reFinish: true, pruned: new Set(pruned) };
}

/**
 * This checkup's findings, merged into the bike's ONE open list (W5).
 *
 * Merged rather than replaced, for two different reasons now. `refinement`
 * and `chosenProduct` are the visitor's own edits (W3-T2) and a re-run must
 * not throw away the cassette they already chose; and the list is no longer
 * this checkup's — every line an earlier run left on it stays exactly as it
 * is unless this checkup says otherwise.
 *
 * A derived pair REOPENS its line: a KO is this checkup's finding, newer than
 * whatever closed the line before (the same rule as the guest's, which never
 * carries a `recheck-ok` onto a line a KO derived). The one exception is a
 * re-finish of the run that closed it BY HAND: `manual` is the visitor's own
 * tick on their own run, and pressing "Créer ma liste" a second time must not
 * undo it.
 */
async function writeBuildList(args: {
  bikeId: string;
  userId: string;
  checkupId: string;
  items: readonly BuildListItem[];
  /** The bike's open list as it was read before the first write, or `null`. */
  open: OpenBuildList | null;
  /** Line ids {@link reFinishOf} chose. */
  pruned: ReadonlySet<string>;
  /** Is this the same run as the one that last wrote to the open list? */
  reFinish: boolean;
}): Promise<string> {
  const { bikeId, userId, checkupId, items, open, pruned, reFinish } = args;
  const owned = { buildList: { bike: { userId } } };

  const list =
    open ??
    (await prisma.buildList.create({
      data: { bikeId, checkupId, name: "" },
      select: { id: true, checkupId: true },
    }));

  // `checkupId` is "who wrote here last", so a checkup that is not already it
  // takes it over. `updateMany`, with the owner in the `where` (§4.7).
  if (list.checkupId !== checkupId) {
    await prisma.buildList.updateMany({
      where: { id: list.id, bike: { userId } },
      data: { checkupId },
    });
  }

  if (pruned.size > 0) {
    await prisma.buildListItem.deleteMany({
      where: { id: { in: [...pruned] }, ...owned },
    });
  }

  const itemsByStepKey = new Map(
    (
      await prisma.checkupItem.findMany({
        where: { checkupId, checkup: { bike: { userId } } },
        select: { id: true, stepKey: true },
      })
    ).map((row) => [row.stepKey, row.id]),
  );

  const before = new Map((open?.lines ?? []).map((row) => [rowPair(row), row]));

  for (const item of items) {
    const action = toBuildAction(item.action);
    const where = { buildListId: list.id, partId: item.partId, action };
    const kept = before.get(pairKey(action, item.partId));
    // The guest's `ticked`, in Prisma: a hand tick survives a re-finish of its
    // own run; anything else — another run's tick, a `recheck-ok`, a line that
    // was open — comes back open.
    const handTicked =
      reFinish && kept !== undefined && kept.done && kept.doneReason !== "recheck-ok";
    const data = {
      reasonKey: item.reasonKey,
      guideSlug: item.guideSlug ?? null,
      sortOrder: item.sortOrder,
      checkupItemId: itemsByStepKey.get(item.stepKey) ?? null,
      // `refinement` and `chosenProduct` are the visitor's and are never here.
      ...(handTicked ? {} : { done: false, doneReason: null }),
    };
    const updated = await prisma.buildListItem.updateMany({ where: { ...where, ...owned }, data });
    if (updated.count === 0) {
      await prisma.buildListItem.create({ data: { ...where, done: item.done, ...data } });
    }
  }

  return list.id;
}

/**
 * §5.4 / §6.7: an OK closes a line that was already open — on the bike's list,
 * whichever list that is.
 *
 * The other half of the merge. `writeBuildList` writes what this checkup
 * FOUND; this closes what it contradicts: a partial checkup answered OK a
 * month later says the pads it once condemned are fine, and the line that
 * said to replace them is the answer. `done` is set with
 * `doneReason: 'recheck-ok'` rather than deleted — §5.4 wants the list to say
 * why a line closed, and a visitor who ticks a box by hand must stay
 * distinguishable from one the bike answered for.
 *
 * WHICH lines is `recheckedLines(state)` — the same rule the guest merge
 * applies — matched on `(action, partId)`, the identity of a line. It used to
 * be "every open line on a part some step answered OK", through the viewer's
 * host-expanded tint: a hosted part (the pads, reached through the caliper)
 * could never close, and a line with another action on the same part did.
 *
 * Until W5 it also skipped the list this checkup had just written, because
 * every checkup had a list of its own and closing a line on it would have
 * contradicted the KO that had just derived it. There is one list now, so
 * that exclusion had to go — and it is not needed: `recheckedLines` already
 * excludes every pair a KO of this same state derives.
 *
 * Every list of the bike, not only the open one: a bike from before W5 holds
 * one list per checkup, and an OK still closes what it contradicts there.
 */
async function closeRecheckedItems(
  bikeId: string,
  userId: string,
  state: CheckupState,
): Promise<void> {
  const lines = recheckedLines(state);
  if (lines.length === 0) return;

  await prisma.buildListItem.updateMany({
    where: {
      done: false,
      OR: lines.map((line) => ({ partId: line.partId, action: toBuildAction(line.action) })),
      buildList: { bikeId, bike: { userId } },
    },
    data: { done: true, doneReason: "recheck-ok" },
  });
}

function toBuildAction(action: string): BuildAction {
  // eslint-disable-next-line security/detect-object-injection -- `action` is a KoAction literal
  return TO_BUILD_ACTION[action];
}

/** The per-part tint the workspace shows after a checkup (§6.4). */
async function writePartStates(bikeId: string, userId: string, state: CheckupState): Promise<void> {
  for (const [partId, tone] of Object.entries(statusByPart(state))) {
    if (tone === "todo") continue;
    await prisma.bikePartState.updateMany({
      where: { bikeId, partId, bike: { userId } },
      data: { status: tone === "ok" ? "OK" : "ATTENTION" },
    });
  }
}
