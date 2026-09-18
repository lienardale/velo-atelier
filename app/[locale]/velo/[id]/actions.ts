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
 */

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions/result";
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
 * Edit one part: its attributes, what is actually installed on the bike, its
 * status and the owner's notes. Returns the build as stored, so the panel can
 * render the result without a round trip through the page.
 */
export const updateBikePartAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<BikeBuild>> => {
    const parsed = updateBikePartSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");
    const { bikeId, partId, attributes, installed, status, notes } = parsed.data;

    const row = await prisma.bike.findFirst({
      where: { id: bikeId, userId: user.id },
      select: { id: true, answers: true, parts: true },
    });
    if (row === null) return fail("NOT_FOUND");

    const derived = deriveBike(row.answers as Answers, asParts(row.parts));
    let build: BikeBuild = { spec: derived.spec, parts: derived.parts };
    if (build.parts.every((part) => part.partId !== partId)) return fail("NOT_FOUND");

    for (const [key, value] of Object.entries(attributes ?? {})) {
      const change = setAttribute(build, partId, key, value);
      if (!change.ok) {
        return change.code === "unknown-part" || change.code === "part-not-fitted"
          ? fail("NOT_FOUND")
          : fail("VALIDATION", { fieldErrors: { [key]: `bike.errors.${change.code}` } });
      }
      build = change.build;
    }

    if (!withinJsonBudget(build.parts, MAX_JSON_BYTES)) return fail("TOO_MANY");

    const updated = await prisma.bike.updateMany({
      where: { id: bikeId, userId: user.id },
      data: { parts: json(build.parts), spec: json(build.spec) },
    });
    if (updated.count === 0) return fail("NOT_FOUND");

    if (status !== undefined || notes !== undefined || installed !== undefined) {
      const data = {
        ...(status === undefined ? {} : { status }),
        ...(notes === undefined ? {} : { notes }),
        ...(installed === undefined ? {} : { installed }),
      };
      const touched = await prisma.bikePartState.updateMany({
        where: { bikeId, partId, bike: { userId: user.id } },
        data,
      });
      if (touched.count === 0) {
        // A part state can be missing on a bike written before the part existed:
        // the ownership check above has already proven this bike is the caller's.
        await prisma.bikePartState.create({ data: { bikeId, partId, ...data } });
      }
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
