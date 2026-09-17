/**
 * THREAT — an authenticated visitor filling the database, by hand or by script.
 *
 * Every write in this project is bounded twice: by **how many** rows one
 * account may own (`QUOTAS`, §4.2 c) and by **how big** a single row may be (32
 * KB per JSON column). Neither is a database constraint, deliberately: a
 * `TOO_MANY` is a sentence the form can show, while a Postgres error is a 500
 * and a stack trace in the logs.
 *
 * CONTROLS PINNED
 *
 *   1. **The quota is counted in the same request that would exceed it** — the
 *      twentieth bike is created, the twenty-first is refused `TOO_MANY`, and
 *      the count is a scoped query (`where: { userId }`), so one account's
 *      bikes never consume another's allowance.
 *   2. **The refusal writes nothing.** A rejected create leaves the row count
 *      exactly where it was.
 *   3. **Size is bounded before the insert**, not by the column definition:
 *      `withinJsonBudget` is what the actions call, and it counts UTF-8 bytes
 *      rather than characters (an emoji is four, not one).
 *   4. **The limits are the plan's**, asserted as literals here so that
 *      loosening one is a visible change to this file and not a quiet edit of a
 *      constant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectScopedToUser, fakeDb } from "@/tests/_fakes/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

const { createBikeAction } = await import("@/app/[locale]/(protected)/mes-velos/actions");
const { updateBikeFitAction } = await import("@/app/[locale]/velo/[id]/reglages/actions");
const { deriveBike, jsonBytes, MAX_JSON_BYTES, QUOTAS, withinJsonBudget, withinQuota } =
  await import("@/lib/bike/rules");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");

interface SeededUser {
  id: string;
  email: string;
  name: string | null;
  locale: "fr" | "en";
}

let me: SeededUser;
let other: SeededUser;

async function seedUser(email: string): Promise<SeededUser> {
  return (await fakeDb.seed("User", {
    email,
    name: email.split("@")[0],
    locale: "fr",
  })) as unknown as SeededUser;
}

/** `count` bikes owned by `userId`, written straight into the fake. */
async function fillGarage(userId: string, count: number): Promise<void> {
  const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
  for (let index = 0; index < count; index++) {
    await fakeDb.seed("Bike", {
      userId,
      name: `Vélo ${index}`,
      answers: derived.answers,
      spec: derived.spec,
      parts: derived.parts,
    });
  }
}

beforeEach(async () => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
  me = await seedUser("camille@velo-atelier.test");
  other = await seedUser("autre@velo-atelier.test");
  setSession(sessionFor(me));
  fakeDb.resetCalls();
});

describe("the limits themselves", () => {
  it("are the ones §4.2 c names", () => {
    expect(QUOTAS).toEqual({
      bikesPerUser: 20,
      checkupsPerBike: 50,
      listsPerBike: 10,
      itemsPerList: 50,
    });
    expect(MAX_JSON_BYTES).toBe(32 * 1024);
  });

  it("let the last allowed item through and refuse the next", () => {
    expect(withinQuota(19, QUOTAS.bikesPerUser)).toBe(true);
    expect(withinQuota(20, QUOTAS.bikesPerUser)).toBe(false);
  });

  it("count bytes, not characters", () => {
    expect(jsonBytes({ a: "🚲" })).toBeGreaterThan(jsonBytes({ a: "b" }));
    expect(withinJsonBudget({ a: "x".repeat(MAX_JSON_BYTES) })).toBe(false);
  });
});

describe("bikes per account", () => {
  it("accepts the twentieth bike and refuses the twenty-first", async () => {
    await fillGarage(me.id, QUOTAS.bikesPerUser - 1);
    fakeDb.resetCalls();

    const twentieth = await createBikeAction({
      name: "Vélo 20",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    expect(twentieth.ok).toBe(true);

    const refused = await createBikeAction({
      name: "Vélo 21",
      answers: BIKE_PRESETS["gravel-1x11"],
    });
    expect(refused).toEqual({ ok: false, code: "TOO_MANY" });

    expect(fakeDb.rows("Bike")).toHaveLength(QUOTAS.bikesPerUser);
    expectScopedToUser(fakeDb.calls, me.id);
  });

  it("writes nothing at all when it refuses", async () => {
    await fillGarage(me.id, QUOTAS.bikesPerUser);
    fakeDb.resetCalls();

    expect(
      await createBikeAction({ name: "Un de trop", answers: BIKE_PRESETS["gravel-1x11"] }),
    ).toEqual({ ok: false, code: "TOO_MANY" });

    expect(fakeDb.calls.filter((call) => call.op === "create")).toHaveLength(0);
    expect(fakeDb.rows("BikePartState")).toHaveLength(0);
  });

  it("counts only the caller's bikes — a full garage next door changes nothing", async () => {
    await fillGarage(other.id, QUOTAS.bikesPerUser + 5);
    fakeDb.resetCalls();

    const result = await createBikeAction({
      name: "Mon premier vélo",
      answers: BIKE_PRESETS["gravel-1x11"],
    });

    expect(result.ok).toBe(true);
    expectScopedToUser(fakeDb.calls, me.id);
  });
});

describe("row size", () => {
  it("refuses a fit object that would not fit the column", async () => {
    const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    const bike = (await fakeDb.seed("Bike", {
      userId: me.id,
      name: "Gravel",
      answers: derived.answers,
      spec: derived.spec,
      parts: derived.parts,
    })) as { id: string };
    fakeDb.resetCalls();

    // A thousand unknown keys: refused as invalid long before the byte budget,
    // which is the point — the strict parse is the first wall, the budget the second.
    const oversized = Object.fromEntries(
      Array.from({ length: 1_000 }, (_, index) => [`k${index}`, index]),
    );
    expect(await updateBikeFitAction({ bikeId: bike.id, fit: oversized })).toMatchObject({
      ok: false,
      code: "VALIDATION",
    });
    expect(fakeDb.calls.filter((call) => call.op === "updateMany")).toHaveLength(0);
  });

  it("keeps every real bike far inside the budget", () => {
    for (const answers of Object.values(BIKE_PRESETS)) {
      const derived = deriveBike(answers);
      expect(jsonBytes(derived.parts)).toBeLessThan(MAX_JSON_BYTES);
      expect(jsonBytes(derived.spec)).toBeLessThan(MAX_JSON_BYTES);
      expect(jsonBytes(derived.answers)).toBeLessThan(MAX_JSON_BYTES);
    }
  });
});
