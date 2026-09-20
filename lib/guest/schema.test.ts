/**
 * The guest-import payload: what this browser offers, and what the server will
 * take.
 *
 * Two halves, and the seam between them is the point:
 *
 *   `collectGuestState` reads three storage keys written by three other modules
 *   and projects them onto one contract;
 *   `GuestStateSchema` is the only thing the server trusts.
 *
 * So the load-bearing test here is the ROUND TRIP — everything the collector
 * can produce must parse — plus the refusals, which are what a payload
 * assembled by something other than this collector runs into.
 *
 * `storedCheckup` is typed as `CheckupState` (W3-T1's committed contract) on
 * purpose: if that shape changes, this file stops compiling instead of quietly
 * collecting nothing.
 */
import { describe, expect, it } from "vitest";

import { writeLocalBike, type KeyValueStorage } from "@/lib/bike/local-bike";
import { buildListKey, checkupKey, LOCAL_BIKE_KEY } from "@/lib/bike/storage-keys";
import { writeGuestBuildList } from "@/lib/checkup/storage";
import { CHECKUP_STATE_VERSION, type BuildListItem, type CheckupState } from "@/lib/checkup/types";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { makeStep } from "@/tests/_helpers/checkup";

import {
  clearGuestState,
  collectGuestState,
  GUEST_CAPS,
  GUEST_STATE_VERSION,
  guestImportKeys,
  guestStateBytes,
  isEmptyGuestState,
  MAX_GUEST_PAYLOAD_BYTES,
  parseGuestState,
  withinGuestPayloadBudget,
  type GuestState,
} from "./schema";

// ── fixtures (module scope: the part catalogue is not cheap, and the unit
// tier's testTimeout is 5 s on a CI runner ~3x slower than this laptop) ──────

/** A `localStorage` stand-in: plain map, and a way to see what was removed. */
function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const CHECKUP_ID = "3f1d7a52-9c1e-4f2b-8d7a-0b4f2c6e1a90";
const NAMES = { bikeName: "Mon vélo", listName: "Ma liste" } as const;

const localBike = writeLocalBike(
  { answers: BIKE_PRESETS["gravel-1x11"], fit: { saddleHeightMm: 742 } },
  { storage: memoryStorage() },
);
if (localBike === null) throw new Error("writeLocalBike refused to write");
const LOCAL_BIKE_RAW = JSON.stringify(localBike);

const storedCheckup: CheckupState = {
  id: CHECKUP_ID,
  bikeRef: { kind: "local" },
  scope: { kind: "parts", partIds: ["chain"] },
  locale: "fr",
  // Built with W3-T1's shared `makeStep` rather than by hand: the planner owns
  // `CheckStepRef`, and it grew `title`, `prompt` and `number` between this
  // fixture being written and the wave being merged. What matters here is the
  // key, the slug and the parts — the fields the importer reads.
  steps: [
    makeStep({
      guideSlug: "check-drivetrain",
      stepId: "chain-wear",
      partIds: ["chain"],
      ko: [
        {
          action: "replace",
          partId: "chain",
          reasonKey: "chain-elongation",
          guideSlug: "replace-chain",
        },
      ],
    }),
    makeStep({
      guideSlug: "check-drivetrain",
      stepId: "cassette-teeth",
      partIds: ["cassette"],
      ko: [],
    }),
    // A step that reports on no part has no `CheckupItem` row to become.
    makeStep({
      guideSlug: "check-frame-bolts",
      stepId: "bolt-torque",
      partIds: [],
      ko: [],
    }),
  ],
  cursor: 3,
  answers: {
    "check-drivetrain#chain-wear": "ko",
    "check-drivetrain#cassette-teeth": "ok",
    "check-frame-bolts#bolt-torque": "ok",
    // A key the plan no longer holds: dropped rather than stored with no slug.
    "check-brakes-rim#pad-wear": "ok",
  },
  notes: { "check-drivetrain#chain-wear": "élongation 0,8 %" },
  // The symptom the visitor ticked on the KO. The importer does not read it —
  // `StoredCheckupSchema` is `z.object`, not `strictObject`, so it is dropped
  // rather than refused — and this fixture is here to keep that true.
  symptoms: { "check-drivetrain#chain-wear": ["chain-elongation"] },
  toolsMissing: [],
  startedAt: "2026-09-10T08:00:00.000Z",
  completedAt: "2026-09-10T08:12:00.000Z",
  contentVersion: "abc123",
  version: CHECKUP_STATE_VERSION,
};

