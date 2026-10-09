"use server";

/**
 * Writes to one part of one saved bike (§4.4).
 *
 * The shape every action in this project has, for the reasons `CLAUDE.md`
 * lists: `withUser()` (same origin + a session, in that order), a `.strict()`
 * zod schema (so `userId`, `spec` or `createdAt` in the payload is a **rejected**
 * submission, not an ignored field), an ownership predicate that names the owner
 * **inside the query**, and an `ActionResult`.
 *
 * ## Why the build is rebuilt, not patched
 *
 * `answers` is the source of truth (§1.2). The action reads the answers, derives
 * the build exactly as the page did, applies the edit through the domain
 * (`setAttribute`, which knows that a caliper's `rotor-size` follows its `mount`),
 * and re-validates the whole thing before it is stored. A payload that tried to
 * put a 203 mm rotor on a rim-brake bike therefore fails on the way in, not the
 * next time somebody reads the row.
 *
 * ## Ownership
 *
 * `updateMany({ where: { id, userId } })`, never `update({ where: { id } })`
 * after an `if (bike.userId !== user.id)`. A foreign id matches no row, and no
 * row is `NOT_FOUND` — 404, never 403 (§4.7). `tests/security/idor.test.ts`
 * replays every one of these with another user's ids.
 *
 * ## Two calls for one bike at once: the row is locked BEFORE it is read
 *
 * The edit is read-modify-write on one JSON column: read `parts`, change one
 * attribute, write the whole array back. Until 2026-10-09 nothing was held in
 * between, on the understanding that Next's client sends server actions one
 * at a time. It does — until a navigation arrives: the navigation takes the
 * pending action's turn and the next action is sent AT ONCE
 * (`next/dist/client/components/app-router-instance.js`, read). The part
 * form's write on removal (`components/bike/PartEditForm.tsx`, rule 3) is
 * dispatched exactly then. Two calls read the same row, each wrote its own
 * edit over the other's, and both answered ok: a select changed and a width
 * typed, then history back, lost one of the two in five runs of six
 * (`.debug/017` §5.8, "Review of the fix"; two selects and a route change lost one before
 * rule 3 existed). Two tabs, or two devices, need no navigation at all.
 *
 * So the whole edit is one interactive transaction whose FIRST statement is an
 * `UPDATE` of the bike row — the ownership predicate in it — which takes the
 * row's lock: a second call for the same bike waits on that statement until
 * the first commits, and under READ COMMITTED (pinned below) the read that
 * follows sees what the first wrote. No raw `SELECT … FOR UPDATE`
 * (`tests/security/sql-injection.test.ts`, and `expectScopedToUser` could not
 * read one), no retry loop, and nothing Prisma would log as an error.
 *
 * A refusal decided after the lock is THROWN ({@link Refusal}), so that the
 * transaction rolls back: a refused edit must not leave the lock's own write —
 * a newer `updatedAt`, which is what "Mes vélos" sorts by — behind it.
 * `tests/integration/bikes.test.ts` holds both halves on PostgreSQL.
 */

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { fail, ok, type ActionFailure, type ActionResult } from "@/lib/actions/result";
import { withUser } from "@/lib/actions/with-user";
import { deriveBike, MAX_JSON_BYTES, withinJsonBudget } from "@/lib/bike/rules";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { setAttribute } from "@/lib/domain/engine/validate-build";
import type { Answers } from "@/lib/domain/schema/decision";
import type { BikeBuild, BikePart } from "@/lib/domain/schema/part";

/*
 * The schemas below are NOT exported. A `"use server"` module may only export
 * async functions — Next turns every export into a callable server reference,
 * and a zod schema is an object, which fails the whole module at request time
 * with "A use server file can only export async functions, found object"
 * (observed 2026-09-17, W2-T3; `.debug/006`).
 */

/** Attribute values as they arrive from a form: `null` clears the attribute. */
const attributeValueSchema = z.union([z.string().max(64), z.number().finite(), z.boolean()]);

const idSchema = z.string().regex(/^[a-z0-9-]{1,64}$/, "errors.VALIDATION");

