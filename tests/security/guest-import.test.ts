/**
 * THREAT — `importGuestStateAction` takes a JSON document that a browser
 * assembled from `localStorage`, which is to say: a document the caller wrote.
 * It is the only action in the project whose input is a whole object graph
 * rather than a handful of form fields, and it creates rows in six tables. A
 * `curl` with a valid session cookie is its real input shape.
 *
 * CONTROLS PINNED
 *
 *   1. **Origin, then session, then anything else** (`withUser`). A forged
 *      cross-origin POST is `FORBIDDEN` whatever cookie it carried; an
 *      anonymous one is `UNAUTHORIZED` with an empty Prisma call log. Then
 *      size, then shape, then the rate limit — in that order.
 *   2. **No mass assignment.** `GuestStateSchema` is a `strictObject` at every
 *      level: `id`, `userId`, `spec`, `createdAt`, `guestLocalId`,
 *      `passwordHash` smuggled into a bike are `VALIDATION`, and nothing is
 *      written — and so are a `status`, a `steps` array, an `items` array or a
 *      `checkupItemId` smuggled into a checkup or a list line. The columns that
 *      matter are not taken from the payload at all: `userId` comes from the
 *      session, `spec` and `parts` from `deriveBike`, and what a checkup's
 *      answer is ABOUT — its part, its guide, the symptoms it may carry, the
 *      line it links to — from the plan the server recomputes (§5.4).
 *   3. **No reach into another account.** Every read and write carries
 *      `userId`; a payload naming a guest id another user already imported
 *      creates this caller's own row and leaves the other one untouched
 *      (`expectScopedToUser`).
 *   4. **The caps hold** (§4.4): 10 bikes, 80 parts, 20 checkups, 10 lists,
 *      250 entries in each of a checkup's three records, 12 symptoms per step,
 *      80 parts in a scope, 2000 characters in a note, 50 lines per list
 *      (`QUOTAS.itemsPerList`), 24 answers in a line's `refinement` — each
 *      of at most the 64 characters the list page reads an answer by — and
 *      256 KB — each refused with nothing written. The 256 KB are measured
 *      BEFORE the payload is parsed (the parser is spied on, not inferred from
 *      the answer), and a value that has no JSON size at all — a `BigInt` — is
 *      refused there too rather than thrown on.
 *   5. **Idempotent.** The same guest bike twice is one row and one checkup;
 *      the second answer is `skipped: 'already-imported'` and not a single
 *      write (§6.8 AC8). The CHECKUP is called `already-imported` only when
 *      the account's row holds what the second copy says.
 *   6. **Rate limited.** `guest-import:<userId>`, three an hour, counted per
 *      user, with `retryAfterSec` on the refusal.
 *   7. **No hostile string reaches a lookup, a column or a link.** Step keys,
 *      part ids, reason keys and slugs are `[a-z0-9-]` and no longer than their
 *      column before anything resolves them — an over-long id is a
 *      `VALIDATION`, never a 500 — and a chosen product's URL is plain `https:`
 *      or it is not stored. A U+0000 anywhere, half a surrogate pair anywhere,
 *      and a date that is not ISO 8601 or that PostgreSQL has no year for, are
 *      `VALIDATION`s as well: the fake would store them, the real database
 *      throws on them — or, for half a pair bound for a `text` column, is sent
 *      another character in its place by the driver and stores that one
 *      (`tests/integration/guest-import.test.ts` shows each).
 *   8. **The visitor's clock cannot write the future** (§4.7).
 *
 * The fixtures are real: `tests/_helpers/guest-work.ts` stores what the wizard
 * stores (`toStored`, under the real key) and collects it back. Each hostile
 * payload is that one with exactly one thing broken.
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

// The action plans a checkup with `planForBuild`, which reads the compiled
// corpus. That only exists after `content-collections build`; the frontmatter
// on disk is the same contract and needs no build step (the choice
// `checkup-input.test.ts` makes, for the same reason). `lib/content/collection.ts`
// reads BOTH collections at module scope, so the mock names both.
vi.mock("content-collections", async () => ({
  allGuides: (await import("@/tests/_helpers/guides")).diskGuides(),
  allLegalPages: [],
}));

const { importGuestStateAction } = await import("@/app/[locale]/(protected)/import/actions");
const guestSchema = await import("@/lib/guest/schema");
const { GUEST_CAPS, GUEST_STATE_VERSION, MAX_GUEST_PAYLOAD_BYTES } = guestSchema;
/**
 * The parser, watched: "refused BEFORE it is parsed" is a claim about a call
 * that must not happen, and the answer alone cannot show it — `TOO_MANY` comes
 * back just the same when the payload was walked first (a mutation that moved
 * the parse above the size check left every test green, found in review).
 */
const parseGuestStateSpy = vi.spyOn(guestSchema, "parseGuestState");
const { RATE_LIMITS } = await import("@/lib/security/rate-limit");
const { deriveBike } = await import("@/lib/bike/rules");
const { BIKE_PRESETS, PRESET_IDS } = await import("@/lib/domain/data/presets");
const { guestRun, guestWork, partsScope, planFromDisk } =
  await import("@/tests/_helpers/guest-work");
const { MAX_REFINEMENT_VALUE_LENGTH } = await import("@/lib/shop/refinement");

type GuestBike = import("@/lib/guest/schema").GuestBike;
type GuestState = import("@/lib/guest/schema").GuestState;

// Module scope: `deriveBike` walks the whole part catalogue, and the unit
// tier's 5 s timeout is measured on a CI runner ~3x slower than this laptop.
const DERIVED = deriveBike(BIKE_PRESETS["gravel-1x11"]);
const LOCAL_ID = "11111111-2222-4333-8444-555555555555";
const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
const CHAIN = "check-drivetrain#chain-wear";
const CASSETTE = "check-drivetrain#cassette-teeth";
/** A real step of a real guide — for a bike with RIM brakes. Not in this bike's plan. */
const REAL_BUT_NOT_PLANNED = "check-brakes-rim#pad-wear";

/** A guest bike, a finished checkup (the chain is worn) and the list it produced. */
const WORK = guestWork({
  answers: BIKE_PRESETS["gravel-1x11"],
  bikeId: LOCAL_ID,
  updatedAt: "2026-09-14T09:00:00.000Z",
  checkup: (build) =>
    guestRun({
      id: CHECKUP_ID,
      build,
      scope: partsScope("chain", "cassette"),
      verdicts: { [CHAIN]: { ko: ["chain-elongation"] }, [CASSETTE]: "ok" },
      startedAt: "2026-09-14T08:00:00.000Z",
      completedAt: "2026-09-14T08:20:00.000Z",
    }),
});
const COLLECTED = JSON.stringify(WORK.collect().state.bikes[0]);

/** A fresh copy of the real bike, with one field replaced. */
function bike(patch: Partial<GuestBike> = {}): GuestBike {
  return { ...(JSON.parse(COLLECTED) as GuestBike), ...patch };
}
const CHECKUP = bike().checkups[0];
const LIST = bike().lists[0];

function state(...bikes: GuestBike[]): GuestState {
  return { version: GUEST_STATE_VERSION, bikes };
}

/** A deep clone with one field of the first bike replaced — the payload a script would send. */
function tampered(patch: Record<string, unknown>): unknown {
  const payload = JSON.parse(JSON.stringify(state(bike()))) as {
    bikes: Record<string, unknown>[];
  };
  Object.assign(payload.bikes[0], patch);
  return payload;
}

/** The real checkup with one thing changed. */
function checkupWith(patch: Record<string, unknown>): unknown {
  return tampered({ checkups: [{ ...CHECKUP, ...patch }] });
}

/** `count` step-keyed entries, each a syntactically valid key. */
function keyed<T>(count: number, value: T): Record<string, T> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`check-drivetrain#step-${index}`, value]),
  );
}

const TABLES = ["Bike", "BikePartState", "Checkup", "CheckupItem", "BuildList", "BuildListItem"];

/** Nothing at all was written. */
function expectNoWrites(): void {
  for (const table of TABLES) expect(fakeDb.rows(table), table).toEqual([]);
  expect(fakeDb.calls.filter((call) => call.op === "create")).toEqual([]);
}

