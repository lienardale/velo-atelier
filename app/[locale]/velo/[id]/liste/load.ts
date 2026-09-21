import "server-only";

/**
 * Reading a saved bike's build list — from the PAGE, not from an action.
 *
 * The same split as `controle/load.ts`, for the same two reasons: a document
 * GET carries no `Origin` header, so `withUser` would refuse it; and a
 * `"use server"` file turns every export into a callable server reference, so a
 * function that takes a `userId` must never live in `actions.ts`.
 *
 * One query. The bike itself (and with it the ownership check that decides
 * 404) is `loadBikeForRequest`'s; this is the list, with the owner in its own
 * `where` too — one predicate per query, never "the previous one covered it".
 * `tests/unit/bike/load-bike.test.ts` holds the route's whole data load to the
 * §7.3 budget of three queries, and `tests/integration/query-budget.test.ts`
 * counts the same load against real Postgres.
 */
import type { BuildAction, BuildListItem } from "@/lib/checkup/types";
import { prisma } from "@/lib/db/prisma";
import { isPartId, type PartId } from "@/lib/domain/data/parts";
import { chosenProductOf } from "@/lib/shop/chosen-product";

/** The Prisma enum, as the checkup contract spells it (`KoAction`, §1.2). */
const ACTION_OF: Readonly<Record<string, BuildAction>> = {
  REPLACE: "replace",
  FIX: "fix",
  CLEAN: "clean",
  ADJUST: "adjust",
  INSPECT_SHOP: "inspect-shop",
};

const DONE_REASONS = ["manual", "recheck-ok"] as const;

interface BuildListRow {
  id: string;
  partId: string;
  action: string;
  reasonKey: string;
  guideSlug: string | null;
  refinement: unknown;
  chosenProduct: unknown;
  done: boolean;
  doneReason: string | null;
  sortOrder: number;
  checkupItem: { stepKey: string } | null;
}

/** A `Json` column is a shape we WROTE, not a shape we can assume on read. */
function asRefinement(value: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(
    ([key, entry]) => typeof entry === "string" && key.length <= 64 && entry.length <= 64,
  );
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as Record<string, string>);
}

function doneReasonOf(row: BuildListRow): BuildListItem["doneReason"] {
  if (!row.done) return undefined;
  return (DONE_REASONS as readonly (string | null)[]).includes(row.doneReason)
    ? (row.doneReason as (typeof DONE_REASONS)[number])
    : undefined;
}

/** One row, as the list page's item — or `null` for a row this release cannot show. */
export function toItem(row: BuildListRow): BuildListItem | null {
  const action = Object.hasOwn(ACTION_OF, row.action) ? ACTION_OF[row.action] : undefined;
  if (action === undefined || !isPartId(row.partId)) return null;
  const stepKey = row.checkupItem?.stepKey ?? row.id;
  const doneReason = doneReasonOf(row);
  const refinement = row.refinement === null ? undefined : asRefinement(row.refinement);
  const chosenProduct = row.chosenProduct === null ? undefined : chosenProductOf(row.chosenProduct);
  return {
    id: row.id,
    stepKey,
    sourceKeys: [stepKey],
    partId: row.partId as PartId,
    action,
    reasonKey: row.reasonKey,
    ...(row.guideSlug === null ? {} : { guideSlug: row.guideSlug }),
    done: row.done,
    ...(doneReason === undefined ? {} : { doneReason }),
    ...(refinement === undefined ? {} : { refinement }),
    ...(chosenProduct === undefined ? {} : { chosenProduct }),
    sortOrder: row.sortOrder,
  };
}

export interface LoadedBuildList {
  /** The `BuildList` row, for "Retirer ce qui est fait"; `null` when the bike has none. */
  buildListId: string | null;
  items: BuildListItem[];
}

/**
 * The bike's newest OPEN list, as the page renders it. Nothing (not an error)
 * when the bike has no list yet, or is not this user's.
 */
export async function loadBuildList(
  bikeId: string,
  userId: string,
  db: Pick<typeof prisma, "buildList"> = prisma,
): Promise<LoadedBuildList> {
  const list = await db.buildList.findFirst({
    where: { bikeId, bike: { userId }, status: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          partId: true,
          action: true,
          reasonKey: true,
          guideSlug: true,
          refinement: true,
          chosenProduct: true,
          done: true,
          doneReason: true,
          sortOrder: true,
          checkupItem: { select: { stepKey: true } },
        },
      },
    },
  });
  return {
    buildListId: list?.id ?? null,
    items: (list?.items ?? [])
      .map((row) => toItem(row as BuildListRow))
      .filter((item): item is BuildListItem => item !== null),
  };
}
