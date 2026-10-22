"use server";

/**
 * The build list of one saved bike (§4.4, §5.5).
 *
 * Three writes, and every one of them is an edit the VISITOR made to a list the
 * checkup produced: a line ticked off, a refinement chosen, the done lines
 * cleared. Nothing here derives a list — that is `deriveBuildList` — and
 * nothing here creates one. One read, for the buying guide's `?item=`.
 *
 * Ownership is in the `where`, nested twice (`buildList: { bike: { userId } }`):
 * an item id that is not the caller's simply finds no row, which is
 * `NOT_FOUND`, never `FORBIDDEN` (§4.7 — a 403 would confirm the id exists).
 *
 * The refinement is a `Json` column, so it is capped on both axes before it is
 * written: keys and values are attribute-sized, and the whole object has to fit
 * the JSON budget every other JSON column is held to (`withinJsonBudget`). A
 * guest's list is bounded by `localStorage` itself; a saved one is bounded
 * here.
 *
 * `"use server"` files export only async functions, so the input schemas are
 * module-private (a `const` schema exported from here fails the module at
 * request time — CLAUDE.md, `.debug/006`).
 */

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { withUser } from "@/lib/actions/with-user";
import { withinJsonBudget } from "@/lib/bike/rules";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  isRefinementKey,
  MAX_REFINEMENT_ENTRIES,
  MAX_REFINEMENT_VALUE_LENGTH,
  refinementOf,
} from "@/lib/shop/refinement";

/**
 * A refinement answer is an attribute key and a value a control produced.
 *
 * Both rules are `lib/shop/refinement.ts`'s. The key is `isRefinementKey`:
 * the domain's own id pattern, 1 to 64 characters — which already excludes
 * `__proto__` (underscores) — and neither `constructor` nor `prototype`,
 * which are all-lowercase and would pass: this object is written to a `Json`
 * column and read back into a record, and a key that means something to an
 * object does not belong in stored data, whatever the reader does with it.
 * The value is at most the cap the form's inputs stop at.
 *
 * Until 2026-10-13 the pattern, the three names and the literal 64 were
 * written out here. What this action accepts has not changed — the cases of
 * `tests/integration/build-lists.test.ts` and of
 * `tests/security/build-list-actions.test.ts` were not touched. The rule
 * moved because the import's contract and every reader have to apply the same
 * one: see that module's header.
 */
const refinementSchema = z.record(
  z.string().refine(isRefinementKey, "errors.VALIDATION"),
  z.string().max(MAX_REFINEMENT_VALUE_LENGTH),
);

const setDoneSchema = z.object({ itemId: z.uuid("errors.VALIDATION"), done: z.boolean() }).strict();

const setRefinementSchema = z
  .object({ itemId: z.uuid("errors.VALIDATION"), refinement: refinementSchema })
  .strict();

const clearDoneSchema = z.object({ buildListId: z.uuid("errors.VALIDATION") }).strict();

const readItemSchema = z
  .object({ bikeId: z.uuid("errors.VALIDATION"), itemId: z.uuid("errors.VALIDATION") })
  .strict();

/**
 * A `Json` column is a shape we WROTE, not one we can assume on read: the row's
 * refinement through the one reader of a stored refinement (`refinementOf`) —
 * the entries the list's loader hands the page, by the same function, count
 * included. This reader has no rule of its own any more.
 *
 * Until 2026-10-13 it was a copy of the loader's filter with the three names
 * added, and the one copy no test held: its bound set to 5 000 characters, or
 * the column returned unfiltered, left every tier green (measured in review;
 * the first of the two measured again before this was rewritten). Until
 * 2026-10-22 it then kept the first 24 entries itself — the one reader that
 * applied the count, and the one whose answer is never sent back: the
 * loader, whose answer is, handed a 30-answer row over whole (`.debug/017`
 * §5.9, V1-1).
 */
function storedRefinement(value: unknown): Record<string, string> {
  return refinementOf(value) ?? {};
}

/**
 * Tick a line off, or untick it. `doneReason` is always `manual` from here —
 * the only other reason, `recheck-ok`, is the checkup's to write — and goes
 * back to `null` when the box is unticked.
 */
export const setBuildListItemDoneAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<null>> => {
    const parsed = setDoneSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");

    const updated = await prisma.buildListItem.updateMany({
      where: { id: parsed.data.itemId, buildList: { bike: { userId: user.id } } },
      data: { done: parsed.data.done, doneReason: parsed.data.done ? "manual" : null },
    });
    if (updated.count === 0) return fail("NOT_FOUND");

    revalidatePath("/[locale]/velo/[id]/liste", "page");
    return ok(null);
  },
);

/** Replace one item's buying-guide answers. A patch would leave stale keys behind. */
export const setBuildListItemRefinementAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<null>> => {
    const parsed = setRefinementSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");

    const refinement = parsed.data.refinement;
    if (Object.keys(refinement).length > MAX_REFINEMENT_ENTRIES) return fail("TOO_MANY");
    if (!withinJsonBudget(refinement)) return fail("TOO_MANY");

    const updated = await prisma.buildListItem.updateMany({
      where: { id: parsed.data.itemId, buildList: { bike: { userId: user.id } } },
      data: { refinement: refinement as Prisma.InputJsonValue },
    });
    if (updated.count === 0) return fail("NOT_FOUND");

    revalidatePath("/[locale]/velo/[id]/liste", "page");
    return ok(null);
  },
);

/**
 * "Retirer ce qui est fait": delete every done item of one list.
 *
 * By list rather than by id: the visitor pressed one button meaning "clear
 * them", and sending the ids back would let a stale tab delete a line someone
 * unticked in the meantime.
 */
export const clearDoneBuildListItemsAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<{ removed: number }>> => {
    const parsed = clearDoneSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");

    const list = await prisma.buildList.findFirst({
      where: { id: parsed.data.buildListId, bike: { userId: user.id } },
      select: { id: true },
    });
    if (list === null) return fail("NOT_FOUND");

    // The owner is in THIS query too, not only in the `findFirst` above: one
    // predicate per query, never "the previous one covered it" (§4.7).
    const removed = await prisma.buildListItem.deleteMany({
      where: { buildListId: list.id, done: true, buildList: { bike: { userId: user.id } } },
    });

    revalidatePath("/[locale]/velo/[id]/liste", "page");
    return ok({ removed: removed.count });
  },
);

/**
 * One line of a saved bike's list, for the buying guide's
 * `/acheter?part=&bike=&item=` (§5.5): the answers the visitor already gave in
 * that line's refinement form, so the guide opens pre-filled.
 *
 * A read, and still an action: `/acheter` is a static page whose part panel is
 * chosen in the browser, so the lookup can only happen after hydration — a
 * POST carrying an `Origin`, which is what `withUser` asks for. The owner is in
 * the `where`, with the bike: another person's line, or a line of another of
 * your bikes, finds nothing and is `NOT_FOUND` — 404, never 403 (§4.7).
 */
export const loadBuildListItemAction = withUser(
  async (
    { user },
    input: unknown,
  ): Promise<ActionResult<{ partId: string; refinement: Record<string, string> }>> => {
    const parsed = readItemSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION");

    const row = await prisma.buildListItem.findFirst({
      where: {
        id: parsed.data.itemId,
        buildList: { bikeId: parsed.data.bikeId, bike: { userId: user.id } },
      },
      select: { partId: true, refinement: true },
    });
    if (row === null) return fail("NOT_FOUND");
    return ok({ partId: row.partId, refinement: storedRefinement(row.refinement) });
  },
);
