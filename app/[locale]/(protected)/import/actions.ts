"use server";

/**
 * `importGuestStateAction` — the one way a guest's `localStorage` becomes rows
 * (§4.4).
 *
 * The input is not a form: it is a JSON document this browser assembled from
 * three storage keys, which means it is exactly as trustworthy as a `curl`.
 * Four walls, in this order:
 *
 *   1. **`withUser`** — same origin, then a session, before a single Prisma
 *      call (`lib/actions/with-user.ts`).
 *   2. **Size.** `MAX_GUEST_PAYLOAD_BYTES` (256 KB) is measured on the decoded
 *      value before the schema is handed it — `parseGuestState` is not called
 *      for a payload over the budget, and a test spies on it to hold that
 *      order, which the answer alone cannot show. A value with no JSON size at
 *      all (a `BigInt`) is refused here too, not thrown on. `next.config.ts`
 *      allows 512 KB of action body; that head-room is for the framing, not
 *      for a bigger import.
 *   3. **Shape.** `GuestStateSchema` is a `strictObject` all the way down, so an
 *      `id`, a `userId` or a `spec` smuggled into a bike is `VALIDATION`, not a
 *      column (§4.7 mass assignment). The caps live in the schema too: blowing
 *      one is a refusal, never a hundred rows. So does everything PostgreSQL
 *      would refuse — a U+0000, a date it has no year for — because past this
 *      wall a refusal is a transaction that throws. A checkup is its ANSWERS,
 *      keyed by step key: which part and which guide each one is about is not
 *      in the payload at all — the bike's plan is recomputed (§5.4), and an
 *      answer to a question this bike is not asked is dropped, not stored.
 *   4. **Rate limit.** `guest-import:<userId>`, 3 an hour. An import is
 *      something a person does once per device; three is a generous allowance
 *      for a flaky connection and a low ceiling for a script.
 *
 * The limiter is consumed AFTER the payload has been found valid, so a client
 * bug that sends nonsense cannot spend the visitor's three real attempts, and
 * before any write, which is what the bucket is there to protect.
 *
 * The answer says, per bike, what became of each checkup — `imported`,
 * `already-imported`, or `skipped` with a reason — because the browser clears
 * `va:checkup:local` on that answer and on nothing else
 * (`settleGuestImport`, `lib/guest/schema.ts`). `already-imported` is said
 * only of a checkup whose answers the account holds, never of one that merely
 * shares an id with a row (`lib/guest/import.ts`).
 *
 * Only async functions are exported: a `"use server"` module that exports a
 * schema fails at request time with `found object` while `tsc` and `next build`
 * stay green (CLAUDE.md). The schemas live in `lib/guest/schema.ts`.
 */

import { revalidatePath } from "next/cache";

import { fail, ok, rateLimited, type ActionResult } from "@/lib/actions/result";
import { withUser } from "@/lib/actions/with-user";
import { rateLimitKey } from "@/lib/auth/tokens";
import { planForBuild } from "@/lib/content/checkup-plan";
import { prisma } from "@/lib/db/prisma";
import { importGuestState } from "@/lib/guest/import";
import {
  isEmptyGuestState,
  parseGuestState,
  withinGuestPayloadBudget,
  type GuestImportSummary,
} from "@/lib/guest/schema";
import { createPrismaRateLimiter, RATE_LIMITS } from "@/lib/security/rate-limit";

export const importGuestStateAction = withUser(
  async ({ user }, input: unknown): Promise<ActionResult<GuestImportSummary>> => {
    if (!withinGuestPayloadBudget(input)) return fail("TOO_MANY");

    const parsed = parseGuestState(input);
    // No field errors: there is no form to point at, and a zod/mini issue
    // message is not one of our message keys (§4.4 — `fieldErrors` values are
    // fully qualified keys). The page renders `errors.VALIDATION`.
    if (!parsed.ok) return fail("VALIDATION");

    // Nothing to import: answer before the bucket is touched, so a page that
    // asks twice on an empty browser costs nothing.
    if (isEmptyGuestState(parsed.state)) {
      return ok({ bikeId: null, bikes: [], imported: 0, skipped: 0 });
    }

    const limiter = createPrismaRateLimiter(prisma);
    const verdict = await limiter.consume(
      rateLimitKey("guest-import", user.id),
      RATE_LIMITS.guestImportPerUser,
    );
    if (!verdict.ok) return rateLimited(verdict.retryAfterMs);

    // `planForBuild` is the plan `controle/actions.ts` computes for a saved
    // bike: the import keeps the answers the bike's plan asks, and nothing else.
    const result = await importGuestState(prisma, user.id, parsed.state, { plan: planForBuild });
    if (!result.ok) return result;

    revalidatePath("/[locale]/(protected)/mes-velos", "page");
    revalidatePath("/[locale]/velo/[id]", "page");
    return result;
  },
);