const updateBikePartSchema = z
  .object({
    bikeId: z.uuid("errors.VALIDATION"),
    partId: idSchema,
    attributes: z.record(idSchema, z.nullable(attributeValueSchema)).optional(),
    installed: z
      .object({
        brand: z.string().max(64).optional(),
        model: z.string().max(64).optional(),
        sizeLabel: z.string().max(64).optional(),
      })
      .strict()
      .optional(),
    status: z.enum(["OK", "ATTENTION", "BROKEN", "UNKNOWN"]).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export type UpdateBikePartInput = z.infer<typeof updateBikePartSchema>;

/**
 * An expected failure found INSIDE the transaction. Still returned to the
 * caller, never thrown at it — it only travels as an exception as far as the
 * transaction's edge, because that is the one way to make Prisma roll back.
 * Not exported: a `"use server"` module exports async functions only.
 */
class Refusal extends Error {
  constructor(readonly failure: ActionFailure) {
    super(failure.code);
  }
}

/**
 * Edit one part: its attributes, what is actually installed on the bike, its
 * status and the owner's notes. Returns the build as stored, so the panel can
 * render the result without a round trip through the page.
 */
export const updateBikePartAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<BikeBuild>> => {
    const parsed = updateBikePartSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");
    const { bikeId, partId, attributes, installed, status, notes } = parsed.data;

    let build: BikeBuild;
    try {
      build = await prisma.$transaction(
        async (tx) => {
          // The lock (see the header). `updatedAt` is what any update of this
          // row sets anyway; naming it is what makes this statement an UPDATE.
          const locked = await tx.bike.updateMany({
            where: { id: bikeId, userId: user.id },
            data: { updatedAt: new Date() },
          });
          if (locked.count === 0) throw new Refusal(fail("NOT_FOUND"));

          const row = await tx.bike.findFirst({
            where: { id: bikeId, userId: user.id },
            select: { id: true, answers: true, parts: true },
          });
          if (row === null) throw new Refusal(fail("NOT_FOUND"));

          const derived = deriveBike(row.answers as Answers, asParts(row.parts));
          let edited: BikeBuild = { spec: derived.spec, parts: derived.parts };
          if (edited.parts.every((part) => part.partId !== partId)) {
            throw new Refusal(fail("NOT_FOUND"));
          }

          for (const [key, value] of Object.entries(attributes ?? {})) {
            const change = setAttribute(edited, partId, key, value);
            if (!change.ok) {
              throw new Refusal(
                change.code === "unknown-part" || change.code === "part-not-fitted"
                  ? fail("NOT_FOUND")
                  : fail("VALIDATION", { fieldErrors: { [key]: `bike.errors.${change.code}` } }),
              );
            }
            edited = change.build;
          }

          if (!withinJsonBudget(edited.parts, MAX_JSON_BYTES)) {
            throw new Refusal(fail("TOO_MANY"));
          }

          const updated = await tx.bike.updateMany({
            where: { id: bikeId, userId: user.id },
            data: { parts: json(edited.parts), spec: json(edited.spec) },
          });
          if (updated.count === 0) throw new Refusal(fail("NOT_FOUND"));

          if (status !== undefined || notes !== undefined || installed !== undefined) {
            const data = {
              ...(status === undefined ? {} : { status }),
              ...(notes === undefined ? {} : { notes }),
              ...(installed === undefined ? {} : { installed }),
            };
            const touched = await tx.bikePartState.updateMany({
              where: { bikeId, partId, bike: { userId: user.id } },
              data,
            });
            if (touched.count === 0) {
              // A part state can be missing on a bike written before the part existed:
              // the ownership check above has already proven this bike is the caller's.
              await tx.bikePartState.create({ data: { bikeId, partId, ...data } });
            }
          }

          return edited;
        },
        { isolationLevel: "ReadCommitted" },
      );
    } catch (error) {
      if (error instanceof Refusal) return error.failure;
      throw error;
    }

    revalidatePath("/[locale]/velo/[id]", "page");
    return ok(build);
  },
);

/**
 * A JSON column's value. Prisma's `InputJsonValue` is an object/array union
 * that a precise array type (`BikePart[]`) does not structurally satisfy, and
 * the alternative — typing the domain's arrays as index signatures — would
 * weaken the domain to please the ORM.
 */
function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** The stored `parts` JSON, as something `deriveBike` can carry edits across from. */
function asParts(value: unknown): BikePart[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.filter(
    (part): part is BikePart =>
      typeof part === "object" && part !== null && typeof (part as BikePart).partId === "string",
  );
  return parts.length > 0 ? parts : undefined;
}
