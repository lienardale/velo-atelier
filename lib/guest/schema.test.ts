/**
 * The guest-import payload: what this browser offers, what the server will
 * take, and what the browser may forget afterwards.
 *
 * Three halves, and the seams between them are the point:
 *
 *   `collectGuestState` reads three storage keys written by three other modules
 *   and projects them onto one contract;
 *   `GuestStateSchema` is the only thing the server trusts;
 *   `settleGuestImport` turns the server's answer into the keys to clear.
 *
 * So the load-bearing test here is the ROUND TRIP — everything the collector
 * can produce must parse, and what it collects must be what the WIZARD wrote.
 * That second half is the one this file did not have until 2026-10-07: its
 * checkup fixture was a hand-written `CheckupState` with `steps`, a shape
 * nothing has stored since W3, so the collector could drop every real checkup
 * with every test green (`.debug/017` §5.6). Every fixture below is now made
 * by `tests/_helpers/guest-work.ts`: the real plan, the real reducer,
 * `toStored`, `writeStoredCheckup`, `writeGuestBuildList`.
 */
/* eslint-disable security/detect-object-injection -- step keys and record names the test spells out, into its own fresh clones */
import { describe, expect, it } from "vitest";

import { buildListKey, checkupKey, LOCAL_BIKE_KEY } from "@/lib/bike/storage-keys";
import { deriveBuildList } from "@/lib/checkup/build-list";
import { MAX_NOTE_LENGTH, MAX_SYMPTOMS } from "@/lib/checkup/reducer";
import { readStoredCheckup, toStored, writeStoredCheckup } from "@/lib/checkup/storage";
import { CHECKUP_STATE_VERSION } from "@/lib/checkup/types";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import {
  GUEST_NAMES,
  guestRun,
  guestWork,
  memoryStorage,
  partsScope,
} from "@/tests/_helpers/guest-work";

import {
  clearGuestKeys,
  collectGuestState,
  GUEST_CAPS,
  GUEST_STATE_VERSION,
  guestImportKeys,
  guestStateBytes,
  isEmptyGuestState,
  MAX_GUEST_PAYLOAD_BYTES,
  parseGuestState,
  settleGuestImport,
  withinGuestPayloadBudget,
  type GuestBikeImport,
  type GuestCollection,
  type GuestImportSummary,
  type GuestState,
} from "./schema";

// ── fixtures (module scope: the part catalogue and the corpus are not cheap,
// and the unit tier's testTimeout is 5 s on a CI runner ~3x slower than this
// laptop) ────────────────────────────────────────────────────────────────────

const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
const CHAIN = "check-drivetrain#chain-wear";
const CASSETTE = "check-drivetrain#cassette-teeth";
const STARTED_AT = "2026-09-10T08:00:00.000Z";
const COMPLETED_AT = "2026-09-10T08:12:00.000Z";

/** A finished partial checkup: the chain is worn (with a note), the cassette is fine. */
const work = guestWork({
  answers: BIKE_PRESETS["gravel-1x11"],
  fit: { saddleHeightMm: 742 },
  checkup: (build) =>
    guestRun({
      id: CHECKUP_ID,
      build,
      scope: partsScope("chain", "cassette"),
      verdicts: {
        [CHAIN]: { ko: ["chain-elongation"], notes: "élongation 0,8 %" },
        [CASSETTE]: "ok",
      },
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
    }),
});
const LOCAL_BIKE_RAW = work.storage.map.get(LOCAL_BIKE_KEY) as string;
const CHECKUP_RAW = work.storage.map.get(checkupKey("local")) as string;
const LIST_RAW = work.storage.map.get(buildListKey("local")) as string;

const collection = work.collect();
const collected = collection.state;

/** The payload, as it arrives: a JSON round trip away from the collector's objects. */
function payload(): GuestState {
  return JSON.parse(JSON.stringify(collected)) as GuestState;
}

