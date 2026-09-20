/**
 * THREAT — A visitor decides what their checkup asked.
 *
 * The checkup payload is the one that ends with "buy a cassette". Everything in
 * it arrives from a browser: the step keys, the symptoms, the notes, the bike
 * id. A client that invents a step can invent a question the guides never
 * asked; one that invents a reason can put a line on somebody's shopping list
 * with no guide behind it; one that names another person's bike can read or
 * rewrite their checkup.
 *
 * CONTROLS PINNED
 *
 *   1. **The vocabulary is the corpus's, not the client's.** The schemas are
 *      `z.enum(GUIDE_STEP_KEYS)` and `z.enum(REASON_KEYS)` — the GENERATED
 *      enums, written from `content/guides/**` — so an invented step key, an
 *      invented reason key or an invented guide slug is a rejected payload,
 *      not a stored row.
 *   2. **The plan is recomputed, never trusted** (§4.4). A key that exists in
 *      the corpus but is not in THIS bike's plan — a disc-brake question on a
 *      rim-brake bike — is dropped silently on the way in: it writes no row.
 *   3. **A symptom must be one the step offers.** Otherwise a KO could name a
 *      reason from a different question and produce a line nothing explains.
 *   4. **`.strict()`, everywhere.** `userId`, `status`, `bikeId` inside the
 *      checkup, `__proto__`: unknown keys are refused, not ignored.
 *   5. **Ownership is in the `where`.** A foreign bike id answers `NOT_FOUND` —
 *      404, never 403 — and touches nothing (§4.7).
 *   6. **No session, no work.** `withUser` answers `UNAUTHORIZED` before a
 *      single Prisma call, and a cross-origin POST `FORBIDDEN` before that.
 */
/* eslint-disable security/detect-object-injection -- step keys the test spells out, into its own fixtures */
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectScopedToUser, fakeDb } from "@/tests/_fakes/prisma";
import {
  sameOriginHeaders,
  sessionFor,
  setRequestHeaders,
  setSession,
} from "@/tests/_fakes/session";

vi.mock("@/auth", async () => (await import("@/tests/_fakes/session")).authModule());

// The compiled corpus only exists after `content-collections build`; the
// frontmatter on disk is the same contract and needs no build step.
vi.mock("content-collections", async () => ({
  allGuides: (await import("@/tests/_helpers/guides")).diskGuides(),
}));

const { saveCheckupAction, finishCheckupAction, loadCheckupAction, listCheckupsAction } =
  await import("@/app/[locale]/velo/[id]/controle/actions");
const { loadStoredCheckup } = await import("@/app/[locale]/velo/[id]/controle/load");
const { deriveBike } = await import("@/lib/bike/rules");
const { BIKE_PRESETS } = await import("@/lib/domain/data/presets");
const { CONTENT_VERSION } = await import("@/lib/content/generated/version");

/** A step of the demo (gravel, hydraulic disc) bike's plan. */
const PLANNED = "check-drivetrain#chain-wear";
/** A real step of a real guide — for a bike with RIM brakes. */
const REAL_BUT_NOT_PLANNED = "check-brakes-rim#pad-wear";

interface SeededUser {
  id: string;
  email: string;
  name: string | null;
  locale: "fr" | "en";
}

async function seedUser(email: string): Promise<SeededUser> {
  return (await fakeDb.seed("User", {
    email,
    name: email.split("@")[0],
    locale: "fr",
  })) as unknown as SeededUser;
}

async function seedBike(userId: string): Promise<{ id: string }> {
  const derived = deriveBike(BIKE_PRESETS["gravel-1x11"]);
  const bike = (await fakeDb.seed("Bike", {
    userId,
    name: "Gravel",
    answers: derived.answers,
    spec: derived.spec,
    parts: derived.parts,
    fit: {},
  })) as { id: string };
  for (const part of derived.parts) {
    await fakeDb.seed("BikePartState", { bikeId: bike.id, partId: part.partId });
  }
  return bike;
}

/** A well-formed payload; each test breaks exactly one thing. */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: "11111111-1111-4111-8111-111111111111",
    bikeRef: { kind: "demo" },
    scope: { kind: "full" },
    locale: "fr",
    answers: { [PLANNED]: "ko" },
    symptoms: { [PLANNED]: ["chain-elongation"] },
    notes: { [PLANNED]: "elle saute" },
    toolsMissing: ["chain-checker"],
    startedAt: "2026-09-19T08:00:00.000Z",
    contentVersion: CONTENT_VERSION,
    ...overrides,
  };
}

let me: SeededUser;
let victim: SeededUser;
let myBike: { id: string };
let victimBike: { id: string };

beforeEach(async () => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
  me = await seedUser("camille@velo-atelier.test");
  victim = await seedUser("victime@velo-atelier.test");
  myBike = await seedBike(me.id);
  victimBike = await seedBike(victim.id);
  setSession(sessionFor(me));
  fakeDb.resetCalls();
});

