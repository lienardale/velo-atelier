"use server";

/**
 * The fit of one saved bike (§4.4, §5.6).
 *
 * Only measurements — an inseam, a saddle height, a rider's weight. They are
 * kept in `Bike.fit` as a flat JSON map of numbers because nothing ever filters
 * on them and their set changes whenever the fit page grows a card (§4.2's note
 * on JSON columns).
 *
 * The ranges are `lib/bike/rules.ts`'s (`parseFit`), which is also what the
 * guest repo applies before writing `localStorage`: a value the server refuses
 * is a value the browser refuses, so "it saved on my phone but not on my
 * laptop" cannot happen. `parseFit` is deliberately all-or-nothing — an unknown
 * key is a rejected payload, not a silently dropped field (mass assignment,
 * §4.7).
 */

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { withUser } from "@/lib/actions/with-user";
import { coerceFit, mergeFit, parseFit, withinJsonBudget, type BikeFit } from "@/lib/bike/rules";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

const updateBikeFitSchema = z
  .object({
    bikeId: z.uuid("errors.VALIDATION"),
    fit: z.record(z.string().max(64), z.nullable(z.number().finite())),
  })
  .strict();

/**
 * Merge `fit` into the bike's stored measurements.
 *
 * A patch, not a replacement: the pressure card saves a rider weight without
 * knowing (or clearing) the saddle height the fit card wrote a minute earlier.
 */
export const updateBikeFitAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<BikeFit>> => {
    const parsed = updateBikeFitSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");

    const patch = parseFit(parsed.data.fit);
    if (patch === null)
      return fail("VALIDATION", { fieldErrors: { form: "bike.errors.fitRange" } });

    const row = await prisma.bike.findFirst({
      where: { id: parsed.data.bikeId, userId: user.id },
      select: { fit: true },
    });
    if (row === null) return fail("NOT_FOUND");

    const fit = mergeFit(coerceFit(row.fit), patch);
    if (!withinJsonBudget(fit)) return fail("TOO_MANY");

    const updated = await prisma.bike.updateMany({
      where: { id: parsed.data.bikeId, userId: user.id },
      data: { fit: fit as Prisma.InputJsonValue },
    });
    if (updated.count === 0) return fail("NOT_FOUND");

    revalidatePath("/[locale]/velo/[id]", "page");
    return ok(fit);
  },
);