/** A storage holding the bike and whatever the test puts under the checkup key. */
function storageWithCheckup(raw: string | null) {
  return memoryStorage({
    [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
    ...(raw === null ? {} : { [checkupKey("local")]: raw }),
  });
}

const collect = (storage: ReturnType<typeof memoryStorage> | null): GuestCollection =>
  collectGuestState({ storage, ...GUEST_NAMES });

// ── the collector ────────────────────────────────────────────────────────────

describe("collectGuestState", () => {
  it("returns an empty state when this browser holds nothing", () => {
    const { state, checkup } = collect(memoryStorage());
    expect(state).toEqual({ version: GUEST_STATE_VERSION, bikes: [] });
    expect(checkup).toBe("absent");
    expect(isEmptyGuestState(state)).toBe(true);
  });

  it("returns an empty state where storage cannot be reached at all", () => {
    expect(collect(null).state.bikes).toEqual([]);
  });

  it("carries the guest bike's own id, so the import can recognise it later", () => {
    expect(collected.bikes).toHaveLength(1);
    expect(collected.bikes[0].localId).toBe(work.bike.id);
    expect(collected.bikes[0].updatedAt).toBe(work.bike.updatedAt);
    expect(collected.bikes[0].fit).toEqual({ saddleHeightMm: 742 });
    expect(isEmptyGuestState(collected)).toBe(false);
  });

  it("names the bike in the visitor's language — the guest bike has no name", () => {
    expect(collected.bikes[0].name).toBe(GUEST_NAMES.bikeName);
  });

  it("reads the checkup the wizard really stores — toStored, under the real key", () => {
    // THE test that was missing. What is under the key has no `steps` and no
    // `cursor`, because that is what `toStored` writes…
    const stored = JSON.parse(CHECKUP_RAW) as Record<string, unknown>;
    expect(stored).toEqual(JSON.parse(JSON.stringify(toStored(work.checkup!))));
    expect(stored).not.toHaveProperty("steps");
    expect(stored).not.toHaveProperty("cursor");

    // …and the collector reads it: the checkup is IN the payload, as answers.
    expect(collection.checkup).toBe("collected");
    expect(collected.bikes[0].checkups).toEqual([
      {
        guestKey: CHECKUP_ID,
        scope: { kind: "parts", partIds: ["chain", "cassette"] },
        answers: { [CHAIN]: "ko", [CASSETTE]: "ok" },
        symptoms: { [CHAIN]: ["chain-elongation"] },
        notes: { [CHAIN]: "élongation 0,8 %" },
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
      },
    ]);
    // …which the server's schema accepts, with the checkup still there.
    const parsed = parseGuestState(payload());
    expect(parsed.ok && parsed.state.bikes[0].checkups).toHaveLength(1);
  });

  it("carries no step, no part and no guide for an answer — the server plans (§5.4)", () => {
    const [checkup] = collected.bikes[0].checkups;
    expect(Object.keys(checkup).sort()).toEqual(
      ["answers", "completedAt", "guestKey", "notes", "scope", "startedAt", "symptoms"].sort(),
    );
    expect(JSON.stringify(checkup)).not.toContain("guideSlug");
    expect(JSON.stringify(checkup)).not.toContain('partId"');
  });

  it("carries a full checkup's scope as full, and an unfinished one without an end", () => {
    const running = guestWork({
      answers: BIKE_PRESETS["gravel-1x11"],
      checkup: (build) =>
        guestRun({
          id: CHECKUP_ID,
          build,
          scope: { kind: "full" },
          verdicts: { [CHAIN]: "ok" },
          startedAt: STARTED_AT,
        }),
    }).collect();
    const [checkup] = running.state.bikes[0].checkups;
    expect(checkup.scope).toEqual({ kind: "full" });
    expect(checkup).not.toHaveProperty("completedAt");
    expect(parseGuestState(JSON.parse(JSON.stringify(running.state))).ok).toBe(true);
  });

  it("ignores the demo bike's checkup — there is no row to attach it to", () => {
    const storage = memoryStorage({ [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW });
    expect(writeStoredCheckup("demo", toStored(work.checkup!), storage)).toBe(true);
    const { state, checkup } = collect(storage);
    expect(state.bikes[0].checkups).toEqual([]);
    expect(checkup).toBe("absent");
    expect(guestImportKeys()).toEqual([LOCAL_BIKE_KEY, checkupKey("local"), buildListKey("local")]);
  });

  it("reports a checkup it cannot read, and does NOT remove it", () => {
    // Not JSON; JSON the wizard's schema refuses; a version this build does not
    // know; and the pre-W3 shape, which is not what the wizard writes either.
    const unreadable = [
      "{not json",
      JSON.stringify({ version: 1, id: "not-a-uuid" }),
      JSON.stringify({ ...toStored(work.checkup!), version: CHECKUP_STATE_VERSION + 1 }),
      JSON.stringify({ id: CHECKUP_ID, steps: [], cursor: 0, answers: {} }),
    ];
    for (const raw of unreadable) {
      const storage = storageWithCheckup(raw);
      const { state, checkup } = collect(storage);
      expect(checkup, raw).toBe("unreadable");
      // Not half-read: nothing of it is in the payload…
      expect(state.bikes[0].checkups).toEqual([]);
      // …and the key is exactly as it was. The wizard's own read
      // (`readStoredCheckup`) removes such a value; the import must not.
      expect(storage.map.get(checkupKey("local"))).toBe(raw);
    }
  });

  it("is the read that differs from the wizard's: readStoredCheckup removes the same value", () => {
    const storage = storageWithCheckup("{not json");
    expect(readStoredCheckup("local", storage)).toBeNull();
    expect(storage.map.has(checkupKey("local"))).toBe(false);
  });

  it("does not send a checkup nobody answered — an empty row would show as history", () => {
    const storage = storageWithCheckup(
      JSON.stringify({ ...toStored(work.checkup!), answers: {}, symptoms: {}, notes: {} }),
    );
    const { state, checkup } = collect(storage);
    expect(checkup).toBe("empty");
    expect(state.bikes[0].checkups).toEqual([]);
  });

  it("reports unreadable a checkup the contract would refuse, instead of sinking the bike", () => {
    // The wizard's guard puts no ceiling on the number of answers; the contract
    // does. Sent as is, this checkup would make the server refuse the WHOLE
    // payload — the bike with it, import after import.
    const answers = Object.fromEntries(
      Array.from({ length: GUEST_CAPS.answersPerCheckup + 1 }, (_, index) => [
        `check-drivetrain#step-${index}`,
        "ok",
      ]),
    );
    const raw = JSON.stringify({ ...toStored(work.checkup!), answers });
    const storage = storageWithCheckup(raw);
    const { state, checkup } = collect(storage);
    expect(checkup).toBe("unreadable");
    expect(state.bikes[0].checkups).toEqual([]);
    expect(storage.map.get(checkupKey("local"))).toBe(raw);
    expect(parseGuestState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
  });

  it("reads what writeGuestBuildList actually writes, named in the visitor's language", () => {
    // The producer, not a hand-built shape: `guestWork` wrote the list the way
    // "Créer ma liste" does, so this fails if the envelope moves.
    const envelope = JSON.parse(LIST_RAW) as { checkupId: string; items: unknown[] };
    expect(envelope.checkupId).toBe(CHECKUP_ID);
    expect(envelope.items).toEqual(deriveBuildList(work.checkup!));

    expect(collected.bikes[0].lists).toEqual([
      {
        // The envelope carries no name, so the list takes the caller's.
        name: GUEST_NAMES.listName,
        items: [
          {
            partId: "chain",
            action: "replace",
            reasonKey: "chain-elongation",
            guideSlug: "replace-chain",
            done: false,
            sortOrder: 0,
          },
        ],
      },
    ]);
  });

  it("survives a storage that throws on every read", () => {
    const throwing = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(collect(throwing).state.bikes).toEqual([]);
  });

  it("keeps the bike when only the checkup and list keys are unreadable", () => {
    // A quota error part-way through a read is one key failing, not all three.
    const partly = {
      ...memoryStorage(),
      getItem: (key: string) => {
        if (key === LOCAL_BIKE_KEY) return LOCAL_BIKE_RAW;
        throw new Error("blocked");
      },
    };
    const { state, checkup } = collect(partly);
    expect(state.bikes[0].localId).toBe(work.bike.id);
    expect(state.bikes[0].checkups).toEqual([]);
    expect(state.bikes[0].lists).toEqual([]);
    // A read that threw proves nothing about the key: it is not "absent".
    expect(checkup).toBe("unreadable");
  });

  it("has nothing to read on a server, where there is no window", () => {
    // `collectGuestState` is called from a client component, but the module is
    // imported by the action too: the default storage must not throw in Node.
    expect(collectGuestState({ ...GUEST_NAMES }).state.bikes).toEqual([]);
  });

  it("names an unnamed (or blank-named) list in the visitor's language", () => {
    const items = (JSON.parse(LIST_RAW) as { items: unknown[] }).items;
    for (const stored of [{ items }, { name: "   ", items }, { name: "Révision", items }]) {
      const storage = memoryStorage({
        [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
        [buildListKey("local")]: JSON.stringify(stored),
      });
      const [list] = collect(storage).state.bikes[0].lists;
      expect(list.name).toBe(stored.name === "Révision" ? "Révision" : GUEST_NAMES.listName);
    }
  });

  it("drops an empty list, and defaults the item fields the envelope may omit", () => {
    const empty = memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [buildListKey("local")]: JSON.stringify({ name: "Vide", items: [] }),
    });
    expect(collect(empty).state.bikes[0].lists).toEqual([]);

    // `done` and `sortOrder` are optional in the stored item: a list written by
    // an older build, or hand-edited, still imports with the defaults.
    const sparse = memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [buildListKey("local")]: JSON.stringify({
        items: [{ partId: "chain", action: "replace", reasonKey: "chain-elongation" }],
      }),
    });
    const [list] = collect(sparse).state.bikes[0].lists;
    expect(list.items[0]).toEqual({
      partId: "chain",
      action: "replace",
      reasonKey: "chain-elongation",
      done: false,
      sortOrder: 0,
    });
  });
});

