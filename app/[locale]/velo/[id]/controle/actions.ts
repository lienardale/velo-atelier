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
 * ## What is stored, and what is not
 *
 * `CheckupItem` holds one row per answered step — `(stepKey, partId, guideSlug,
 * result, notes)`, unique on `(checkupId, stepKey)`. The chosen SYMPTOM has no
 * column of its own: it lands in the build list's `reasonKey` when the checkup
 * is finished, and `loadCheckupAction` reads it back from there. An in-progress
 * checkup on a saved bike therefore restores its verdicts but not its symptoms
 * after a reload (`docs/backlog.md`); a guest checkup, which keeps the whole
 * state in `localStorage`, restores both.
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
import { deriveBike } from "@/lib/bike/rules";
import { deriveBuildList, statusByPart } from "@/lib/checkup/build-list";
import { planCheckup, type PlannableGuide } from "@/lib/checkup/plan";
import { fromStored, type StoredCheckup, type StoredCheckupSummary } from "@/lib/checkup/storage";
import {
  CHECKUP_ANSWERS,
  type BuildListItem,
  type CheckStepRef,
  type CheckupScope,
  type CheckupState,
} from "@/lib/checkup/types";
import { GUIDES } from "@/lib/content/collection";
import { CONTENT_VERSION } from "@/lib/content/generated/version";
import { REASON_KEYS } from "@/lib/content/generated/reason-keys";
import { GUIDE_STEP_KEYS } from "@/lib/content/generated/slugs";
import { prisma } from "@/lib/db/prisma";
import { TOOL_IDS } from "@/lib/domain/data/tools";
import type { Answers } from "@/lib/domain/schema/decision";
import type { BikePart } from "@/lib/domain/schema/part";
import type { BuildAction, CheckupResult } from "@/lib/generated/prisma/client";
import { routing } from "@/lib/i18n/routing";

import { loadStoredCheckup } from "./load";

/*
 * Module-private on purpose: a `"use server"` file may only EXPORT async
 * functions — Next turns every export into a callable server reference and a
 * zod schema is an object, which fails the whole module at request time
 * (CLAUDE.md, `.debug/006`).
 */

const stepKeySchema = z.enum(GUIDE_STEP_KEYS);

