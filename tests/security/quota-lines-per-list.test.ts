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

function finish(symptoms: Record<string, string[]>) {
  return finishCheckupAction({
    bikeId,
    checkup: {
      version: 1,
      id: "11111111-1111-4111-8111-111111111111",
      bikeRef: { kind: "demo" },
      scope: { kind: "full" },
      locale: "fr",
      answers: { [PLANNED]: "ko" },
      symptoms,
      notes: {},
      toolsMissing: [],
      startedAt: "2026-09-21T08:00:00.000Z",
      contentVersion: CONTENT_VERSION,
    },
  });
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
});