// ── the contract ─────────────────────────────────────────────────────────────

describe("GuestStateSchema", () => {
  it("accepts everything the collector can produce", () => {
    expect(parseGuestState(payload()).ok).toBe(true);
  });

  it("refuses a key the contract does not name (mass assignment)", () => {
    for (const extra of ["id", "userId", "spec", "createdAt", "specVersion"]) {
      const tampered = payload() as unknown as { bikes: Record<string, unknown>[] };
      tampered.bikes[0][extra] = "x";
      expect(parseGuestState(tampered).ok, extra).toBe(false);
    }
  });

  it("refuses an extra key at every level of a checkup", () => {
    const breakers: ((checkup: Record<string, unknown>) => void)[] = [
      (checkup) => (checkup.bikeId = "x"),
      (checkup) => (checkup.status = "COMPLETED"),
      (checkup) => (checkup.steps = []),
      (checkup) => (checkup.items = []),
      (checkup) => ((checkup.scope as Record<string, unknown>).userId = "x"),
      (checkup) => (checkup.scope = { kind: "full", partIds: ["chain"] }),
    ];
    for (const [index, tamper] of breakers.entries()) {
      const tampered = payload();
      tamper(tampered.bikes[0].checkups[0] as unknown as Record<string, unknown>);
      expect(parseGuestState(tampered).ok, `breaker ${index}`).toBe(false);
    }
  });

  it("refuses a version it was not written for — version 1 included", () => {
    expect(GUEST_STATE_VERSION).toBe(2);
    expect(parseGuestState({ version: 3, bikes: [] }).ok).toBe(false);
    expect(parseGuestState({ bikes: [] }).ok).toBe(false);
    expect(parseGuestState(null).ok).toBe(false);
    expect(parseGuestState("{}").ok).toBe(false);
    // What a tab loaded before 2026-10-07 sends: version 1, and — because its
    // collector read no real checkup — `checkups: []`, which is otherwise a
    // perfectly valid bike. Accepting it would import the bike and let that
    // old tab clear the checkup it never sent.
    expect(parseGuestState({ ...payload(), version: 1 }).ok).toBe(false);
    const old = payload();
    old.bikes[0].checkups = [];
    expect(parseGuestState({ ...old, version: 1 }).ok).toBe(false);
    expect(parseGuestState(old).ok).toBe(true);
  });

  it("refuses the old shape of a checkup, whatever version it claims", () => {
    const old = payload() as unknown as { bikes: { checkups: unknown[] }[] };
    old.bikes[0].checkups = [
      {
        guestKey: CHECKUP_ID,
        scope: "parts",
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
        items: [{ stepKey: CHAIN, partId: "chain", guideSlug: "check-drivetrain", result: "ko" }],
      },
    ];
    expect(parseGuestState(old).ok).toBe(false);
  });

  it("refuses an answer to a question this site never asked", () => {
    const tampered = payload();
    (tampered.bikes[0].answers as Record<string, string>)["not-a-question"] = "x";
    expect(parseGuestState(tampered).ok).toBe(false);
  });

  it("refuses a step key, a part id or a reason key that is not an id", () => {
    const bad = ["../../etc/passwd", "check/../x#y", "Check-Drivetrain#chain-wear", "no-hash"];
    for (const key of bad) {
      for (const record of ["answers", "symptoms", "notes"] as const) {
        const tampered = payload();
        const value = record === "answers" ? "ok" : record === "symptoms" ? [] : "x";
        (tampered.bikes[0].checkups[0][record] as Record<string, unknown>)[key] = value;
        expect(parseGuestState(tampered).ok, `${record}: ${key}`).toBe(false);
      }
    }
    for (const reason of ["<script>", "Chain-Elongation", "a/../b"]) {
      const tampered = payload();
      tampered.bikes[0].checkups[0].symptoms[CHAIN] = [reason];
      expect(parseGuestState(tampered).ok, reason).toBe(false);
    }
    for (const partId of ["../chain", "Chain", ""]) {
      const tampered = payload();
      tampered.bikes[0].checkups[0].scope = { kind: "parts", partIds: [partId] };
      expect(parseGuestState(tampered).ok, partId).toBe(false);
    }
  });

  it("holds every id to the database's length", () => {
    const accepts = (mutate: (state: GuestState) => void): boolean => {
      const tampered = payload();
      mutate(tampered);
      return parseGuestState(tampered).ok;
    };
    // `CheckupItem.stepKey` is VarChar(160): 95 + "#" + 64.
    const longest = `${"a".repeat(95)}#${"b".repeat(64)}`;
    expect(longest).toHaveLength(160);
    expect(accepts((s) => (s.bikes[0].checkups[0].answers[longest] = "ok"))).toBe(true);
    expect(accepts((s) => (s.bikes[0].checkups[0].answers[`a${longest}`] = "ok"))).toBe(false);
    expect(accepts((s) => (s.bikes[0].checkups[0].answers[`${longest}b`] = "ok"))).toBe(false);
    // `CheckupItem.reasonKeys` is VarChar(80)[].
    expect(accepts((s) => (s.bikes[0].checkups[0].symptoms[CHAIN] = ["r".repeat(80)]))).toBe(true);
    expect(accepts((s) => (s.bikes[0].checkups[0].symptoms[CHAIN] = ["r".repeat(81)]))).toBe(false);
    // `BikePartState.partId` is VarChar(64).
    const scope = (partId: string) => (s: GuestState) =>
      (s.bikes[0].checkups[0].scope = { kind: "parts", partIds: [partId] });
    expect(accepts(scope("p".repeat(64)))).toBe(true);
    expect(accepts(scope("p".repeat(65)))).toBe(false);
    // `CheckupItem.notes` is VarChar(2000).
    expect(MAX_NOTE_LENGTH).toBe(2000);
    expect(accepts((s) => (s.bikes[0].checkups[0].notes[CHAIN] = "n".repeat(2000)))).toBe(true);
    expect(accepts((s) => (s.bikes[0].checkups[0].notes[CHAIN] = "n".repeat(2001)))).toBe(false);
  });

  it("refuses a verdict that is not one of the three", () => {
    const tampered = payload() as unknown as {
      bikes: { checkups: { answers: Record<string, string> }[] }[];
    };
    tampered.bikes[0].checkups[0].answers[CHAIN] = "BROKEN";
    expect(parseGuestState(tampered).ok).toBe(false);
  });

  it("refuses a chosen product whose link is not plain https", () => {
    const product = { brand: "Shimano", model: "CN-HG601", size: "11v", vendor: "alltricks" };
    for (const url of [
      "javascript:alert(1)",
      "http://alltricks.fr/x",
      "data:text/html,x",
      "https://user:pass@alltricks.fr/x",
      "not a url",
    ]) {
      const tampered = payload();
      tampered.bikes[0].lists[0].items[0].chosenProduct = { ...product, url };
      expect(parseGuestState(tampered).ok, url).toBe(false);
    }

    const good = payload();
    good.bikes[0].lists[0].items[0].chosenProduct = {
      ...product,
      url: "https://www.alltricks.fr/chaine",
    };
    expect(parseGuestState(good).ok).toBe(true);
  });

  it("refuses more than the caps §4.4 names", () => {
    const one = collected.bikes[0];
    const version = GUEST_STATE_VERSION;
    expect(parseGuestState({ version, bikes: Array(GUEST_CAPS.bikes).fill(one) }).ok).toBe(true);
    expect(parseGuestState({ version, bikes: Array(GUEST_CAPS.bikes + 1).fill(one) }).ok).toBe(
      false,
    );

    const over = (patch: Partial<typeof one>) =>
      parseGuestState({ version, bikes: [{ ...one, ...patch }] }).ok;
    expect(over({ parts: Array(GUEST_CAPS.partsPerBike + 1).fill({}) })).toBe(false);
    expect(over({ checkups: Array(GUEST_CAPS.checkupsPerBike).fill(one.checkups[0]) })).toBe(true);
    expect(over({ checkups: Array(GUEST_CAPS.checkupsPerBike + 1).fill(one.checkups[0]) })).toBe(
      false,
    );
    expect(over({ lists: Array(GUEST_CAPS.listsPerBike + 1).fill(one.lists[0]) })).toBe(false);
  });

  it("caps every record and every array of a checkup, not only the arrays", () => {
    const [checkup] = collected.bikes[0].checkups;
    const accepts = (patch: Partial<typeof checkup>) =>
      parseGuestState({
        version: GUEST_STATE_VERSION,
        bikes: [{ ...collected.bikes[0], checkups: [{ ...checkup, ...patch }] }],
      }).ok;
    const keyed = <T>(count: number, value: T): Record<string, T> =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`check-drivetrain#step-${index}`, value]),
      );
    const cap = GUEST_CAPS.answersPerCheckup;
    expect(cap).toBe(250);

    expect(accepts({ answers: keyed(cap, "ok" as const) })).toBe(true);
    expect(accepts({ answers: keyed(cap + 1, "ok" as const) })).toBe(false);
    expect(accepts({ symptoms: keyed(cap, ["chain-elongation"]) })).toBe(true);
    expect(accepts({ symptoms: keyed(cap + 1, ["chain-elongation"]) })).toBe(false);
    expect(accepts({ notes: keyed(cap, "x") })).toBe(true);
    expect(accepts({ notes: keyed(cap + 1, "x") })).toBe(false);

    // Symptoms per step: the wizard's own bound.
    expect(GUEST_CAPS.symptomsPerStep).toBe(MAX_SYMPTOMS);
    const reasons = (count: number) => Array.from({ length: count }, (_, i) => `reason-${i}`);
    expect(accepts({ symptoms: { [CHAIN]: reasons(GUEST_CAPS.symptomsPerStep) } })).toBe(true);
    expect(accepts({ symptoms: { [CHAIN]: reasons(GUEST_CAPS.symptomsPerStep + 1) } })).toBe(false);

    // The parts a partial checkup names: no more than a build can hold.
    const parts = (count: number) => ({
      kind: "parts" as const,
      partIds: Array.from({ length: count }, (_, i) => `part-${i}`),
    });
    expect(accepts({ scope: parts(GUEST_CAPS.scopeParts) })).toBe(true);
    expect(accepts({ scope: parts(GUEST_CAPS.scopeParts + 1) })).toBe(false);
  });

  it("is answered by the byte budget when a checkup is filled to every cap at once", () => {
    // Every cap at once, with the longest ids and notes the patterns allow, is
    // far over 256 KB — so the byte budget, not a walk of the payload, is what
    // answers an import built to be as large as the schema permits.
    const key = (index: number) =>
      `${"a".repeat(90)}-${String(index).padStart(4, "0")}#${"b".repeat(64)}`;
    const notes = Object.fromEntries(
      Array.from({ length: GUEST_CAPS.answersPerCheckup }, (_, i) => [key(i), "n".repeat(2000)]),
    );
    const huge = payload();
    huge.bikes[0].checkups[0].notes = notes;
    expect(parseGuestState(huge).ok).toBe(true);
    expect(withinGuestPayloadBudget(huge)).toBe(false);
  });
});