const scopeSchema = z.union([
  z.object({ kind: z.literal("full") }).strict(),
  z
    .object({
      kind: z.literal("parts"),
      partIds: z.array(z.string().regex(/^[a-z0-9-]{1,48}$/)).max(64),
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
 * The bike, and the plan its stored answers imply.
 *
 * `null` when the bike is not this user's — the caller turns that into
 * `NOT_FOUND` without ever saying whether the id exists.
 */
async function planFor(
  user: ActionUser,
  bikeId: string,
  scope: CheckupScope,
): Promise<{ steps: CheckStepRef[] } | null> {
  const row = await prisma.bike.findFirst({
    where: { id: bikeId, userId: user.id },
    select: { answers: true, parts: true },
  });
  if (row === null) return null;

  const derived = deriveBike(row.answers as Answers, asParts(row.parts));
  // The French corpus: both locales carry the same steps, and a plan's keys are
  // locale-independent, so the plan a visitor gets does not depend on the
  // language they read it in.
  const guides = GUIDES.filter(
    (guide) => guide.locale === routing.defaultLocale,
  ) as unknown as PlannableGuide[];
  return { steps: planCheckup({ spec: derived.spec, parts: derived.parts }, scope, guides) };
}

function asParts(value: unknown): BikePart[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.filter(
    (part): part is BikePart =>
      typeof part === "object" && part !== null && typeof (part as BikePart).partId === "string",
  );
  return parts.length > 0 ? parts : undefined;
}

/** The payload, restricted to the plan the server just computed. */
function acceptedState(
  payload: z.infer<typeof checkupSchema>,
  steps: readonly CheckStepRef[],
  bikeId: string,
): CheckupState {
  const stored: StoredCheckup = {
    version: 1,
    id: payload.id,
    bikeRef: { kind: "db", id: bikeId },
    scope: payload.scope as CheckupScope,
    locale: payload.locale,
    answers: payload.answers as StoredCheckup["answers"],
    symptoms: payload.symptoms as StoredCheckup["symptoms"],
    notes: payload.notes as StoredCheckup["notes"],
    toolsMissing: payload.toolsMissing,
    startedAt: payload.startedAt,
    ...(payload.completedAt === undefined ? {} : { completedAt: payload.completedAt }),
    contentVersion: payload.contentVersion,
  };
  // `fromStored` reconciles: keys that are not in the plan and symptoms the
  // step does not offer are gone by the time anything is written.
  return fromStored(stored, steps, CONTENT_VERSION);
}

/** The in-progress checkup of this bike, or a new one. */
async function currentCheckup(
  bikeId: string,
  userId: string,
  scope: CheckupScope,
  startedAt: string,
): Promise<{ id: string }> {
  const existing = await prisma.checkup.findFirst({
    where: { bikeId, status: "IN_PROGRESS", bike: { userId } },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (existing !== null) return existing;
  return prisma.checkup.create({
    data: {
      bikeId,
      scope: scope.kind === "full" ? "FULL" : "PARTIAL",
      startedAt: new Date(startedAt),
    },
    select: { id: true },
  });
}

/** One row per answered step; the rows of steps that lost their verdict go. */
async function writeItems(checkupId: string, state: CheckupState): Promise<void> {
  const answered = state.steps.flatMap((step) => {
    const result = Object.hasOwn(state.answers, step.key) ? state.answers[step.key] : undefined;
    if (result === undefined) return [];
    return [
      {
        stepKey: step.key,
        partId: step.partIds[0],
        guideSlug: step.guideSlug,
        // eslint-disable-next-line security/detect-object-injection -- `result` is a CheckupAnswer literal
        result: TO_PRISMA[result],
        notes: Object.hasOwn(state.notes, step.key) ? state.notes[step.key] : null,
      },
    ];
  });

  await prisma.checkupItem.deleteMany({
    where: { checkupId, stepKey: { notIn: answered.map((item) => item.stepKey) } },
  });
  for (const item of answered) {
    await prisma.checkupItem.upsert({
      where: { checkupId_stepKey: { checkupId, stepKey: item.stepKey } },
      create: { checkupId, ...item },
      update: { result: item.result, notes: item.notes, partId: item.partId },
    });
  }
}

/**
 * Read a saved bike's checkup back, symptoms included when a list was created.
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

    const planned = await planFor(
      user,
      parsed.data.bikeId,
      parsed.data.checkup.scope as CheckupScope,
    );
    if (planned === null) return fail("NOT_FOUND");

    const state = acceptedState(parsed.data.checkup, planned.steps, parsed.data.bikeId);
    const checkup = await currentCheckup(parsed.data.bikeId, user.id, state.scope, state.startedAt);
    await writeItems(checkup.id, state);

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

    const planned = await planFor(
      user,
      parsed.data.bikeId,
      parsed.data.checkup.scope as CheckupScope,
    );
    if (planned === null) return fail("NOT_FOUND");

    const state = acceptedState(parsed.data.checkup, planned.steps, parsed.data.bikeId);
    const checkup = await currentCheckup(parsed.data.bikeId, user.id, state.scope, state.startedAt);
    await writeItems(checkup.id, state);
    await prisma.checkup.updateMany({
      where: { id: checkup.id, bike: { userId: user.id } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    const buildListId = await writeBuildList(
      parsed.data.bikeId,
      checkup.id,
      deriveBuildList(state),
    );
    await writePartStates(parsed.data.bikeId, user.id, state);

    revalidatePath("/[locale]/velo/[id]", "page");
    revalidatePath("/[locale]/velo/[id]/liste", "page");
    return ok({ buildListId });
  },
);

/**
 * The derived list, merged into the bike's list for this checkup.
 *
 * Merged rather than replaced: `done`, `refinement` and `chosenProduct` are the
 * visitor's own edits (W3-T2) and a re-run of the same checkup must not throw
 * away the cassette they already chose. Lines the checkup no longer produces
 * are removed; everything else keeps its row.
 */
async function writeBuildList(
  bikeId: string,
  checkupId: string,
  items: readonly BuildListItem[],
): Promise<string> {
  const existing = await prisma.buildList.findUnique({
    where: { checkupId },
    select: { id: true },
  });
  const list =
    existing ??
    (await prisma.buildList.create({
      data: { bikeId, checkupId, name: "" },
      select: { id: true },
    }));

  const itemsByStepKey = new Map(
    (
      await prisma.checkupItem.findMany({
        where: { checkupId },
        select: { id: true, stepKey: true },
      })
    ).map((row) => [row.stepKey, row.id]),
  );

  const keep = new Set(items.map((item) => `${item.partId}|${toBuildAction(item.action)}`));
  const stale = (
    await prisma.buildListItem.findMany({
      where: { buildListId: list.id },
      select: { id: true, partId: true, action: true },
    })
  ).filter((row) => !keep.has(`${row.partId}|${row.action}`));
  if (stale.length > 0) {
    await prisma.buildListItem.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  }

  for (const item of items) {
    const data = {
      reasonKey: item.reasonKey,
      guideSlug: item.guideSlug ?? null,
      sortOrder: item.sortOrder,
      checkupItemId: itemsByStepKey.get(item.stepKey) ?? null,
    };
    await prisma.buildListItem.upsert({
      where: {
        buildListId_partId_action: {
          buildListId: list.id,
          partId: item.partId,
          action: toBuildAction(item.action),
        },
      },
      create: {
        buildListId: list.id,
        partId: item.partId,
        action: toBuildAction(item.action),
        done: item.done,
        ...data,
      },
      // `done` and the visitor's own columns are deliberately NOT in the update.
      update: data,
    });
  }

  return list.id;
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