const storedListItems: BuildListItem[] = [
  {
    id: "check-drivetrain#chain-wear|chain|replace",
    stepKey: "check-drivetrain#chain-wear",
    sourceKeys: ["check-drivetrain#chain-wear"],
    partId: "chain",
    action: "replace",
    reasonKey: "chain-elongation",
    guideSlug: "replace-chain",
    done: false,
    sortOrder: 0,
  },
];

function storageWithEverything(): KeyValueStorage {
  return memoryStorage({
    [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
    [checkupKey("local")]: JSON.stringify(storedCheckup),
    [buildListKey("local")]: JSON.stringify({ name: "Révision", items: storedListItems }),
    [checkupKey("demo")]: JSON.stringify({ ...storedCheckup, bikeRef: { kind: "demo" } }),
  });
}

const collected = collectGuestState({ storage: storageWithEverything(), ...NAMES });

// ── the collector ────────────────────────────────────────────────────────────

describe("collectGuestState", () => {
  it("returns an empty state when this browser holds nothing", () => {
    const state = collectGuestState({ storage: memoryStorage(), ...NAMES });
    expect(state).toEqual({ version: GUEST_STATE_VERSION, bikes: [] });
    expect(isEmptyGuestState(state)).toBe(true);
  });

  it("returns an empty state where storage cannot be reached at all", () => {
    expect(collectGuestState({ storage: null, ...NAMES }).bikes).toEqual([]);
  });

  it("carries the guest bike's own id, so the import can recognise it later", () => {
    expect(collected.bikes).toHaveLength(1);
    expect(collected.bikes[0].localId).toBe(localBike.id);
    expect(collected.bikes[0].updatedAt).toBe(localBike.updatedAt);
    expect(collected.bikes[0].fit).toEqual({ saddleHeightMm: 742 });
    expect(isEmptyGuestState(collected)).toBe(false);
  });

  it("names the bike in the visitor's language — the guest bike has no name", () => {
    expect(collected.bikes[0].name).toBe(NAMES.bikeName);
  });

  it("turns the stored checkup's answers into one item per answered step", () => {
    const [checkup] = collected.bikes[0].checkups;
    expect(checkup.guestKey).toBe(CHECKUP_ID);
    expect(checkup.scope).toBe("parts");
    expect(checkup.completedAt).toBe(storedCheckup.completedAt);
    expect(checkup.items.map((item) => item.stepKey)).toEqual([
      "check-drivetrain#chain-wear",
      "check-drivetrain#cassette-teeth",
    ]);
    expect(checkup.items[0]).toEqual({
      stepKey: "check-drivetrain#chain-wear",
      partId: "chain",
      guideSlug: "check-drivetrain",
      result: "ko",
      notes: "élongation 0,8 %",
    });
  });

  it("ignores the demo bike's checkup — there is no row to attach it to", () => {
    expect(collected.bikes[0].checkups).toHaveLength(1);
    expect(guestImportKeys()).toEqual([LOCAL_BIKE_KEY, checkupKey("local"), buildListKey("local")]);
  });

  it("drops a checkup it cannot read rather than importing half of it", () => {
    const storage = memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [checkupKey("local")]: "{not json",
    });
    expect(collectGuestState({ storage, ...NAMES }).bikes[0].checkups).toEqual([]);
  });

  it("drops a checkup nobody answered — an empty row would show as history", () => {
    const storage = memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [checkupKey("local")]: JSON.stringify({ ...storedCheckup, answers: {} }),
    });
    expect(collectGuestState({ storage, ...NAMES }).bikes[0].checkups).toEqual([]);
  });

  it("reads what writeGuestBuildList actually writes, named after the bike", () => {
    expect(collected.bikes[0].lists).toEqual([
      {
        name: "Révision",
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

    // The producer, not a hand-built shape: `writeGuestBuildList` is the only
    // writer of `va:buildlist:<ref>`, so this fails if its envelope moves.
    const storage = memoryStorage({ [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW });
    expect(writeGuestBuildList("local", storedListItems, storage)).toBe(true);
    const [list] = collectGuestState({ storage, ...NAMES }).bikes[0].lists;
    // The envelope carries no name, so the list takes the caller's.
    expect(list.name).toBe(NAMES.listName);
    expect(list.items).toHaveLength(1);
  });

  it("survives a storage that throws on every read", () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(collectGuestState({ storage: throwing, ...NAMES }).bikes).toEqual([]);
  });

  it("keeps the bike when only the checkup and list keys are unreadable", () => {
    // A quota error part-way through a read is one key failing, not all three.
    const partly: KeyValueStorage = {
      getItem: (key) => {
        if (key === LOCAL_BIKE_KEY) return LOCAL_BIKE_RAW;
        throw new Error("blocked");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const [bike] = collectGuestState({ storage: partly, ...NAMES }).bikes;
    expect(bike.localId).toBe(localBike.id);
    expect(bike.checkups).toEqual([]);
    expect(bike.lists).toEqual([]);
  });

  it("has nothing to read on a server, where there is no window", () => {
    // `collectGuestState` is called from a client component, but the module is
    // imported by the action too: the default storage must not throw in Node.
    expect(collectGuestState({ ...NAMES }).bikes).toEqual([]);
  });

  it("carries no note for a step the visitor left blank", () => {
    const storage = memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [checkupKey("local")]: JSON.stringify({
        ...storedCheckup,
        notes: { "check-drivetrain#chain-wear": "" },
      }),
    });
    const [checkup] = collectGuestState({ storage, ...NAMES }).bikes[0].checkups;
    expect(checkup.items[0]).not.toHaveProperty("notes");
  });

  it("reads a checkup that has no notes at all", () => {
    const withoutNotes: Record<string, unknown> = { ...storedCheckup };
    delete withoutNotes.notes;
    const storage = memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [checkupKey("local")]: JSON.stringify(withoutNotes),
    });
    const [checkup] = collectGuestState({ storage, ...NAMES }).bikes[0].checkups;
    expect(checkup.items).toHaveLength(2);
    expect(checkup.items[0]).not.toHaveProperty("notes");
  });

  it("names an unnamed (or blank-named) list in the visitor's language", () => {
    for (const stored of [{ items: storedListItems }, { name: "   ", items: storedListItems }]) {
      const storage = memoryStorage({
        [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
        [buildListKey("local")]: JSON.stringify(stored),
      });
      const [list] = collectGuestState({ storage, ...NAMES }).bikes[0].lists;
      expect(list.name).toBe(NAMES.listName);
    }
  });

  it("drops an empty list, and defaults the item fields the envelope may omit", () => {
    const empty = memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [buildListKey("local")]: JSON.stringify({ name: "Vide", items: [] }),
    });
    expect(collectGuestState({ storage: empty, ...NAMES }).bikes[0].lists).toEqual([]);

    // `done` and `sortOrder` are optional in the stored item: a list written by
    // an older build, or hand-edited, still imports with the defaults.
    const sparse = memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [buildListKey("local")]: JSON.stringify({
        items: [{ partId: "chain", action: "replace", reasonKey: "chain-elongation" }],
      }),
    });
    const [list] = collectGuestState({ storage: sparse, ...NAMES }).bikes[0].lists;
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
    const parsed = parseGuestState(JSON.parse(JSON.stringify(collected)));
    expect(parsed.ok).toBe(true);
  });

  it("refuses a key the contract does not name (mass assignment)", () => {
    for (const extra of ["id", "userId", "spec", "createdAt", "specVersion"]) {
      const payload = JSON.parse(JSON.stringify(collected)) as Record<string, unknown>;
      // eslint-disable-next-line security/detect-object-injection -- `extra` is a literal from the list above, into a fresh clone
      (payload.bikes as Record<string, unknown>[])[0][extra] = "x";
      expect(parseGuestState(payload).ok, extra).toBe(false);
    }
  });

  it("refuses a version it was not written for", () => {
    expect(parseGuestState({ version: 2, bikes: [] }).ok).toBe(false);
    expect(parseGuestState({ bikes: [] }).ok).toBe(false);
    expect(parseGuestState(null).ok).toBe(false);
    expect(parseGuestState("{}").ok).toBe(false);
  });

  it("refuses an answer to a question this site never asked", () => {
    const payload = JSON.parse(JSON.stringify(collected)) as GuestState;
    (payload.bikes[0].answers as Record<string, string>)["not-a-question"] = "x";
    expect(parseGuestState(payload).ok).toBe(false);
  });

  it("refuses ids that could walk out of the content tree", () => {
    for (const bad of ["../../etc/passwd", "check/../x", "Check-Drivetrain", "a".repeat(200)]) {
      const payload = JSON.parse(JSON.stringify(collected)) as GuestState;
      payload.bikes[0].checkups[0].items[0].guideSlug = bad;
      expect(parseGuestState(payload).ok, bad).toBe(false);
    }
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
      const payload = JSON.parse(JSON.stringify(collected)) as GuestState;
      payload.bikes[0].lists[0].items[0].chosenProduct = { ...product, url };
      expect(parseGuestState(payload).ok, url).toBe(false);
    }

    const good = JSON.parse(JSON.stringify(collected)) as GuestState;
    good.bikes[0].lists[0].items[0].chosenProduct = {
      ...product,
      url: "https://www.alltricks.fr/chaine",
    };
    expect(parseGuestState(good).ok).toBe(true);
  });

  it("refuses more than the caps §4.4 names", () => {
    const one = collected.bikes[0];
    expect(parseGuestState({ version: 1, bikes: Array(GUEST_CAPS.bikes).fill(one) }).ok).toBe(true);
    expect(parseGuestState({ version: 1, bikes: Array(GUEST_CAPS.bikes + 1).fill(one) }).ok).toBe(
      false,
    );

    const over = (patch: Partial<typeof one>) =>
      parseGuestState({ version: 1, bikes: [{ ...one, ...patch }] }).ok;
    expect(over({ parts: Array(GUEST_CAPS.partsPerBike + 1).fill({}) })).toBe(false);
    expect(over({ checkups: Array(GUEST_CAPS.checkupsPerBike + 1).fill(one.checkups[0]) })).toBe(
      false,
    );
    expect(over({ lists: Array(GUEST_CAPS.listsPerBike + 1).fill(one.lists[0]) })).toBe(false);
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

  it("leaves a real guest bike far inside it", () => {
    expect(guestStateBytes(collected)).toBeLessThan(MAX_GUEST_PAYLOAD_BYTES / 4);
  });
});

// ── clearing ─────────────────────────────────────────────────────────────────

describe("clearGuestState", () => {
  it("forgets the local bike, its checkup and its list — and nothing else", () => {
    const storage = memoryStorage({
      [LOCAL_BIKE_KEY]: LOCAL_BIKE_RAW,
      [checkupKey("local")]: "{}",
      [buildListKey("local")]: "[]",
      [checkupKey("demo")]: "{}",
      "va:bike3d:quality": "high",
    });
    clearGuestState(storage);
    expect([...(storage as ReturnType<typeof memoryStorage>).map.keys()].sort()).toEqual([
      "va:bike3d:quality",
      checkupKey("demo"),
    ]);
  });

  it("does nothing where storage cannot be reached, and swallows a storage that throws", () => {
    expect(() => clearGuestState(null)).not.toThrow();
    expect(() =>
      clearGuestState({
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});
