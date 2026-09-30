/**
 * THREAT — a checkup whose list would not fit one list (§4.2 c: 50 lines).
 *
 * No preset can reach the real limit today (the worst, every answer KO with no
 * symptom, is 48 lines on the e-MTB — `quotas.test.ts` pins that headroom), so
 * the MECHANISM is proven here against a limit of one line: the quota is read
 * from `QUOTAS` like the other two, counted from the derived list before the
 * first write, and a refusal names `checkup.finish.tooManyLines` for the
 * wizard. The literal 50 is asserted in `quotas.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb } from "@/tests/_fakes/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());
vi.mock("content-collections", async () => ({
  allGuides: (await import("@/tests/_helpers/guides")).diskGuides(),
  allLegalPages: [],
}));
vi.mock("@/lib/bike/rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bike/rules")>();
  return { ...actual, QUOTAS: { ...actual.QUOTAS, itemsPerList: 1 } };
});

const { finishCheckupAction } = await import("@/app/[locale]/velo/[id]/controle/actions");
const { deriveBike } = await import("@/lib/bike/rules");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");
const { CONTENT_VERSION } = await import("@/lib/content/generated/version");

const PLANNED = "check-drivetrain#chain-wear";
const CASSETTE = "check-drivetrain#cassette-teeth";

let bikeId: string;

beforeEach(async () => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
  const me = (await fakeDb.seed("User", {
    email: "camille@velo-atelier.test",
    name: "Camille",
    locale: "fr",
  })) as { id: string; email: string; name: string; locale: "fr" };
  const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
  bikeId = (
    (await fakeDb.seed("Bike", {
      userId: me.id,
      name: "Gravel",
      answers: derived.answers,
      spec: derived.spec,
      parts: derived.parts,
    })) as { id: string }
  ).id;
  setSession(sessionFor(me));
  fakeDb.resetCalls();
});

function finishRun(
  answers: Record<string, "ok" | "ko" | "skipped">,
  symptoms: Record<string, string[]>,
  startedAt = "2026-09-21T08:00:00.000Z",
) {
  return finishCheckupAction({
    bikeId,
    checkup: {
      version: 1,
      id: "11111111-1111-4111-8111-111111111111",
      bikeRef: { kind: "demo" },
      scope: { kind: "full" },
      locale: "fr",
      answers,
      symptoms,
      notes: {},
      toolsMissing: [],
      startedAt,
      contentVersion: CONTENT_VERSION,
    },
  });
}

function finish(symptoms: Record<string, string[]>) {
  return finishRun({ [PLANNED]: "ko" }, symptoms);
}

describe("lines per list", () => {
  it("refuses a list longer than the limit before anything is written", async () => {
    // A KO with no symptom lands the step's whole `ko[]`: replace AND clean the chain.
    expect(await finish({})).toEqual({
      ok: false,
      code: "TOO_MANY",
      fieldErrors: { form: "checkup.finish.tooManyLines" },
    });
    expect(fakeDb.rows("Checkup")).toHaveLength(0);
    expect(fakeDb.rows("CheckupItem")).toHaveLength(0);
    expect(fakeDb.rows("BuildList")).toHaveLength(0);
    expect(fakeDb.calls.filter((call) => call.op !== "findFirst" && call.op !== "count")).toEqual(
      [],
    );
  });

  it("accepts a list at the limit", async () => {
    const result = await finish({ [PLANNED]: ["chain-elongation"] });
    expect(result.ok).toBe(true);
    expect(fakeDb.rows("BuildListItem")).toHaveLength(1);
  });

  // ── the union, since the list is shared (W5) ───────────────────────────────
  //
  // A finish merges into the bike's OPEN list, so the limit is a property of
  // THAT list and not of the checkup: a second run counts what is already
  // there. Without this the 50 could be walked past one checkup at a time.

  it("counts the lines already on the open list, and refuses the pair that overflows it", async () => {
    expect((await finish({ [PLANNED]: ["chain-elongation"] })).ok).toBe(true);
    const listId = fakeDb.rows("BuildList")[0].id;
    fakeDb.resetCalls();

    // A LATER run (its own `startedAt`), finding a different part: one line
    // on the list plus one derived is two, and the limit here is one.
    const refused = await finishRun(
      { [CASSETTE]: "ko" },
      { [CASSETTE]: ["cassette-worn"] },
      "2026-09-28T08:00:00.000Z",
    );
    expect(refused).toEqual({
      ok: false,
      code: "TOO_MANY",
      fieldErrors: { form: "checkup.finish.tooManyLines" },
    });
    // Refused before the first write: the second run left no row behind and
    // the list is exactly as the first one left it.
    expect(fakeDb.rows("Checkup")).toHaveLength(1);
    expect(fakeDb.rows("BuildList")).toHaveLength(1);
    expect(fakeDb.rows("BuildListItem")).toHaveLength(1);
    expect(fakeDb.calls.filter((call) => call.op !== "findFirst" && call.op !== "count")).toEqual(
      [],
    );
    expect(fakeDb.rows("BuildListItem")[0].buildListId).toBe(listId);
  });

  it("lets a later run through when it finds the line the list already holds", async () => {
    expect((await finish({ [PLANNED]: ["chain-elongation"] })).ok).toBe(true);

    // The same pair: the union is one, so the list still fits its limit.
    const again = await finishRun(
      { [PLANNED]: "ko" },
      { [PLANNED]: ["chain-elongation"] },
      "2026-09-28T08:00:00.000Z",
    );
    expect(again.ok).toBe(true);
    expect(fakeDb.rows("BuildList")).toHaveLength(1);
    expect(fakeDb.rows("BuildListItem")).toHaveLength(1);
  });
});