describe("the vocabulary is the corpus's", () => {
  it("refuses a step key no guide declares", async () => {
    const result = await saveCheckupAction({
      bikeId: myBike.id,
      checkup: payload({ answers: { "check-invented#by-me": "ko" } }),
    });
    expect(result).toEqual({ ok: false, code: "VALIDATION" });
    expect(fakeDb.rows("Checkup")).toHaveLength(0);
  });

  it("refuses a guide slug that does not exist, even with a real step id", async () => {
    const result = await saveCheckupAction({
      bikeId: myBike.id,
      checkup: payload({ answers: { "check-brakes-hydraulic#pad-wear": "ok" } }),
    });
    expect(result).toEqual({ ok: false, code: "VALIDATION" });
  });

  it("refuses a reason key no guide declares", async () => {
    const result = await saveCheckupAction({
      bikeId: myBike.id,
      checkup: payload({ symptoms: { [PLANNED]: ["the-frame-is-haunted"] } }),
    });
    expect(result).toEqual({ ok: false, code: "VALIDATION" });
  });

  it("refuses a verdict that is not one", async () => {
    const result = await saveCheckupAction({
      bikeId: myBike.id,
      checkup: payload({ answers: { [PLANNED]: "PERFECT" } }),
    });
    expect(result).toEqual({ ok: false, code: "VALIDATION" });
  });

  it("refuses a note longer than the column", async () => {
    const result = await saveCheckupAction({
      bikeId: myBike.id,
      checkup: payload({ notes: { [PLANNED]: "x".repeat(2001) } }),
    });
    expect(result).toEqual({ ok: false, code: "VALIDATION" });
  });

  it("refuses a tool the catalogue does not have", async () => {
    const result = await saveCheckupAction({
      bikeId: myBike.id,
      checkup: payload({ toolsMissing: ["sonic-screwdriver"] }),
    });
    expect(result).toEqual({ ok: false, code: "VALIDATION" });
  });
});

describe("the plan is recomputed, never trusted", () => {
  it("stores the answer to a question this bike is actually asked", async () => {
    expect(await saveCheckupAction({ bikeId: myBike.id, checkup: payload() })).toEqual({
      ok: true,
      data: null,
    });
    const items = fakeDb.rows("CheckupItem");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ stepKey: PLANNED, result: "KO", partId: "chain" });
  });

  it("drops a real question this bike is never asked", async () => {
    // `check-brakes-rim` only applies to a bike with rim brakes; the demo bike
    // has hydraulic discs. The key parses — and then it is not in the plan.
    const result = await saveCheckupAction({
      bikeId: myBike.id,
      checkup: payload({
        answers: { [PLANNED]: "ok", [REAL_BUT_NOT_PLANNED]: "ko" },
        symptoms: {},
        notes: {},
      }),
    });
    expect(result.ok).toBe(true);
    expect(fakeDb.rows("CheckupItem").map((row) => row.stepKey)).toEqual([PLANNED]);
  });

  it("drops a symptom the step does not offer, and lists only that step's own", async () => {
    // `pad-worn` is a real reason — of a brake question, not of the chain one.
    // It is dropped, which leaves the KO with no symptom at all, and a KO with
    // no symptom falls back to the step's WHOLE `ko[]` (§5.4): too much rather
    // than a line nothing explains.
    const result = await finishCheckupAction({
      bikeId: myBike.id,
      checkup: payload({ symptoms: { [PLANNED]: ["pad-worn"] } }),
    });
    expect(result.ok).toBe(true);

    const items = fakeDb.rows("BuildListItem");
    expect(items.map((row) => row.reasonKey).sort()).toEqual(["chain-dirty", "chain-elongation"]);
    expect(items.every((row) => row.partId === "chain")).toBe(true);
  });

  it("derives the list from the verdicts, server-side", async () => {
    const result = await finishCheckupAction({ bikeId: myBike.id, checkup: payload() });
    expect(result.ok).toBe(true);

    const items = fakeDb.rows("BuildListItem");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      partId: "chain",
      action: "REPLACE",
      reasonKey: "chain-elongation",
      guideSlug: "replace-chain",
      done: false,
    });
    expect(fakeDb.rows("Checkup")[0]).toMatchObject({ status: "COMPLETED" });
  });
});

