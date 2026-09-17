"use server";

/**
 * The garage: create, re-describe, rename and delete a saved bike (§4.4).
 *
 * ## `answers` in, everything else derived
 *
 * A caller sends answers — the decision tree's own output — and nothing else.
 * `spec` and `parts` are computed here by `deriveBike` and written in the same
 * statement, so the three JSON columns can never disagree, and a payload
 * carrying its own `spec` is refused by `.strict()` before it is read (§4.7
 * mass assignment).
 *
 * ## Part states
 *
 * One `BikePartState` per fitted part, created `UNKNOWN`. When the answers
 * change, `partStateDiff` adds the rows for parts that appeared and deletes the
 * ones whose part is gone; every other row keeps its status, its notes and its
 * service dates, because replacing a cassette does not un-service the chain
 * (§4.2 a). The bike and its states move together, in one `$transaction`.
 *
 * ## Quota
 *
 * Twenty bikes per account (`QUOTAS.bikesPerUser`), counted inside the same
 * request that creates the twenty-first — answered `TOO_MANY`, which is a
 * sentence the form can show, rather than a unique-constraint stack trace.
 */

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { withUser } from "@/lib/actions/with-user";
import {
  BIKE_NAME_MAX,
  deriveBike,
  partStateDiff,
  QUOTAS,
  withinJsonBudget,
  withinQuota,
} from "@/lib/bike/rules";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { QUESTION_IDS } from "@/lib/domain/data/decision-tree";
import type { Answers } from "@/lib/domain/schema/decision";
import type { BikePart } from "@/lib/domain/schema/part";

const nameSchema = z
  .string()
  .trim()
  .min(1, "bike.errors.nameRequired")
  .max(BIKE_NAME_MAX, "bike.errors.nameTooLong");

/**
 * The decision tree's answers: a **partial** map from a known question id to an
 * option id. `partialRecord`, not `record`: zod 4's `record` with an enum key
 * requires every key to be present, and no bike answers all twelve questions —
 * a muscular bike is never asked about its battery. Unknown question ids are
 * refused rather than dropped: an answer this site never asked for is a payload
 * somebody wrote by hand.
 */
const answersSchema = z.partialRecord(
  z.enum(QUESTION_IDS),
  z.string().regex(/^[a-z0-9-]{1,32}$/, "errors.VALIDATION"),
);

const createBikeSchema = z
  .object({ name: nameSchema, answers: answersSchema, guestLocalId: z.uuid().optional() })
  .strict();

const updateBikeSchema = z.object({ bikeId: z.uuid(), answers: answersSchema }).strict();

const renameBikeSchema = z.object({ bikeId: z.uuid(), name: nameSchema }).strict();

const deleteBikeSchema = z.object({ bikeId: z.uuid() }).strict();

export interface SavedBike {
  id: string;
  name: string;
}

function fieldErrorsOf(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : "form";
    const key = /^(errors|bike)\./.test(issue.message) ? issue.message : "errors.VALIDATION";
    // eslint-disable-next-line security/detect-object-injection -- a zod path segment into a fresh object
    errors[field] ??= key;
  }
  return errors;
}

/**
 * A JSON column's value. Prisma's `InputJsonValue` is an object/array union
 * that a precise array type (`BikePart[]`) does not structurally satisfy, and
 * the alternative — typing the domain's arrays as index signatures — would
 * weaken the domain to please the ORM.
 */
function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** A new bike from a set of answers — the decision tree's "Générer mon vélo" for a signed-in visitor. */
export const createBikeAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<SavedBike>> => {
    const parsed = createBikeSchema.safeParse(input);
    if (!parsed.success) {
      return fail("VALIDATION", { fieldErrors: fieldErrorsOf(parsed.error.issues) });
    }

    const existing = await prisma.bike.count({ where: { userId: user.id } });
    if (!withinQuota(existing, QUOTAS.bikesPerUser)) return fail("TOO_MANY");

    const derived = deriveBike(parsed.data.answers as Answers);
    if (!withinJsonBudget(derived.parts)) return fail("TOO_MANY");

    const bike = await prisma.bike.create({
      data: {
        userId: user.id,
        name: parsed.data.name,
        answers: json(derived.answers),
        spec: json(derived.spec),
        parts: json(derived.parts),
        ...(parsed.data.guestLocalId === undefined
          ? {}
          : { guestLocalId: parsed.data.guestLocalId }),
        partStates: {
          create: derived.parts.map((part) => ({
            partId: part.partId,
            status: "UNKNOWN" as const,
          })),
        },
      },
      select: { id: true, name: true },
    });

    revalidatePath("/[locale]/(protected)/mes-velos", "page");
    return ok(bike);
  },
);

/** New answers for an existing bike: spec, parts and part states all follow (§4.2 a). */
export const updateBikeAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<SavedBike>> => {
    const parsed = updateBikeSchema.safeParse(input);
    if (!parsed.success) {
      return fail("VALIDATION", { fieldErrors: fieldErrorsOf(parsed.error.issues) });
    }

    const row = await prisma.bike.findFirst({
      where: { id: parsed.data.bikeId, userId: user.id },
      select: { id: true, name: true, parts: true, partStates: { select: { partId: true } } },
    });
    if (row === null) return fail("NOT_FOUND");

    const previous = Array.isArray(row.parts) ? (row.parts as unknown as BikePart[]) : undefined;
    const derived = deriveBike(parsed.data.answers as Answers, previous);
    if (!withinJsonBudget(derived.parts)) return fail("TOO_MANY");

    const diff = partStateDiff(
      row.partStates.map((state) => state.partId),
      derived.parts.map((part) => part.partId),
    );

    await prisma.$transaction([
      prisma.bike.updateMany({
        where: { id: row.id, userId: user.id },
        data: {
          answers: json(derived.answers),
          spec: json(derived.spec),
          parts: json(derived.parts),
        },
      }),
      ...(diff.remove.length === 0
        ? []
        : [
            prisma.bikePartState.deleteMany({
              where: { bikeId: row.id, partId: { in: diff.remove }, bike: { userId: user.id } },
            }),
          ]),
      ...diff.create.map((partId) =>
        prisma.bikePartState.create({ data: { bikeId: row.id, partId, status: "UNKNOWN" } }),
      ),
    ]);

    revalidatePath("/[locale]/velo/[id]", "page");
    revalidatePath("/[locale]/(protected)/mes-velos", "page");
    return ok({ id: row.id, name: row.name });
  },
);

export const renameBikeAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<SavedBike>> => {
    const parsed = renameBikeSchema.safeParse(input);
    if (!parsed.success) {
      return fail("VALIDATION", { fieldErrors: fieldErrorsOf(parsed.error.issues) });
    }

    const updated = await prisma.bike.updateMany({
      where: { id: parsed.data.bikeId, userId: user.id },
      data: { name: parsed.data.name },
    });
    if (updated.count === 0) return fail("NOT_FOUND");

    revalidatePath("/[locale]/velo/[id]", "page");
    revalidatePath("/[locale]/(protected)/mes-velos", "page");
    return ok({ id: parsed.data.bikeId, name: parsed.data.name });
  },
);

/** Everything below the bike cascades (`onDelete: Cascade` from `Bike`). */
export const deleteBikeAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<null>> => {
    const parsed = deleteBikeSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");

    const deleted = await prisma.bike.deleteMany({
      where: { id: parsed.data.bikeId, userId: user.id },
    });
    if (deleted.count === 0) return fail("NOT_FOUND");

    revalidatePath("/[locale]/(protected)/mes-velos", "page");
    return ok(null);
  },
);
