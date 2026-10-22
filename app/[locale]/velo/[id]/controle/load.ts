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

/** One `CheckupItem` row, as much of it as an answer needs. */
export interface StoredItemRow {
  stepKey: string;
  /**
   * The part the answer is recorded against: the first part its step reports
   * on, in the scope the run was saved under (`answeredItems`). Not an answer
   * itself — what tells a page whose parts do not hold the answer
   * (`resumeTarget`, `lib/checkup/scope.ts`).
   */
  partId: string;
  result: CheckupResult;
  notes: string | null;
  reasonKeys: string[];
}

/**
 * A run's rows as the wizard's three records: the verdicts, the notes, and the
 * symptoms of a KO. The ONE reading of a row — the page's resume reads it, and
 * so does `controle/actions.ts`, which keeps every stored answer a payload
 * does not carry (`.debug/017` §5.10).
 */
export function answersOfRows(
  items: readonly StoredItemRow[],
): Pick<StoredCheckup, "answers" | "symptoms" | "notes"> {
  const answers: Record<string, CheckupAnswer> = {};
  const notes: Record<string, string> = {};
  const symptoms: Record<string, string[]> = {};
  for (const item of items) {
    answers[item.stepKey] = FROM_PRISMA[item.result];
    if (item.notes !== null) notes[item.stepKey] = item.notes;
    if (item.result === "KO" && item.reasonKeys.length > 0) {
      symptoms[item.stepKey] = [...item.reasonKeys];
    }
  }
  return { answers, symptoms, notes };
}

/** A saved bike's run: the wizard's stored shape, and the part each answer is recorded against. */
export interface StoredRun {
  checkup: StoredCheckup;
  /** `stepKey` → `CheckupItem.partId`. */
  recordedFor: Record<string, string>;
}

/**
 * The bike's most recent checkup, as the wizard's stored shape — with the
 * part each row is recorded against, which the checkup PAGE reads to tell
 * whether the parts it was asked for hold the run (`page.tsx`).
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
export async function loadStoredCheckupRun(
  bikeId: string,
  userId: string,
  locale: Locale,
  db: Pick<typeof prisma, "checkup"> = prisma,
): Promise<StoredRun | null> {
  const row = await db.checkup.findFirst({
    where: { bikeId, bike: { userId } },
    orderBy: [{ status: "asc" }, { startedAt: "desc" }],
    select: {
      id: true,
      scope: true,
      startedAt: true,
      completedAt: true,
      items: {
        select: { stepKey: true, partId: true, result: true, notes: true, reasonKeys: true },
      },
    },
  });
  if (row === null) return null;

  return {
    checkup: {
      version: 1,
      id: row.id,
      bikeRef: { kind: "db", id: bikeId },
      // A partial checkup's picked parts are not stored (`Checkup.scope` is
      // `FULL | PARTIAL`), so a PARTIAL row reads as a scope naming NO part: it
      // says "partial", and nothing about which parts. It is never posted back
      // and never planned — a scope naming no part plans no question, and the
      // wizard that once posted this one deleted every answer of the run
      // (`.debug/017` §5.10). The run is resumed on the PAGE's scope when that
      // scope holds it, and on the full checkup otherwise (`resumeTarget`,
      // `lib/checkup/scope.ts`); the actions refuse a scope naming no part.
      scope: row.scope === "FULL" ? { kind: "full" } : { kind: "parts", partIds: [] },
      locale,
      ...answersOfRows(row.items),
      toolsMissing: [],
      startedAt: row.startedAt.toISOString(),
      ...(row.completedAt === null ? {} : { completedAt: row.completedAt.toISOString() }),
      contentVersion: CONTENT_VERSION,
    },
    recordedFor: Object.fromEntries(row.items.map((item) => [item.stepKey, item.partId])),
  };
}

/**
 * The bike's most recent checkup, as the wizard's stored shape — what
 * `loadCheckupAction` answers. {@link loadStoredCheckupRun}, without the
 * parts the rows are recorded against.
 */
export async function loadStoredCheckup(
  bikeId: string,
  userId: string,
  locale: Locale,
  db: Pick<typeof prisma, "checkup"> = prisma,
): Promise<StoredCheckup | null> {
  return (await loadStoredCheckupRun(bikeId, userId, locale, db))?.checkup ?? null;
}
