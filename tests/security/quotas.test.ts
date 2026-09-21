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
 *   5. **All three checkup quotas, literally** (§4.2 c, user ruling of
 *      2026-09-21): the 51st checkup of a bike, its 11th list and a 51st line
 *      are each `TOO_MANY`, named by a `checkup.finish.*` key the wizard shows,
 *      and refused before the first write — a refused finish leaves no checkup
 *      row, no item, no list and no part state behind.
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

// The checkup actions plan against the corpus; the frontmatter on disk is the
// same contract and needs no build step (see checkup-input.test.ts).
vi.mock("content-collections", async () => ({
  allGuides: (await import("@/tests/_helpers/guides")).diskGuides(),
  allLegalPages: [],
}));

const { saveCheckupAction, finishCheckupAction } =
  await import("@/app/[locale]/velo/[id]/controle/actions");
const { CONTENT_VERSION } = await import("@/lib/content/generated/version");
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

// ── checkups, lists and lines per bike (§4.2 c) ───────────────────────────────

/** A step of the demo (gravel) bike's plan, and its symptom. */
const PLANNED = "check-drivetrain#chain-wear";

async function seedBike(userId: string): Promise<{ id: string }> {
  const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
  return (await fakeDb.seed("Bike", {
    userId,
    name: "Gravel",
    answers: derived.answers,
    spec: derived.spec,
    parts: derived.parts,
  })) as { id: string };
}

/** `count` checkups of `bikeId`, each with its own list when `withLists`. */
async function fillHistory(bikeId: string, count: number, withLists: boolean): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const checkup = (await fakeDb.seed("Checkup", {
      bikeId,
      scope: "FULL",
      status: "COMPLETED",
      startedAt: new Date(Date.UTC(2025, 0, 1 + index)),
    })) as { id: string; startedAt: Date };
    if (withLists) await fakeDb.seed("BuildList", { bikeId, checkupId: checkup.id, name: "" });
    ids.push(checkup.startedAt.toISOString());
  }
  return ids;
}

function checkup(startedAt: string): Record<string, unknown> {
  return {
    version: 1,
    id: "11111111-1111-4111-8111-111111111111",
    bikeRef: { kind: "demo" },
    scope: { kind: "full" },
    locale: "fr",
    answers: { [PLANNED]: "ko" },
    symptoms: { [PLANNED]: ["chain-elongation"] },
    notes: {},
    toolsMissing: [],
    startedAt,
    contentVersion: CONTENT_VERSION,
  };
}

const LATER = "2026-09-21T08:00:00.000Z";

describe("checkups per bike", () => {
  it("accepts the fiftieth checkup and refuses the fifty-first, naming the limit", async () => {
    const bike = await seedBike(me.id);
    await fillHistory(bike.id, QUOTAS.checkupsPerBike - 1, false);
    fakeDb.resetCalls();

    expect(await saveCheckupAction({ bikeId: bike.id, checkup: checkup(LATER) })).toEqual({
      ok: true,
      data: null,
    });
    expect(fakeDb.rows("Checkup")).toHaveLength(QUOTAS.checkupsPerBike);

    const refused = await saveCheckupAction({
      bikeId: bike.id,
      checkup: checkup("2026-09-22T08:00:00.000Z"),
    });
    expect(refused).toEqual({
      ok: false,
      code: "TOO_MANY",
      fieldErrors: { form: "checkup.finish.tooManyCheckups" },
    });
    expect(fakeDb.rows("Checkup")).toHaveLength(QUOTAS.checkupsPerBike);
    expectScopedToUser(fakeDb.calls, me.id);
  });

  it("still saves into a checkup that already exists — the quota is on creating one", async () => {
    const bike = await seedBike(me.id);
    const [first] = await fillHistory(bike.id, QUOTAS.checkupsPerBike, false);
    fakeDb.resetCalls();

    const result = await saveCheckupAction({ bikeId: bike.id, checkup: checkup(first) });
    expect(result).toEqual({ ok: true, data: null });
    expect(fakeDb.rows("Checkup")).toHaveLength(QUOTAS.checkupsPerBike);
    expect(fakeDb.rows("CheckupItem")).toHaveLength(1);
  });

  it("refuses a finish that would open a fifty-first checkup, and writes nothing", async () => {
    const bike = await seedBike(me.id);
    await fillHistory(bike.id, QUOTAS.checkupsPerBike, false);
    fakeDb.resetCalls();

    expect(await finishCheckupAction({ bikeId: bike.id, checkup: checkup(LATER) })).toEqual({
      ok: false,
      code: "TOO_MANY",
      fieldErrors: { form: "checkup.finish.tooManyCheckups" },
    });
    expect(fakeDb.rows("CheckupItem")).toHaveLength(0);
    expect(fakeDb.rows("BuildList")).toHaveLength(0);
    expect(fakeDb.calls.filter((call) => call.op !== "findFirst" && call.op !== "count")).toEqual(
      [],
    );
  });

  it("counts only this bike's checkups", async () => {
    const full = await seedBike(me.id);
    const empty = await seedBike(me.id);
    await fillHistory(full.id, QUOTAS.checkupsPerBike, false);
    fakeDb.resetCalls();

    expect(await saveCheckupAction({ bikeId: empty.id, checkup: checkup(LATER) })).toEqual({
      ok: true,
      data: null,
    });
  });
});