describe("mass assignment", () => {
  it("refuses an unknown key on the envelope", async () => {
    for (const extra of [{ userId: "x" }, { bikeId: victimBike.id }, { status: "COMPLETED" }]) {
      expect(await saveCheckupAction({ bikeId: myBike.id, checkup: payload(extra) })).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
  });

  it("refuses an unknown key at the top level", async () => {
    expect(
      await saveCheckupAction({
        bikeId: myBike.id,
        checkup: payload(),
        userId: victim.id,
      }),
    ).toEqual({ ok: false, code: "VALIDATION" });
  });

  it("stores nothing for a prototype key among the answers, and pollutes nothing", async () => {
    // `JSON.parse` makes `__proto__` an OWN property, which is exactly what
    // reaches an action. It is not a step key, so it is not in the plan, so it
    // writes no row — and `Object.prototype` gains nothing on the way through.
    const answers = JSON.parse('{"__proto__":{"isAdmin":true}}') as Record<string, string>;
    const result = await saveCheckupAction({ bikeId: myBike.id, checkup: payload({ answers }) });
    expect(result.ok).toBe(true);
    expect(fakeDb.rows("CheckupItem")).toHaveLength(0);
    expect((Object.prototype as unknown as { isAdmin?: boolean }).isAdmin).toBeUndefined();
    expect(({} as unknown as { isAdmin?: boolean }).isAdmin).toBeUndefined();
  });
});

describe("ownership", () => {
  it("answers NOT_FOUND for another person's bike, and writes nothing", async () => {
    const result = await saveCheckupAction({ bikeId: victimBike.id, checkup: payload() });
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(fakeDb.rows("Checkup")).toHaveLength(0);
    expectScopedToUser(fakeDb.calls, me.id);
  });

  it("answers the same for a bike that exists nowhere", async () => {
    const missing = await saveCheckupAction({
      bikeId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      checkup: payload(),
    });
    expect(missing).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("reads and lists only the caller's checkups", async () => {
    await saveCheckupAction({ bikeId: myBike.id, checkup: payload() });
    fakeDb.resetCalls();

    expect(await loadCheckupAction({ bikeId: victimBike.id })).toEqual({ ok: true, data: null });
    expect(await listCheckupsAction({ bikeId: victimBike.id })).toEqual({ ok: true, data: [] });
    expectScopedToUser(fakeDb.calls, me.id);

    const mine = await loadCheckupAction({ bikeId: myBike.id });
    expect(mine.ok && mine.data?.answers[PLANNED]).toBe("ko");
  });

  it("scopes every write to the caller", async () => {
    await finishCheckupAction({ bikeId: myBike.id, checkup: payload() });
    expectScopedToUser(fakeDb.calls, me.id);
    expect(fakeDb.rows("Checkup").every((row) => row.bikeId === myBike.id)).toBe(true);
  });
});

describe("no session, no work", () => {
  it("answers UNAUTHORIZED before any query", async () => {
    setSession(null);
    fakeDb.resetCalls();
    expect(await saveCheckupAction({ bikeId: myBike.id, checkup: payload() })).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it("answers FORBIDDEN to a cross-origin POST, before even looking at the session", async () => {
    setRequestHeaders({ origin: "https://evil.example", host: "localhost:3000" });
    fakeDb.resetCalls();
    expect(await finishCheckupAction({ bikeId: myBike.id, checkup: payload() })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

/**
 * The same lock, seen from the other side.
 *
 * `withUser` refuses a request with no `Origin` — which is EVERY document GET —
 * so a server component may not read a checkup through `loadCheckupAction`. It
 * would not fail loudly: the action answers `FORBIDDEN`, the page reads `null`,
 * and the wizard silently starts a signed-in visitor's reload from nothing,
 * minting a fresh `startedAt` and a second `Checkup` row with it. Hence
 * `load.ts`, whose ownership predicate is its own (`bike: { userId }`) because
 * it takes the user id as an argument and therefore must never be an export of
 * a `"use server"` module.
 */
describe("the page reads the row itself, not through the action", () => {
  it("refuses the action on a document GET and answers the plain reader instead", async () => {
    await saveCheckupAction({ bikeId: myBike.id, checkup: payload() });

    // A top-level navigation: a host, and no `Origin` at all.
    setRequestHeaders({ host: "localhost:3000" });
    expect(await loadCheckupAction({ bikeId: myBike.id })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });

    const stored = await loadStoredCheckup(myBike.id, me.id, "fr");
    expect(stored?.answers[PLANNED]).toBe("ko");
    // …and it is still the owner's row only.
    expect(await loadStoredCheckup(victimBike.id, me.id, "fr")).toBeNull();
  });

  it("is what the checkup page calls", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is derived from `import.meta.url`, never from input
    const source = readFileSync(
      new URL("../../app/[locale]/velo/[id]/controle/page.tsx", import.meta.url),
      "utf8",
    );
    // Comments out: this file's own explanation names the action it must not
    // call, and a test that reads prose is a test that fails on a rewording.
    const code = source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(code).toMatch(/loadStoredCheckup/);
    expect(code).not.toMatch(/loadCheckupAction/);
    expect(code).not.toMatch(/["']\.\/actions["']/);
  });
});