// ── size ─────────────────────────────────────────────────────────────────────

describe("the payload budget", () => {
  it("is 256 KB, counted in UTF-8 bytes", () => {
    expect(MAX_GUEST_PAYLOAD_BYTES).toBe(256 * 1024);
    expect(guestStateBytes({ a: "🚲" })).toBeGreaterThan(guestStateBytes({ a: "b" }));
    expect(withinGuestPayloadBudget(collected)).toBe(true);
    expect(withinGuestPayloadBudget({ a: "x".repeat(MAX_GUEST_PAYLOAD_BYTES) })).toBe(false);
  });

  it("leaves a real guest bike, checkup and list far inside it", () => {
    expect(guestStateBytes(collected)).toBeLessThan(MAX_GUEST_PAYLOAD_BYTES / 4);
  });
});

// ── after the server answered ────────────────────────────────────────────────

describe("settleGuestImport", () => {
  const LOCAL = checkupKey("local");
  const BIKE_AND_LIST = [LOCAL_BIKE_KEY, buildListKey("local")];

  function summary(entry: Partial<GuestBikeImport> = {}): GuestImportSummary {
    const bike: GuestBikeImport = {
      localId: work.bike.id,
      bikeId: "00000000-0000-4000-8000-0000000000b1",
      checkups: [{ guestKey: CHECKUP_ID, status: "imported" }],
      ...entry,
    };
    return {
      bikeId: bike.bikeId,
      bikes: [bike],
      imported: bike.skipped === undefined ? 1 : 0,
      skipped: bike.skipped === undefined ? 0 : 1,
    };
  }

  it("lets the browser forget all three keys once the server imported the checkup", () => {
    expect(settleGuestImport(collection, summary())).toEqual({
      checkup: { status: "imported" },
      clear: [...BIKE_AND_LIST, LOCAL],
    });
  });

  it("treats a checkup the account already held like one it has just imported", () => {
    const settled = settleGuestImport(
      collection,
      summary({
        skipped: "already-imported",
        checkups: [{ guestKey: CHECKUP_ID, status: "already-imported" }],
      }),
    );
    expect(settled.checkup).toEqual({ status: "already-imported" });
    expect(settled.clear).toContain(LOCAL);
  });

  it("KEEPS the checkup key when the server wrote no row for it, and says why", () => {
    for (const reason of ["nothing-kept", "bike-already-imported"] as const) {
      const settled = settleGuestImport(
        collection,
        summary({ checkups: [{ guestKey: CHECKUP_ID, status: "skipped", reason }] }),
      );
      expect(settled.checkup).toEqual({ status: "skipped", reason });
      // The bike and the list are in the account; the checkup is not.
      expect(settled.clear).toEqual(BIKE_AND_LIST);
    }
  });

  it("KEEPS a checkup the browser could not read, whatever the server said", () => {
    const unreadable = collect(storageWithCheckup("{not json"));
    const settled = settleGuestImport(unreadable, summary({ checkups: [] }));
    expect(settled.checkup).toEqual({ status: "skipped", reason: "unreadable" });
    expect(settled.clear).toEqual(BIKE_AND_LIST);
  });

  it("KEEPS a checkup the answer does not name: nothing proves it is in the account", () => {
    const other = "00000000-0000-4000-8000-0000000000c9";
    for (const checkups of [[], [{ guestKey: other, status: "imported" as const }]]) {
      const settled = settleGuestImport(collection, summary({ checkups }));
      expect(settled.checkup).toEqual({ status: "skipped", reason: "unconfirmed" });
      expect(settled.clear).toEqual(BIKE_AND_LIST);
    }
  });

  it("clears a checkup nobody answered — there was provably nothing to import", () => {
    const empty = collect(
      storageWithCheckup(
        JSON.stringify({ ...toStored(work.checkup!), answers: {}, symptoms: {}, notes: {} }),
      ),
    );
    expect(settleGuestImport(empty, summary({ checkups: [] }))).toEqual({
      checkup: { status: "none" },
      clear: [...BIKE_AND_LIST, LOCAL],
    });
  });

  it("does not name a key that was absent when it was read", () => {
    // Nothing was there; a checkup another tab wrote since is not this
    // import's to remove.
    const absent = collect(storageWithCheckup(null));
    expect(settleGuestImport(absent, summary({ checkups: [] }))).toEqual({
      checkup: { status: "none" },
      clear: BIKE_AND_LIST,
    });
  });

  it("clears nothing at all when the answer does not name this browser's bike", () => {
    const elsewhere = summary({ localId: "99999999-2222-4333-8444-555555555555" });
    expect(settleGuestImport(collection, elsewhere).clear).toEqual([]);
    expect(
      settleGuestImport(collect(memoryStorage()), {
        bikeId: null,
        bikes: [],
        imported: 0,
        skipped: 0,
      }).clear,
    ).toEqual([]);
  });
});