interface SeededUser {
  id: string;
  email: string;
  name: string | null;
  locale: "fr" | "en";
}

let me: SeededUser;
let other: SeededUser;

beforeEach(async () => {
  fakeDb.reset();
  setRequestHeaders(sameOriginHeaders());
  me = (await fakeDb.seed("User", {
    email: "camille@velo-atelier.test",
    name: "Camille",
    locale: "fr",
  })) as unknown as SeededUser;
  other = (await fakeDb.seed("User", {
    email: "autre@velo-atelier.test",
    locale: "fr",
  })) as unknown as SeededUser;
  setSession(sessionFor(me));
  fakeDb.resetCalls();
  parseGuestStateSpy.mockClear();
});

describe("who is allowed to call it", () => {
  it("answers UNAUTHORIZED to an anonymous caller, before any query", async () => {
    setSession(null);
    expect(await importGuestStateAction(state(bike()))).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    expect(fakeDb.calls).toEqual([]);
  });

  it("answers FORBIDDEN to a cross-origin POST, session or not", async () => {
    setRequestHeaders({ origin: "https://evil.test", host: "localhost:3100" });
    expect(await importGuestStateAction(state(bike()))).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(fakeDb.calls).toEqual([]);

    setSession(null);
    expect(await importGuestStateAction(state(bike()))).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(fakeDb.calls).toEqual([]);
  });
});

