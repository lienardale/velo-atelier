import "server-only";

/**
 * Reading a saved bike's checkup — from the PAGE, not from an action.
 *
 * `loadCheckupAction` cannot do this job: `withUser` refuses a request with no
 * `Origin` header, which is every document GET (`lib/security/origin.ts`). A
 * server component is a GET, so it reads the row here and the action wraps the
 * same function for the client's own calls.
 *
 * Its own module rather than a fourth export of `actions.ts`: a `"use server"`
 * file turns every export into a callable server reference, and a function that
 * takes a `userId` as an argument must never become one.
 */
import type { StoredCheckup } from "@/lib/checkup/storage";
import { CONTENT_VERSION } from "@/lib/content/generated/version";
import { prisma } from "@/lib/db/prisma";
import type { CheckupAnswer } from "@/lib/checkup/types";
import type { CheckupResult } from "@/lib/generated/prisma/client";
import type { Locale } from "@/lib/i18n/routing";

const FROM_PRISMA: Record<CheckupResult, CheckupAnswer> = {
  OK: "ok",
  KO: "ko",
  SKIPPED: "skipped",
};

/**
 * The bike's most recent checkup, as the wizard's stored shape.
 *
 * In-progress first, then the newest — `status` sorts `IN_PROGRESS` before
 * `COMPLETED` in the enum's own order, which is exactly the priority a resume
 * wants. `null` when the bike has none, or is not this user's: the ownership
 * predicate is in the `where`, so a foreign id simply finds nothing (§4.7).
 *
 * The chosen SYMPTOMS come back from `CheckupItem.reasonKeys` (W4). They were
 * validated against the plan when they were written and are validated again by
 * `fromStored` when the wizard marries them to today's plan, so a reason the
 * corpus has since dropped simply falls away.
 *
 * One query, whatever the checkup's size: the items ride in the same `select`
 * (`tests/unit/bike/load-bike.test.ts` holds `/controle`'s whole data load to
 * the §7.3 budget of three). `db` is injectable for the integration-tier
 * counter; everything else uses the app's client.
 */
export async function loadStoredCheckup(
  bikeId: string,
  userId: string,
  locale: Locale,
  db: Pick<typeof prisma, "checkup"> = prisma,
): Promise<StoredCheckup | null> {
  const row = await db.checkup.findFirst({
    where: { bikeId, bike: { userId } },
    orderBy: [{ status: "asc" }, { startedAt: "desc" }],
    select: {
      id: true,
      scope: true,
      startedAt: true,
      completedAt: true,
      items: { select: { stepKey: true, result: true, notes: true, reasonKeys: true } },
    },
  });
  if (row === null) return null;

  const answers: Record<string, CheckupAnswer> = {};
  const notes: Record<string, string> = {};
  const symptoms: Record<string, string[]> = {};
  for (const item of row.items) {
    answers[item.stepKey] = FROM_PRISMA[item.result];

    if (item.notes !== null) notes[item.stepKey] = item.notes;
    if (item.result === "KO" && item.reasonKeys.length > 0) {
      symptoms[item.stepKey] = [...item.reasonKeys];
    }
  }

  return {
    version: 1,
    id: row.id,
    bikeRef: { kind: "db", id: bikeId },
    // A partial checkup's picked parts are not stored either: what IS stored is
    // the set of questions it asked, and re-planning from `?parts=` is what
    // brings them back.
    scope: row.scope === "FULL" ? { kind: "full" } : { kind: "parts", partIds: [] },
    locale,
    answers,
    symptoms,
    notes,
    toolsMissing: [],
    startedAt: row.startedAt.toISOString(),
    ...(row.completedAt === null ? {} : { completedAt: row.completedAt.toISOString() }),
    contentVersion: CONTENT_VERSION,
  };
}