// ── clearing ─────────────────────────────────────────────────────────────────

describe("clearGuestKeys", () => {
  const everything = () =>
    memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [checkupKey("local")]: CHECKUP_RAW,
      [buildListKey("local")]: LIST_RAW,
      [checkupKey("demo")]: "{}",
      "va:bike3d:quality": "high",
    });

  it("forgets exactly the keys it is given", () => {
    const storage = everything();
    clearGuestKeys([LOCAL_BIKE_KEY, buildListKey("local")], storage);
    expect([...storage.map.keys()].sort()).toEqual(
      ["va:bike3d:quality", checkupKey("demo"), checkupKey("local")].sort(),
    );
    // The checkup it was not told to forget is byte for byte what it was.
    expect(storage.map.get(checkupKey("local"))).toBe(CHECKUP_RAW);
  });

  it("forgets the local bike, its checkup and its list when all three are named", () => {
    const storage = everything();
    clearGuestKeys(guestImportKeys(), storage);
    expect([...storage.map.keys()].sort()).toEqual(["va:bike3d:quality", checkupKey("demo")]);
  });

  it("ignores a key that is not the guest import's to clear", () => {
    const storage = everything();
    clearGuestKeys([checkupKey("demo"), "va:bike3d:quality", "anything"], storage);
    expect(storage.map.size).toBe(5);
  });

  it("does nothing where storage cannot be reached, and swallows a storage that throws", () => {
    expect(() => clearGuestKeys(guestImportKeys(), null)).not.toThrow();
    expect(() =>
      clearGuestKeys(guestImportKeys(), {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});