describe("lists per bike", () => {
  it("refuses finishing an 11th checkup on a bike that already has 10 lists", async () => {
    // The user's own example of the rule (2026-09-21).
    const bike = await seedBike(me.id);
    await fillHistory(bike.id, QUOTAS.listsPerBike, true);
    fakeDb.resetCalls();

    const refused = await finishCheckupAction({ bikeId: bike.id, checkup: checkup(LATER) });

    expect(refused).toEqual({
      ok: false,
      code: "TOO_MANY",
      fieldErrors: { form: "checkup.finish.tooManyLists" },
    });
    // Refused before the first write: no new checkup, no item, no list, no tint.
    expect(fakeDb.rows("Checkup")).toHaveLength(QUOTAS.listsPerBike);
    expect(fakeDb.rows("CheckupItem")).toHaveLength(0);
    expect(fakeDb.rows("BuildList")).toHaveLength(QUOTAS.listsPerBike);
    expect(fakeDb.calls.filter((call) => call.op !== "findFirst" && call.op !== "count")).toEqual(
      [],
    );
    expectScopedToUser(fakeDb.calls, me.id);
  });

  it("finishes the tenth list, and re-finishes a checkup that already has one", async () => {
    const bike = await seedBike(me.id);
    const started = await fillHistory(bike.id, QUOTAS.listsPerBike - 1, true);
    fakeDb.resetCalls();

    const tenth = await finishCheckupAction({ bikeId: bike.id, checkup: checkup(LATER) });
    expect(tenth.ok).toBe(true);
    expect(fakeDb.rows("BuildList")).toHaveLength(QUOTAS.listsPerBike);

    // Editing a verdict on the summary and pressing "Créer ma liste" again is
    // an update of that checkup's own list, not an 11th one.
    const again = await finishCheckupAction({ bikeId: bike.id, checkup: checkup(started[0]) });
    expect(again.ok).toBe(true);
    expect(fakeDb.rows("BuildList")).toHaveLength(QUOTAS.listsPerBike);
  });
});

describe("lines per list", () => {
  it("leaves every preset's worst checkup — every answer KO, no symptom — inside one list", async () => {
    // What makes the literal rule livable: no real bike can be refused a full
    // checkup today. A corpus that grows past it fails HERE, not in front of a
    // visitor who answered forty questions.
    const { planCheckup } = await import("@/lib/checkup/plan");
    const { deriveBuildList } = await import("@/lib/checkup/build-list");
    const { diskGuides } = await import("@/tests/_helpers/guides");
    const { makeState } = await import("@/tests/_helpers/checkup");
    const guides = diskGuides().filter((guide) => guide.locale === "fr");

    for (const [preset, answers] of Object.entries(BIKE_PRESETS)) {
      const derived = deriveBike(answers);
      const steps = planCheckup(
        { spec: derived.spec, parts: derived.parts },
        { kind: "full" },
        guides,
      );
      const everyKo = Object.fromEntries(steps.map((step) => [step.key, "ko" as const]));
      const lines = deriveBuildList(makeState(steps, { answers: everyKo }));
      expect(lines.length, preset).toBeLessThanOrEqual(QUOTAS.itemsPerList);
    }
  });
});