describe("the four walls, in their order", () => {
  it("checks the caller before the size: an oversized anonymous payload is UNAUTHORIZED", async () => {
    setSession(null);
    const huge = tampered({ name: "x".repeat(MAX_GUEST_PAYLOAD_BYTES) });
    expect(await importGuestStateAction(huge)).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(fakeDb.calls).toEqual([]);
  });

  it("checks the size before the shape: an oversized AND malformed payload is TOO_MANY", async () => {
    const huge = tampered({ userId: "x", name: "x".repeat(MAX_GUEST_PAYLOAD_BYTES) });
    expect(await importGuestStateAction(huge)).toEqual({ ok: false, code: "TOO_MANY" });
    expectNoWrites();
    // The order itself, not only its answer: the parser never saw the payload.
    expect(parseGuestStateSpy).not.toHaveBeenCalled();
  });

  it("does parse a payload that is within the budget — the spy above is not blind", async () => {
    expect(await importGuestStateAction(tampered({ userId: "x" }))).toEqual({
      ok: false,
      code: "VALIDATION",
    });
    expect(parseGuestStateSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses at the size wall, without throwing, a value that has no JSON size", async () => {
    // React's action decoder delivers a BigInt when the request spells one, and
    // `JSON.stringify` throws on it: the measure was an unhandled TypeError.
    const cyclic: Record<string, unknown> = { version: GUEST_STATE_VERSION, bikes: [] };
    cyclic.self = cyclic;
    const payloads: [string, unknown][] = [
      ["a BigInt among the bikes", { version: GUEST_STATE_VERSION, bikes: [BigInt(10)] }],
      ["a BigInt deep in a real bike", tampered({ fit: { saddleHeightMm: BigInt(742) } })],
      ["a structure that contains itself", cyclic],
    ];
    for (const [name, payload] of payloads) {
      await expect(importGuestStateAction(payload), name).resolves.toEqual({
        ok: false,
        code: "TOO_MANY",
      });
    }
    // Refused where its size could not be known: not handed to the parser.
    expect(parseGuestStateSpy).not.toHaveBeenCalled();
    expectNoWrites();
    expect(fakeDb.rows("AuthAttempt")).toEqual([]);
  });

  it("checks the shape before the rate limit: a refused payload spends no attempt", async () => {
    for (let index = 0; index < RATE_LIMITS.guestImportPerUser.max + 2; index++) {
      expect(await importGuestStateAction(tampered({ userId: "x" }))).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expect(fakeDb.rows("AuthAttempt")).toEqual([]);
    expect((await importGuestStateAction(state(bike()))).ok).toBe(true);
  });

  it("checks the rate limit before any write", async () => {
    for (let index = 0; index < RATE_LIMITS.guestImportPerUser.max; index++) {
      await importGuestStateAction(
        state(bike({ localId: `5555555${index}-2222-4333-8444-555555555555`, checkups: [] })),
      );
    }
    const before = Object.fromEntries(TABLES.map((table) => [table, fakeDb.rows(table)]));
    fakeDb.resetCalls();

    const refused = await importGuestStateAction(state(bike()));
    expect(refused).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(Object.fromEntries(TABLES.map((table) => [table, fakeDb.rows(table)]))).toEqual(before);
    expect(fakeDb.calls.filter((call) => call.model !== "authAttempt")).toEqual([]);
  });
});

describe("mass assignment", () => {
  it("refuses a bike carrying a column the payload has no business naming", async () => {
    for (const extra of [
      { id: "00000000-0000-4000-8000-00000000dead" },
      { userId: "00000000-0000-4000-8000-00000000dead" },
      { spec: { version: 1 } },
      { createdAt: "2020-01-01T00:00:00.000Z" },
      { guestLocalId: LOCAL_ID },
      { specVersion: 99 },
      { passwordHash: "$2b$12$x" },
    ]) {
      expect(await importGuestStateAction(tampered(extra)), Object.keys(extra)[0]).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  it("refuses an extra key at every level of a checkup", async () => {
    const payloads: [string, unknown][] = [
      ["checkup.bikeId", checkupWith({ bikeId: "x" })],
      ["checkup.id", checkupWith({ id: "00000000-0000-4000-8000-00000000dead" })],
      // `status` is a column, not a field of the contract: a checkup says it
      // is finished by carrying the `completedAt` the wizard wrote.
      ["checkup.status", checkupWith({ status: "COMPLETED" })],
      // No step and no item travels (§5.4): the plan is the server's.
      ["checkup.steps", checkupWith({ steps: [{ key: CHAIN, partIds: ["frame"], ko: [] }] })],
      [
        "checkup.items",
        checkupWith({
          items: [{ stepKey: CHAIN, partId: "frame", guideSlug: "check-frame", result: "ko" }],
        }),
      ],
      ["checkup.toolsMissing", checkupWith({ toolsMissing: [] })],
      ["scope.userId", checkupWith({ scope: { ...CHECKUP.scope, userId: "x" } })],
      ["scope(full).partIds", checkupWith({ scope: { kind: "full", partIds: ["chain"] } })],
    ];
    for (const [name, payload] of payloads) {
      expect(await importGuestStateAction(payload), name).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  it("refuses an extra key on a list, a line or the envelope — a link least of all", async () => {
    const line = LIST.items[0];
    const payloads: [string, unknown][] = [
      ["list.checkupId", tampered({ lists: [{ ...LIST, checkupId: "x" }] })],
      ["list.status", tampered({ lists: [{ ...LIST, status: "ARCHIVED" }] })],
      // Which item a line belongs to is derived from the re-planned checkup.
      [
        "line.checkupItemId",
        tampered({
          lists: [
            {
              ...LIST,
              items: [{ ...line, checkupItemId: "00000000-0000-4000-8000-00000000dead" }],
            },
          ],
        }),
      ],
      [
        "line.doneReason",
        tampered({ lists: [{ ...LIST, items: [{ ...line, doneReason: "x" }] }] }),
      ],
      ["envelope.userId", { ...state(bike()), userId: "x" }],
    ];
    for (const [name, payload] of payloads) {
      expect(await importGuestStateAction(payload), name).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  it("refuses an own `__proto__` key ON a checkup, and never stores one found IN its records", async () => {
    // `JSON.parse` creates `__proto__` as an OWN property; an object literal
    // would set the prototype instead and prove nothing.
    const own = (json: string) => JSON.parse(json) as Record<string, unknown>;

    // On a `strictObject` it is an unknown key like any other: refused.
    const onCheckup = own(`{"__proto__": {"status": "COMPLETED"}}`);
    expect(Object.hasOwn(onCheckup, "__proto__")).toBe(true);
    expect(await importGuestStateAction(checkupWith(onCheckup))).toEqual({
      ok: false,
      code: "VALIDATION",
    });
    expectNoWrites();

    // In a RECORD, zod 4 skips the key instead of failing the parse (measured
    // on 4.5.4, and on 4.6.6 on 2026-10-24;
    // `tests/integration/build-lists.test.ts` pins the same for a
    // refinement). So the pin is on what follows: the key is gone before the
    // plan is consulted, it becomes no row, and the real answers beside it
    // are kept.
    const answers = own(`{"__proto__": "ko", "${CHAIN}": "ko", "${CASSETTE}": "ok"}`);
    const symptoms = own(`{"__proto__": ["chain-elongation"], "${CHAIN}": ["chain-elongation"]}`);
    const notes = own(`{"__proto__": "x"}`);
    for (const record of [answers, symptoms, notes]) {
      expect(Object.hasOwn(record, "__proto__")).toBe(true);
    }
    const result = await importGuestStateAction(checkupWith({ answers, symptoms, notes }));
    expect(result.ok).toBe(true);
    const items = fakeDb.rows("CheckupItem") as { stepKey: string; notes: unknown }[];
    expect(items.map((item) => item.stepKey)).toEqual([CHAIN, CASSETTE]);
    expect(items.map((item) => item.notes)).toEqual([null, null]);
  });

  it("takes the owner from the session and the spec from the domain, never from the payload", async () => {
    const result = await importGuestStateAction(state(bike()));
    expect(result.ok).toBe(true);

    const [row] = fakeDb.rows("Bike") as Record<string, unknown>[];
    expect(row.userId).toBe(me.id);
    expect(row.spec).toEqual(DERIVED.spec);
    expect(row.specVersion).toBe(1);
    expectScopedToUser(fakeDb.calls, me.id);
  });
});

describe("the server re-plans: the payload names no step, no part and no guide (§5.4)", () => {
  it("writes each answer against the part and the guide the PLAN gives its step", async () => {
    const result = await importGuestStateAction(state(bike()));
    expect(result.ok && result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "imported" },
    ]);

    const items = (fakeDb.rows("CheckupItem") as Record<string, unknown>[]).map((item) => [
      item.stepKey,
      item.partId,
      item.guideSlug,
      item.result,
      item.reasonKeys,
    ]);
    expect(items).toEqual([
      [CHAIN, "chain", "check-drivetrain", "KO", ["chain-elongation"]],
      [CASSETTE, "cassette", "check-drivetrain", "OK", []],
    ]);
    expectScopedToUser(fakeDb.calls, me.id);
  });

  it("buys nothing with the scope it names: every question of every bike answered 'about the chain' writes this bike's plan, each row the plan's", async () => {
    // The answers are accepted against the bike's whole plan, whatever scope
    // the payload names (a wizard that resumes a run under another link leaves
    // a stale one). So the scope is not a way in: a payload that claims to be
    // about one part and answers EVERYTHING gets exactly what a full checkup
    // would — this bike's questions, about the plan's parts and guides.
    const plans = PRESET_IDS.map((preset) => {
      // eslint-disable-next-line security/detect-object-injection -- `preset` iterates the literal PRESET_IDS
      const derived = deriveBike(BIKE_PRESETS[preset]);
      return planFromDisk({ spec: derived.spec, parts: derived.parts }, { kind: "full" });
    });
    const mine = planFromDisk({ spec: DERIVED.spec, parts: DERIVED.parts }, { kind: "full" });
    const everyKey = [...new Set([...mine, ...plans.flat()].map((step) => step.key))].slice(
      0,
      GUEST_CAPS.answersPerCheckup,
    );
    // Questions of other bikes are in there too — a motor, rim brakes.
    expect(everyKey.length).toBeGreaterThan(mine.length + 10);
    const everyReason = [
      ...new Set(plans.flat().flatMap((step) => step.ko.map((ko) => ko.reasonKey))),
    ].slice(0, GUEST_CAPS.symptomsPerStep);

    const result = await importGuestStateAction(
      checkupWith({
        scope: { kind: "parts", partIds: ["chain"] },
        answers: Object.fromEntries(everyKey.map((key) => [key, "ko"])),
        symptoms: Object.fromEntries(everyKey.map((key) => [key, everyReason])),
        notes: Object.fromEntries(everyKey.map((key) => [key, "n"])),
      }),
    );
    expect(result.ok && result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "imported" },
    ]);

    const byKey = new Map(mine.map((step) => [step.key, step]));
    const items = fakeDb.rows("CheckupItem") as {
      stepKey: string;
      partId: string;
      guideSlug: string;
      reasonKeys: string[];
    }[];
    // This bike's plan, no more and no less…
    expect(items.map((item) => item.stepKey).sort()).toEqual([...byKey.keys()].sort());
    for (const item of items) {
      const step = byKey.get(item.stepKey);
      // …each row about the part and the guide the PLAN gives its step…
      expect(item.partId, item.stepKey).toBe(step?.partIds[0]);
      expect(item.guideSlug, item.stepKey).toBe(step?.guideSlug);
      // …with no symptom the step does not offer.
      const offered = new Set(step?.ko.map((ko) => ko.reasonKey));
      expect(
        item.reasonKeys.filter((reason) => !offered.has(reason)),
        item.stepKey,
      ).toEqual([]);
    }
    // Not "about the chain": the column says what was answered.
    expect((fakeDb.rows("Checkup") as { scope: string }[])[0].scope).toBe("FULL");
    // And every part state is on a part of THIS bike, named by a row.
    const named = new Set(items.map((item) => item.partId));
    const touched = (fakeDb.rows("BikePartState") as { partId: string; status: string }[]).filter(
      (row) => row.status !== "UNKNOWN",
    );
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.every((row) => named.has(row.partId))).toBe(true);
    expectScopedToUser(fakeDb.calls, me.id);
  });

  it("drops a step key that is not in this bike's plan — it writes no row", async () => {
    const answers = { ...CHECKUP.answers, [REAL_BUT_NOT_PLANNED]: "ko", "check-x#invented": "ko" };
    const notes = { [REAL_BUT_NOT_PLANNED]: "des patins sur un vélo à disques" };
    const result = await importGuestStateAction(checkupWith({ answers, notes }));
    expect(result.ok).toBe(true);

    const items = fakeDb.rows("CheckupItem") as { stepKey: string; partId: string }[];
    expect(items.map((item) => item.stepKey)).toEqual([CHAIN, CASSETTE]);
    // …and no part of the bike is declared broken on the strength of it.
    const broken = (fakeDb.rows("BikePartState") as { partId: string; status: string }[])
      .filter((row) => row.status === "BROKEN")
      .map((row) => row.partId);
    expect(broken).toEqual(["chain"]);
  });

  it("drops a symptom the step does not offer", async () => {
    // `pad-worn` is a real reason key — of the brake-pad question. On the chain
    // it would put a line on the list that nothing explains. And `cassette-worn`
    // IS a symptom the cassette question offers — but the cassette was answered
    // OK, and an OK has no symptom.
    const symptoms = { [CHAIN]: ["pad-worn", "chain-elongation"], [CASSETTE]: ["cassette-worn"] };
    const result = await importGuestStateAction(checkupWith({ symptoms }));
    expect(result.ok).toBe(true);

    const byKey = new Map(
      (fakeDb.rows("CheckupItem") as { stepKey: string; reasonKeys: string[] }[]).map((item) => [
        item.stepKey,
        item.reasonKeys,
      ]),
    );
    expect(byKey.get(CHAIN)).toEqual(["chain-elongation"]);
    expect(byKey.get(CASSETTE)).toEqual([]);
  });

  it("writes no checkup at all when none of its answers is this bike's, and says so", async () => {
    const result = await importGuestStateAction(
      checkupWith({ answers: { [REAL_BUT_NOT_PLANNED]: "ko" }, symptoms: {}, notes: {} }),
    );
    expect(result.ok && result.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "skipped", reason: "nothing-kept" },
    ]);
    expect(fakeDb.rows("Bike")).toHaveLength(1);
    expect(fakeDb.rows("Checkup")).toEqual([]);
    // Nothing links the list to a checkup that does not exist.
    expect((fakeDb.rows("BuildList") as { checkupId: unknown }[])[0].checkupId).toBeNull();
  });

  it("takes the END of a checkup from the payload, and nothing else about it", async () => {
    // One question of two answered, and a `completedAt` beside it. The date is
    // the payload's to give — a finished checkup stays finished when the plan
    // has since grown — but it buys nothing: what is written is still one row
    // per ANSWERED question of the server's plan, and a part state for those.
    const result = await importGuestStateAction(
      checkupWith({ answers: { [CHAIN]: "ko" }, symptoms: {}, notes: {} }),
    );
    expect(result.ok).toBe(true);
    const [checkup] = fakeDb.rows("Checkup") as { status: string; completedAt: unknown }[];
    expect(checkup.status).toBe("COMPLETED");
    expect(checkup.completedAt).toBeInstanceOf(Date);
    expect(
      (fakeDb.rows("CheckupItem") as { stepKey: string }[]).map((item) => item.stepKey),
    ).toEqual([CHAIN]);
    // The question nobody answered says nothing about its part.
    const known = (fakeDb.rows("BikePartState") as { partId: string; status: string }[])
      .filter((row) => row.status !== "UNKNOWN")
      .map((row) => [row.partId, row.status]);
    expect(known).toEqual([["chain", "BROKEN"]]);
  });

  it("leaves a checkup with no completedAt in progress: no part state, no link", async () => {
    const unfinished = { ...CHECKUP } as Record<string, unknown>;
    delete unfinished.completedAt;
    const result = await importGuestStateAction(tampered({ checkups: [unfinished] }));
    expect(result.ok).toBe(true);
    const [checkup] = fakeDb.rows("Checkup") as { status: string; completedAt: unknown }[];
    expect(checkup.status).toBe("IN_PROGRESS");
    expect(checkup.completedAt).toBeNull();
    // An unfinished checkup changes no part and owns no line.
    const statuses = new Set(
      (fakeDb.rows("BikePartState") as { status: string }[]).map((row) => row.status),
    );
    expect(statuses).toEqual(new Set(["UNKNOWN"]));
    expect((fakeDb.rows("BuildList") as { checkupId: unknown }[])[0].checkupId).toBeNull();
    expect(
      (fakeDb.rows("BuildListItem") as { checkupItemId: unknown }[]).map(
        (line) => line.checkupItemId,
      ),
    ).toEqual([null]);
  });

  it("links the list to the checkup the server wrote, by ids the server chose", async () => {
    await importGuestStateAction(state(bike()));
    const [checkup] = fakeDb.rows("Checkup") as { id: string; status: string }[];
    // Finished: the payload carries the `completedAt` the wizard wrote.
    expect(checkup.status).toBe("COMPLETED");
    const chain = (fakeDb.rows("CheckupItem") as { id: string; stepKey: string }[]).find(
      (item) => item.stepKey === CHAIN,
    );
    expect((fakeDb.rows("BuildList") as { checkupId: string }[])[0].checkupId).toBe(checkup.id);
    expect(
      (fakeDb.rows("BuildListItem") as { checkupItemId: string }[]).map(
        (line) => line.checkupItemId,
      ),
    ).toEqual([chain?.id]);
  });
});

describe("another account's rows", () => {
  it("are neither read nor written when the payload names their guest bike", async () => {
    const theirs = (await fakeDb.seed("Bike", {
      userId: other.id,
      name: "Le vélo du voisin",
      answers: DERIVED.answers,
      spec: DERIVED.spec,
      parts: DERIVED.parts,
      guestLocalId: LOCAL_ID,
    })) as { id: string; name: string };
    // …and their copy of the very same checkup, under THEIR user-scoped key.
    await fakeDb.seed("Checkup", {
      bikeId: theirs.id,
      scope: "PARTIAL",
      guestKey: `${other.id}:${CHECKUP_ID}`,
    });
    fakeDb.resetCalls();

    const result = await importGuestStateAction(state(bike()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A row of this caller's own, not a second chance at theirs.
    expect(result.data.imported).toBe(1);
    expect(result.data.bikes[0].bikeId).not.toBe(theirs.id);
    // Their checkup does not make mine "already imported".
    expect(result.data.bikes[0].checkups).toEqual([{ guestKey: CHECKUP_ID, status: "imported" }]);
    expect(fakeDb.rows("Bike")).toHaveLength(2);
    expect(fakeDb.rows("Checkup")).toHaveLength(2);
    const untouched = (fakeDb.rows("Bike") as { id: string; name: string }[]).find(
      (row) => row.id === theirs.id,
    );
    expect(untouched?.name).toBe("Le vélo du voisin");
    expectScopedToUser(fakeDb.calls, me.id);
  });
});

describe("a shared browser", () => {
  it("lets a second person import the same bike and checkup: the key is theirs, not global", async () => {
    // The neighbour first, through the very same action: their bike, their
    // checkup, under `Checkup.guestKey` — a column that is unique across ALL
    // accounts. The key is `<userId>:<state id>`; with the bare state id this
    // caller's import would collide on a row it cannot see, and fail whole.
    setSession(sessionFor(other));
    const theirs = await importGuestStateAction(state(bike()));
    expect(theirs.ok && theirs.data.bikes[0].checkups[0].status).toBe("imported");

    setSession(sessionFor(me));
    fakeDb.resetCalls();
    const mine = await importGuestStateAction(state(bike()));
    expect(mine.ok && mine.data.imported).toBe(1);
    expect(mine.ok && mine.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "imported" },
    ]);

    expect((fakeDb.rows("Checkup") as { guestKey: string }[]).map((row) => row.guestKey)).toEqual([
      `${other.id}:${CHECKUP_ID}`,
      `${me.id}:${CHECKUP_ID}`,
    ]);
    expect(fakeDb.rows("Bike")).toHaveLength(2);
    expectScopedToUser(fakeDb.calls, me.id);
  });
});

describe("the caps §4.4 names", () => {
  it("refuses more than ten bikes, and writes nothing", async () => {
    const eleven = Array.from({ length: GUEST_CAPS.bikes + 1 }, (_, index) =>
      bike({ localId: `1111111${index}-2222-4333-8444-555555555555` }),
    );
    expect(await importGuestStateAction(state(...eleven))).toEqual({
      ok: false,
      code: "VALIDATION",
    });
    expectNoWrites();
  });

  it("refuses more than eighty parts, twenty checkups or ten lists", async () => {
    const payloads = [
      tampered({ parts: Array(GUEST_CAPS.partsPerBike + 1).fill({}) }),
      tampered({ checkups: Array(GUEST_CAPS.checkupsPerBike + 1).fill(CHECKUP) }),
      tampered({ lists: Array(GUEST_CAPS.listsPerBike + 1).fill(LIST) }),
    ];
    for (const payload of payloads) {
      expect(await importGuestStateAction(payload)).toEqual({ ok: false, code: "VALIDATION" });
    }
    expectNoWrites();
  });

  it("refuses a checkup over any of its own caps: records, symptoms, notes, scope", async () => {
    const over = GUEST_CAPS.answersPerCheckup + 1;
    const payloads: [string, unknown][] = [
      // A record has no `maxLength`: each of the three is capped by entry count.
      ["answers", checkupWith({ answers: keyed(over, "ok") })],
      ["symptoms", checkupWith({ symptoms: keyed(over, ["chain-elongation"]) })],
      ["notes", checkupWith({ notes: keyed(over, "x") })],
      [
        "symptoms per step",
        checkupWith({
          symptoms: {
            [CHAIN]: Array.from({ length: GUEST_CAPS.symptomsPerStep + 1 }, (_, i) => `r-${i}`),
          },
        }),
      ],
      ["note length", checkupWith({ notes: { [CHAIN]: "n".repeat(2001) } })],
      [
        "scope parts",
        checkupWith({
          scope: {
            kind: "parts",
            partIds: Array.from({ length: GUEST_CAPS.scopeParts + 1 }, (_, i) => `part-${i}`),
          },
        }),
      ],
    ];
    for (const [name, payload] of payloads) {
      expect(await importGuestStateAction(payload), name).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  it("accepts a checkup exactly AT its caps, and stores only what the plan asks", async () => {
    // 250 syntactically valid keys nobody planned, plus the two real ones
    // would be 252: stay at the cap.
    const answers = { ...keyed(GUEST_CAPS.answersPerCheckup - 2, "ko"), ...CHECKUP.answers };
    expect(Object.keys(answers)).toHaveLength(GUEST_CAPS.answersPerCheckup);
    const result = await importGuestStateAction(checkupWith({ answers }));
    expect(result.ok).toBe(true);
    expect(fakeDb.rows("CheckupItem")).toHaveLength(2);
  });

  it("refuses a list over 50 lines", async () => {
    const line = LIST.items[0];
    const payload = tampered({
      lists: [
        {
          ...LIST,
          items: Array.from({ length: GUEST_CAPS.itemsPerList + 1 }, (_, index) => ({
            ...line,
            sortOrder: index,
          })),
        },
      ],
    });
    expect(await importGuestStateAction(payload)).toEqual({ ok: false, code: "VALIDATION" });
    expectNoWrites();
  });

  /**
   * A line of the real list carrying `count` refinement answers: 40-character
   * keys, and values exactly at the cap on one answer — 64 characters since
   * 2026-10-13, `lib/shop/refinement.ts`'s, where the contract said 120.
   */
  function refined(
    count: number,
    character = "v",
  ): { payload: unknown; refinement: Record<string, string> } {
    const refinement = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `k-${String(index).padStart(38, "0")}`,
        character.repeat(MAX_REFINEMENT_VALUE_LENGTH),
      ]),
    );
    return {
      refinement,
      payload: tampered({ lists: [{ ...LIST, items: [{ ...LIST.items[0], refinement }] }] }),
    };
  }

  it("refuses a line whose refinement has more answers than a part has attributes", async () => {
    // A record, and until 2026-10-09 the one record of the payload with no cap:
    // 1 400 entries — 230 KB of JSON in one column at the 120 characters a
    // value could then have — passed all four walls.
    for (const count of [GUEST_CAPS.refinementEntries + 1, 1400]) {
      const { payload } = refined(count);
      expect(guestSchema.withinGuestPayloadBudget(payload), String(count)).toBe(true);
      expect(await importGuestStateAction(payload), String(count)).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  it("stores a refinement exactly AT its cap, inside the 32 KB every JSON column is held to", async () => {
    const { withinJsonBudget } = await import("@/lib/bike/rules");
    // Three UTF-8 bytes a character: the heaviest value the contract allows.
    const { payload, refinement } = refined(GUEST_CAPS.refinementEntries, "€");
    expect((await importGuestStateAction(payload)).ok).toBe(true);
    const [line] = fakeDb.rows("BuildListItem") as { refinement: Record<string, string> }[];
    expect(line.refinement).toEqual(refinement);
    // The largest refinement the contract lets through fits the column's budget.
    expect(withinJsonBudget(line.refinement)).toBe(true);
  });

  it("keeps the refinement cap at the account's own (`MAX_REFINEMENT_KEYS`, liste/actions.ts)", async () => {
    // That constant is private to a `"use server"` module, which may export
    // only async functions: read where it is written.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/[locale]/velo/[id]/liste/actions.ts", "utf8");
    const declared = /^const MAX_REFINEMENT_KEYS = (\d+);$/m.exec(source)?.[1];
    expect(declared).toBeDefined();
    expect(GUEST_CAPS.refinementEntries).toBe(Number(declared));
  });

  it("keeps the caps at the account's own quotas, so an import cannot bring more", async () => {
    const { QUOTAS } = await import("@/lib/bike/rules");
    expect(GUEST_CAPS.itemsPerList).toBe(QUOTAS.itemsPerList);
    expect(GUEST_CAPS.listsPerBike).toBeLessThanOrEqual(QUOTAS.listsPerBike);
    expect(GUEST_CAPS.checkupsPerBike).toBeLessThanOrEqual(QUOTAS.checkupsPerBike);
    expect(GUEST_CAPS.bikes).toBeLessThanOrEqual(QUOTAS.bikesPerUser);
    expect(GUEST_CAPS.answersPerCheckup).toBe(250);
  });

  it("refuses a payload over 256 KB before it parses a field of it", async () => {
    const huge = tampered({ name: "x".repeat(MAX_GUEST_PAYLOAD_BYTES) });
    expect(await importGuestStateAction(huge)).toEqual({ ok: false, code: "TOO_MANY" });
    expectNoWrites();
    // "Before it parses": the parser was not called at all.
    expect(parseGuestStateSpy).not.toHaveBeenCalled();
  });

  it("answers TOO_MANY to a checkup filled to every cap at once — 256 KB comes first", async () => {
    const key = (index: number) =>
      `${"a".repeat(90)}-${String(index).padStart(4, "0")}#${"b".repeat(64)}`;
    const notes = Object.fromEntries(
      Array.from({ length: GUEST_CAPS.answersPerCheckup }, (_, i) => [key(i), "n".repeat(2000)]),
    );
    expect(await importGuestStateAction(checkupWith({ notes }))).toEqual({
      ok: false,
      code: "TOO_MANY",
    });
    expectNoWrites();
  });
});

describe("hostile strings", () => {
  it("never lets a step key, a part id, a reason key or a slug out of `[a-z0-9-]`", async () => {
    const line = LIST.items[0];
    const payloads: [string, unknown][] = [
      ["answers key", checkupWith({ answers: { "../../../etc/passwd#x": "ko" } })],
      ["answers key, no step", checkupWith({ answers: { "check-drivetrain": "ko" } })],
      ["notes key", checkupWith({ notes: { "check-drivetrain#<script>": "x" } })],
      ["symptoms key", checkupWith({ symptoms: { "Check-Drivetrain#chain-wear": [] } })],
      ["reason key", checkupWith({ symptoms: { [CHAIN]: ["<script>alert(1)</script>"] } })],
      ["scope part", checkupWith({ scope: { kind: "parts", partIds: ["../chain"] } })],
      ["line slug", tampered({ lists: [{ ...LIST, items: [{ ...line, guideSlug: "a/../b" }] }] })],
      ["line reason", tampered({ lists: [{ ...LIST, items: [{ ...line, reasonKey: "<x>" }] }] })],
      ["line part", tampered({ lists: [{ ...LIST, items: [{ ...line, partId: "../chain" }] }] })],
    ];
    for (const [name, payload] of payloads) {
      expect(await importGuestStateAction(payload), name).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  it("answers VALIDATION — never a 500 — to an id longer than its column", async () => {
    const line = LIST.items[0];
    // `CheckupItem.stepKey` VarChar(160), `reasonKeys` VarChar(80)[],
    // `partId` VarChar(64), `BuildListItem.guideSlug` VarChar(160).
    const stepKey = `${"a".repeat(96)}#${"b".repeat(64)}`;
    expect(stepKey.length).toBe(161);
    const payloads: [string, unknown][] = [
      ["step key, 161", checkupWith({ answers: { [stepKey]: "ko" } })],
      ["step id, 65", checkupWith({ notes: { [`check-drivetrain#${"b".repeat(65)}`]: "x" } })],
      ["step key, 5000", checkupWith({ symptoms: { [`${"a".repeat(5000)}#b`]: [] } })],
      ["reason key, 81", checkupWith({ symptoms: { [CHAIN]: ["r".repeat(81)] } })],
      ["scope part, 65", checkupWith({ scope: { kind: "parts", partIds: ["p".repeat(65)] } })],
      [
        "line part, 65",
        tampered({ lists: [{ ...LIST, items: [{ ...line, partId: "p".repeat(65) }] }] }),
      ],
      [
        "line slug, 161",
        tampered({ lists: [{ ...LIST, items: [{ ...line, guideSlug: "s".repeat(161) }] }] }),
      ],
      [
        "line reason, 81",
        tampered({ lists: [{ ...LIST, items: [{ ...line, reasonKey: "r".repeat(81) }] }] }),
      ],
      ["guest key, not a uuid", checkupWith({ guestKey: "x".repeat(300) })],
    ];
    for (const [name, payload] of payloads) {
      // Resolves — a rejection here is the 500 this test exists to rule out.
      await expect(importGuestStateAction(payload), name).resolves.toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  // ── a string the database does not store ───────────────────────────────────

  const TYPED_LINE = {
    ...LIST.items[0],
    refinement: { speeds: "11" },
    chosenProduct: {
      brand: "Shimano",
      model: "CN-HG601",
      size: "11v",
      vendor: "other",
      url: "https://example.com/chaine",
    },
  };
  type StoredParts = { partId: string; attributes: Record<string, unknown> }[];
  /** The real bike's parts, with the front pads' free-text reference set. */
  function partsWithPadModel(model: string): StoredParts {
    const parts = JSON.parse(JSON.stringify(bike().parts)) as StoredParts;
    const pads = parts.find((part) => part.partId === "brake-pads-front");
    if (pads === undefined) throw new Error("the gravel preset has front brake pads");
    pads.attributes["pad-model"] = model;
    return parts;
  }
  /**
   * One payload per place where a string is free text — each the real bike
   * with `poison` put in exactly that place.
   */
  function payloadsHolding(poison: string): [string, unknown][] {
    const lineWith = (patch: Record<string, unknown>) =>
      tampered({ lists: [{ ...LIST, items: [{ ...TYPED_LINE, ...patch }] }] });
    const product = (patch: Record<string, string>) =>
      lineWith({ chosenProduct: { ...TYPED_LINE.chosenProduct, ...patch } });
    return [
      ["the bike's name", tampered({ name: `Mon${poison}vélo` })],
      ["a note", checkupWith({ notes: { [CHAIN]: `usure${poison}0,8 %` } })],
      ["a note that is nothing else", checkupWith({ notes: { [CHAIN]: poison } })],
      ["the list's name", tampered({ lists: [{ ...LIST, name: `Ma${poison}liste` }] })],
      ["a refinement value", lineWith({ refinement: { speeds: `11${poison}` } })],
      ["a product's brand", product({ brand: `Shi${poison}mano` })],
      ["a product's model", product({ model: `CN${poison}HG601` })],
      ["a product's size", product({ size: `11${poison}v` })],
      ["a product's link", product({ url: `https://example.com/cha${poison}ine` })],
      ["a part's free-text attribute", tampered({ parts: partsWithPadModel(`B05S${poison}`) })],
      ["a key inside a part", tampered({ parts: [{ [`part${poison}Id`]: "chain" }] })],
      ["a value deep inside the fit", tampered({ fit: { a: [{ b: [`x${poison}`] }] } })],
    ];
  }
  /** The very same shapes with an ordinary text in each place: imported, and stored as sent. */
  async function expectImportedWith(text: string): Promise<void> {
    const clean = tampered({
      name: `Mon vélo${text}`,
      parts: partsWithPadModel(`B05S${text}`),
      fit: { saddleHeightMm: 742 },
      lists: [
        {
          ...LIST,
          name: `Ma liste${text}`,
          items: [
            {
              ...TYPED_LINE,
              refinement: { speeds: `11${text}` },
              chosenProduct: { ...TYPED_LINE.chosenProduct, model: `CN-HG601${text}` },
            },
          ],
        },
      ],
      checkups: [{ ...CHECKUP, notes: { [CHAIN]: `usure 0,8 %${text}` } }],
    });
    expect((await importGuestStateAction(clean)).ok).toBe(true);
    const [stored] = fakeDb.rows("Bike") as { name: string; parts: StoredParts }[];
    expect(stored.name).toBe(`Mon vélo${text}`);
    expect(
      stored.parts.find((part) => part.partId === "brake-pads-front")?.attributes["pad-model"],
    ).toBe(`B05S${text}`);
    expect(fakeDb.rows("BuildListItem")[0]).toMatchObject({
      refinement: { speeds: `11${text}` },
      chosenProduct: { model: `CN-HG601${text}` },
    });
    expect(fakeDb.rows("CheckupItem").find((row) => row.stepKey === CHAIN)).toMatchObject({
      notes: `usure 0,8 %${text}`,
    });
  }

  it("answers VALIDATION to a U+0000 in any string — PostgreSQL stores it in no column", async () => {
    const NUL = String.fromCharCode(0);
    const payloads = payloadsHolding(NUL);
    expect(payloads).toHaveLength(12);
    for (const [name, payload] of payloads) {
      await expect(importGuestStateAction(payload), name).resolves.toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
    // Controls: the very same shapes without the character are imported, so
    // what is refused above is the character and nothing else about them.
    await expectImportedWith("");
  });

  it("answers VALIDATION to a lone surrogate in any string — half an emoji, which jsonb refuses and text does not keep", async () => {
    // The fake stores half a surrogate pair like any string. No real row
    // does: `jsonb` aborts the transaction on it, and a `text` column is sent
    // U+FFFD in its place by node-postgres, before PostgreSQL sees anything
    // (`tests/integration/guest-import.test.ts` shows both). Until
    // 2026-10-09 these payloads passed all four walls.
    const HIGH = String.fromCharCode(0xd83d);
    const LOW = String.fromCharCode(0xde00);
    for (const [which, half] of [
      ["the first half", HIGH],
      ["the second half", LOW],
      ["the halves the wrong way round", LOW + HIGH],
    ]) {
      for (const [name, payload] of payloadsHolding(half)) {
        // As the wire carries it: JSON escapes the half and the server's
        // parser gives it back, so it arrives exactly as it left.
        const wire: unknown = JSON.parse(JSON.stringify(payload));
        await expect(importGuestStateAction(wire), `${name}: ${which}`).resolves.toEqual({
          ok: false,
          code: "VALIDATION",
        });
      }
    }
    expectNoWrites();
    // Refused at the shape, the third wall: none of the visitor's three
    // hourly attempts was spent on it.
    expect(fakeDb.rows("AuthAttempt")).toEqual([]);
    // The control: a WHOLE emoji in each of those places is imported and
    // stored as sent. What is refused is the half.
    await expectImportedWith(HIGH + LOW);
  });

  it("answers VALIDATION to a date that is not ISO 8601, or that PostgreSQL has no year for", async () => {
    const dates: [string, unknown][] = [
      ["a word", "bientot"],
      ["a date without a time", "2026-09-14"],
      ["no offset", "2026-09-14T08:00:00.000"],
      ["month 13", "2026-13-45T99:99:99Z"],
      ["a number", 1_726_300_800_000],
      ["year 0000", "0000-01-01T00:00:00.000Z"],
      ["year 1, walked back into year 0 by its offset", "0001-01-01T00:00:00.000+14:00"],
    ];
    for (const [name, value] of dates) {
      for (const payload of [
        checkupWith({ startedAt: value }),
        checkupWith({ completedAt: value }),
        tampered({ updatedAt: value }),
      ]) {
        await expect(importGuestStateAction(payload), name).resolves.toEqual({
          ok: false,
          code: "VALIDATION",
        });
      }
    }
    expectNoWrites();
    // The earliest instant the database stores, and a clock that was reset:
    // both are dates, and both are imported.
    for (const [index, startedAt] of [
      "0001-01-01T00:00:00.000Z",
      "1970-01-01T00:00:05.000Z",
    ].entries()) {
      const result = await importGuestStateAction(
        state(
          bike({
            localId: `6666666${index}-2222-4333-8444-555555555555`,
            checkups: [
              { ...CHECKUP, guestKey: `7777777${index}-2222-4333-8444-555555555555`, startedAt },
            ],
          }),
        ),
      );
      expect(result.ok && result.data.bikes[0].checkups[0].status, startedAt).toBe("imported");
    }
    expect(
      (fakeDb.rows("Checkup") as { startedAt: Date }[]).map((row) => row.startedAt.toISOString()),
    ).toEqual(["0001-01-01T00:00:00.000Z", "1970-01-01T00:00:05.000Z"]);
  });

  it("stores the longest ids the columns hold without complaint", async () => {
    const stepKey = `${"a".repeat(95)}#${"b".repeat(64)}`;
    expect(stepKey.length).toBe(160);
    const result = await importGuestStateAction(
      checkupWith({
        answers: { ...CHECKUP.answers, [stepKey]: "ko" },
        symptoms: { ...CHECKUP.symptoms, [stepKey]: ["r".repeat(80)] },
      }),
    );
    // Accepted by the schema; not in the plan, so not stored.
    expect(result.ok).toBe(true);
    expect(fakeDb.rows("CheckupItem")).toHaveLength(2);
  });

  it("stores no chosen product whose link is not plain https", async () => {
    const product = { brand: "Shimano", model: "CN-HG601", size: "11v", vendor: "alltricks" };
    for (const url of [
      "javascript:alert(1)",
      "http://alltricks.fr/x",
      "data:text/html;base64,PHNjcmlwdD4=",
      "https://user:pass@alltricks.fr/x",
    ]) {
      const payload = tampered({
        lists: [{ ...LIST, items: [{ ...LIST.items[0], chosenProduct: { ...product, url } }] }],
      });
      expect(await importGuestStateAction(payload), url).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  it("stores no chosen product whose link is not on the retailer it names (§4.4)", async () => {
    const base = { brand: "Shimano", model: "CN-HG601", size: "11v" };
    for (const product of [
      // Somewhere else entirely.
      { ...base, vendor: "alltricks", url: "https://evil.example/chain" },
      // A real retailer, but not the one the product claims to come from.
      { ...base, vendor: "alltricks", url: "https://www.rosebikes.fr/search?q=chain" },
      // The host is a SUFFIX of a retailer's, which a substring check would pass.
      { ...base, vendor: "rosebikes", url: "https://www.rosebikes.fr.evil.example/x" },
      // A subdomain nobody declared.
      { ...base, vendor: "decathlon", url: "https://promo.decathlon.fr/x" },
      // A vendor §4.2 does not know (`RetailerId | 'other'`): not an `other`.
      { ...base, vendor: "velo-shop", url: "https://velo-shop.example/x" },
    ]) {
      const payload = tampered({
        lists: [{ ...LIST, items: [{ ...LIST.items[0], chosenProduct: product }] }],
      });
      expect(await importGuestStateAction(payload), product.url).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
  });

  it("keeps a retailer's own link, and a link the visitor pasted (§4.4)", async () => {
    const base = { brand: "Shimano", model: "CN-HG601", size: "11v" };
    for (const [index, product] of [
      { ...base, vendor: "alltricks", url: "https://www.alltricks.fr/C-40598-toutes-les-chaines" },
      { ...base, vendor: "rosebikes", url: "https://www.rosebikes.com/search?q=chain" },
      // `other` is the escape hatch the plan names: plain https is the only bar.
      { ...base, vendor: "other", url: "https://mon-velociste-du-coin.fr/chaine-11v" },
    ].entries()) {
      fakeDb.resetCalls();
      const payload = state(
        bike({
          localId: `6666666${index}-2222-4333-8444-555555555555`,
          checkups: [],
          lists: [{ ...LIST, items: [{ ...LIST.items[0], chosenProduct: product }] }],
        }),
      );
      const result = await importGuestStateAction(payload);
      expect(result.ok && result.data.imported, product.url).toBe(1);
    }
    expect(fakeDb.rows("BuildListItem")).toHaveLength(3);
  });
});

describe("one refinement answer longer than the list page reads (the cap of `lib/shop/refinement.ts`)", () => {
  /**
   * The contract took an answer of up to 120 characters until 2026-10-13,
   * against 64 on the list page and in the saved bike's action and loader. A
   * guest's answer of 65 to 120 characters was therefore IMPORTED into a
   * column whose only reader drops it. The collector no longer sends one, so
   * these are payloads it did not build: a hand-made one — or a tab loaded
   * before that date, whose collector forwards the stored answer as it is.
   */
  const withAnswer = (value: string): unknown =>
    tampered({
      lists: [
        {
          ...LIST,
          items: [{ ...LIST.items[0], refinement: { speeds: "11", "pad-model": value } }],
        },
      ],
    });

  it("is refused whole, with nothing written and no attempt spent — from the first character over", async () => {
    for (const length of [MAX_REFINEMENT_VALUE_LENGTH + 1, 99, 120, 121, 138, 5000]) {
      expect(await importGuestStateAction(withAnswer("r".repeat(length))), String(length)).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
    // The visitor's three attempts are intact for the reload that brings the
    // collector which drops the answer instead of sending it.
    expect(fakeDb.rows("AuthAttempt")).toEqual([]);
  });

  it("is stored as sent when it is exactly at the cap", async () => {
    const atCap = "r".repeat(MAX_REFINEMENT_VALUE_LENGTH);
    expect((await importGuestStateAction(withAnswer(atCap))).ok).toBe(true);
    const [line] = fakeDb.rows("BuildListItem") as { refinement: Record<string, string> }[];
    expect(line.refinement).toEqual({ speeds: "11", "pad-model": atCap });
  });
});

describe("a refinement answer under a key the account's own action refuses", () => {
  /**
   * `setBuildListItemRefinementAction` has always refused `constructor` and
   * `prototype` by name (`tests/security/build-list-actions.test.ts`); the
   * import's contract held a key to the catalogue's shape alone, which both
   * pass. So the import was a second way into the same `Json` column that
   * took what the first refuses — and a line imported that way could never be
   * edited again, the list's form sending back the whole refinement it was
   * given. One definition of a key now (`isRefinementKey`,
   * `lib/shop/refinement.ts`), asked by both.
   */
  const withKey = (json: string): unknown =>
    tampered({
      lists: [
        {
          ...LIST,
          // `JSON.parse`, so the name is an OWN key — an object literal would
          // name the constructor instead, and prove nothing.
          items: [{ ...LIST.items[0], refinement: JSON.parse(json) as Record<string, string> }],
        },
      ],
    });

  it("is refused whole, with nothing written and no attempt spent", async () => {
    for (const name of ["constructor", "prototype"]) {
      const payload = withKey(`{"${name}":"x","speeds":"11"}`);
      const sent = (payload as { bikes: { lists: { items: { refinement: object }[] }[] }[] })
        .bikes[0].lists[0].items[0].refinement;
      expect(Object.keys(sent), name).toEqual([name, "speeds"]);
      expect(await importGuestStateAction(payload), name).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
    expect(fakeDb.rows("AuthAttempt")).toEqual([]);
  });

  it("never stores an own `__proto__` key either: the record drops it (zod 4 behaviour)", async () => {
    // Verified against the installed zod (4.5.4, and 4.6.6 on 2026-10-24): a
    // record SKIPS an own `__proto__` key instead of failing on it, in
    // `zod/mini` as in classic zod (`tests/integration/build-lists.test.ts`
    // pins the same for the action). The end state is what matters — the key
    // never reaches the column — so it is asserted rather than forced into a
    // refusal.
    const payload = withKey('{"__proto__":"x","speeds":"11"}');
    const sent = (payload as { bikes: { lists: { items: { refinement: object }[] }[] }[] }).bikes[0]
      .lists[0].items[0].refinement;
    expect(Object.hasOwn(sent, "__proto__")).toBe(true);

    expect((await importGuestStateAction(payload)).ok).toBe(true);
    const [line] = fakeDb.rows("BuildListItem") as { refinement: Record<string, unknown> }[];
    expect(line.refinement).toEqual({ speeds: "11" });
    expect(Object.hasOwn(line.refinement, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(line.refinement)).toBe(Object.prototype);
  });

  it("takes every key the account's action takes that fits its own 40 characters", async () => {
    const result = await importGuestStateAction(
      withKey(`{"constructor-type":"x","${"k".repeat(40)}":"y","speeds":"11"}`),
    );
    expect(result.ok).toBe(true);
    const [line] = fakeDb.rows("BuildListItem") as { refinement: Record<string, string> }[];
    expect(line.refinement).toEqual({
      "constructor-type": "x",
      ["k".repeat(40)]: "y",
      speeds: "11",
    });
  });
});

describe("a payload in the shape of before 2026-10-07", () => {
  /** What the old collector could have sent, had it ever read a checkup. */
  const OLD_CHECKUP = {
    guestKey: CHECKUP_ID,
    scope: "parts",
    startedAt: "2026-09-14T08:00:00.000Z",
    completedAt: "2026-09-14T08:20:00.000Z",
    items: [{ stepKey: CHAIN, partId: "chain", guideSlug: "check-drivetrain", result: "ko" }],
  };

  it("is a clean VALIDATION, version 1 or not, and writes nothing", async () => {
    const payloads: [string, unknown][] = [
      // What an old tab REALLY sends: its collector read no checkup at all.
      // Accepting this would import the bike, and that tab would then clear
      // the checkup it never sent.
      ["v1, no checkup", { ...(tampered({ checkups: [] }) as object), version: 1 }],
      ["v1, old checkup", { ...(tampered({ checkups: [OLD_CHECKUP] }) as object), version: 1 }],
      ["v2, old checkup", tampered({ checkups: [OLD_CHECKUP] })],
      ["no version", { bikes: [bike({ checkups: [] })] }],
    ];
    for (const [name, payload] of payloads) {
      expect(await importGuestStateAction(payload), name).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expectNoWrites();
    // …and the visitor's three attempts are intact for the reload that follows.
    expect(fakeDb.rows("AuthAttempt")).toEqual([]);
  });
});

describe("importing the same browser twice", () => {
  it("is one bike and one checkup, and the second call writes nothing at all (§6.8 AC8)", async () => {
    const first = await importGuestStateAction(state(bike()));
    expect(first.ok && first.data.imported).toBe(1);
    const before = Object.fromEntries(TABLES.map((table) => [table, fakeDb.rows(table)]));
    expect(before.Checkup).toHaveLength(1);
    fakeDb.resetCalls();

    // The other device's older copy of the bike — its checkup as it was imported.
    const older = bike({ name: "Vieille copie", updatedAt: "2026-01-01T00:00:00.000Z" });
    const second = await importGuestStateAction(state(older));

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data).toMatchObject({
      imported: 0,
      skipped: 1,
      bikeId: (before.Bike[0] as { id: string }).id,
    });
    expect(second.data.bikes[0].skipped).toBe("already-imported");
    // The account holds that checkup, answer for answer.
    expect(second.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "already-imported" },
    ]);
    expect(Object.fromEntries(TABLES.map((table) => [table, fakeDb.rows(table)]))).toEqual(before);
    const writes = fakeDb.calls.filter(
      (call) => call.model !== "authAttempt" && !/^(find|count)/.test(call.op),
    );
    expect(writes).toEqual([]);
    expectScopedToUser(fakeDb.calls, me.id);
  });

  it("does not call `already-imported` a checkup whose content the account does not hold, same id or not", async () => {
    expect((await importGuestStateAction(state(bike()))).ok).toBe(true);
    const before = Object.fromEntries(TABLES.map((table) => [table, fakeDb.rows(table)]));
    fakeDb.resetCalls();

    // The same ids, different content: the chain is now said to be fine.
    const differing = bike({ name: "Vieille copie", updatedAt: "2026-01-01T00:00:00.000Z" });
    differing.checkups[0].answers = { [CHAIN]: "ok", [CASSETTE]: "ok" };
    differing.checkups[0].symptoms = {};
    const second = await importGuestStateAction(state(differing));

    // Until 2026-10-09 the id was enough, the browser was told the account
    // had it, and cleared the only copy of what it said.
    expect(second.ok && second.data.bikes[0]).toMatchObject({
      skipped: "already-imported",
      checkups: [{ guestKey: CHECKUP_ID, status: "skipped", reason: "bike-already-imported" }],
    });
    // Still not one write (§6.8 AC8), and every read is the caller's own.
    expect(Object.fromEntries(TABLES.map((table) => [table, fakeDb.rows(table)]))).toEqual(before);
    expect(
      fakeDb.calls.filter((call) => call.model !== "authAttempt" && !/^(find|count)/.test(call.op)),
    ).toEqual([]);
    expectScopedToUser(fakeDb.calls, me.id);
  });

  it("does not take another account's row under the same checkup id for this account's", async () => {
    // A shared browser: the neighbour imported this very bike and checkup.
    setSession(sessionFor(other));
    expect((await importGuestStateAction(state(bike()))).ok).toBe(true);
    // Mine holds the bike WITHOUT the checkup.
    setSession(sessionFor(me));
    expect((await importGuestStateAction(state(bike({ checkups: [] })))).ok).toBe(true);
    fakeDb.resetCalls();

    const again = await importGuestStateAction(state(bike()));
    // The neighbour's row is not evidence that MY account has it.
    expect(again.ok && again.data.bikes[0].checkups).toEqual([
      { guestKey: CHECKUP_ID, status: "skipped", reason: "bike-already-imported" },
    ]);
    expectScopedToUser(fakeDb.calls, me.id);
  });

  it("says a checkup the account does not hold was NOT imported with the skipped bike", async () => {
    await importGuestStateAction(state(bike({ checkups: [] })));
    fakeDb.resetCalls();

    const second = await importGuestStateAction(state(bike()));
    expect(second.ok && second.data.bikes[0]).toMatchObject({
      skipped: "already-imported",
      checkups: [{ guestKey: CHECKUP_ID, status: "skipped", reason: "bike-already-imported" }],
    });
    expect(fakeDb.rows("Checkup")).toEqual([]);
    expectScopedToUser(fakeDb.calls, me.id);
  });
});

describe("the rate limit", () => {
  it("allows three imports an hour per user and refuses the fourth", async () => {
    expect(RATE_LIMITS.guestImportPerUser).toEqual({ max: 3, windowMs: 60 * 60_000 });

    for (let index = 0; index < RATE_LIMITS.guestImportPerUser.max; index++) {
      const result = await importGuestStateAction(
        state(bike({ localId: `2222222${index}-2222-4333-8444-555555555555`, checkups: [] })),
      );
      expect(result.ok, `import ${index + 1}`).toBe(true);
    }

    const refused = await importGuestStateAction(
      state(bike({ localId: "33333333-2222-4333-8444-555555555555" })),
    );
    expect(refused).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(refused.ok === false && refused.retryAfterSec).toBeGreaterThan(0);
    expect(fakeDb.rows("Bike")).toHaveLength(RATE_LIMITS.guestImportPerUser.max);
  });

  it("counts per user: a neighbour who spent their three does not spend mine", async () => {
    setSession(sessionFor(other));
    for (let index = 0; index < RATE_LIMITS.guestImportPerUser.max + 1; index++) {
      await importGuestStateAction(
        state(bike({ localId: `4444444${index}-2222-4333-8444-555555555555`, checkups: [] })),
      );
    }

    setSession(sessionFor(me));
    expect((await importGuestStateAction(state(bike()))).ok).toBe(true);
  });

  it("is not spent by an empty browser, nor by a payload that never validated", async () => {
    for (let index = 0; index < 10; index++) {
      await importGuestStateAction({ version: GUEST_STATE_VERSION, bikes: [] });
      await importGuestStateAction(tampered({ userId: "x" }));
    }
    expect(fakeDb.rows("AuthAttempt")).toEqual([]);
    expect((await importGuestStateAction(state(bike()))).ok).toBe(true);
  });
});

describe("the visitor's clock", () => {
  it("cannot store a checkup — or a bike — that happens in 2087", async () => {
    const before = Date.now();
    // The bike's own `updatedAt` is in the future too: with the fixture's
    // 2026-09-14 the assertion on it below could not fail, clamp or no clamp.
    const future = bike({ updatedAt: "2087-01-03T00:00:00.000Z" });
    future.checkups[0].startedAt = "2087-01-01T00:00:00.000Z";
    future.checkups[0].completedAt = "2087-01-02T00:00:00.000Z";
    const result = await importGuestStateAction(state(future));
    expect(result.ok).toBe(true);

    const [checkup] = fakeDb.rows("Checkup") as { startedAt: Date; completedAt: Date }[];
    expect(checkup.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(checkup.startedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(checkup.completedAt.getTime()).toBeLessThanOrEqual(Date.now());
    // The part it declares fine was serviced no later than now either.
    const cassette = (
      fakeDb.rows("BikePartState") as { partId: string; lastServicedAt: Date | null }[]
    ).find((row) => row.partId === "cassette");
    expect(cassette?.lastServicedAt?.getTime()).toBeLessThanOrEqual(Date.now());

    const [row] = fakeDb.rows("Bike") as { updatedAt: Date }[];
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.updatedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
