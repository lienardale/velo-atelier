// @vitest-environment jsdom
// jsdom: the default storage is `window.localStorage`, as in the browser.
import { describe, expect, it } from "vitest";

import { partDefinition } from "@/lib/domain/data/parts";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import { answerWithDefaults } from "@/lib/domain/engine/decision";
import { partsForSpec } from "@/lib/domain/engine/parts-for-spec";

import {
  clearLocalBike,
  hasLocalBike,
  newLocalBikeId,
  parseLocalBike,
  readLocalBike,
  writeLocalBike,
  type KeyValueStorage,
} from "./local-bike";
import { LOCAL_BIKE_KEY } from "./storage-keys";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIXED_ID = "00000000-0000-4000-8000-000000000042";
const NOW = new Date("2026-09-17T10:00:00.000Z");

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** Storage that throws on every access, like Safari's private mode used to. */
const brokenStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const gravel = BIKE_PRESETS["gravel-1x11"];

function stored(storage: MemoryStorage): Record<string, unknown> {
  return JSON.parse(storage.items.get(LOCAL_BIKE_KEY)!) as Record<string, unknown>;
}

describe("writeLocalBike", () => {
  it("stores the §1.2 envelope with a derived spec and default parts", () => {
    const storage = new MemoryStorage();
    const bike = writeLocalBike(
      { answers: gravel },
      { storage, now: () => NOW, newId: () => FIXED_ID },
    );
    const spec = buildBikeSpec(answerWithDefaults(gravel));

    expect(bike).toEqual({
      version: 1,
      id: FIXED_ID,
      answers: gravel,
      spec,
      parts: partsForSpec(spec),
      fit: null,
      updatedAt: NOW.toISOString(),
    });
    expect(stored(storage)).toEqual(JSON.parse(JSON.stringify(bike)));
  });

  it("recomputes the spec from the answers and prunes stale answers", () => {
    const storage = new MemoryStorage();
    const bike = writeLocalBike(
      { answers: { discipline: "road", suspension: "full" } },
      { storage, newId: () => FIXED_ID },
    );
    expect(bike?.answers).toEqual({ discipline: "road" });
    expect(bike?.spec.suspension).toEqual({ front: false, rear: false });
  });

  it("generates a fresh v4 id for a new bike and keeps a valid id on update", () => {
    const storage = new MemoryStorage();
    const first = writeLocalBike({ answers: {} }, { storage });
    expect(first?.id).toMatch(UUID);
    const updated = writeLocalBike({ answers: gravel, id: first!.id }, { storage });
    expect(updated?.id).toBe(first?.id);
    const forged = writeLocalBike({ answers: gravel, id: "not-a-uuid" }, { storage });
    expect(forged?.id).toMatch(UUID);
    expect(forged?.id).not.toBe("not-a-uuid");
  });

  it("keeps attribute edits that are valid for the spec and rebuilds invalid parts", () => {
    const storage = new MemoryStorage();
    const spec = buildBikeSpec(answerWithDefaults(gravel));
    // A real owner edit: the first editable enum attribute, set to another allowed value.
    const defaults = partsForSpec(spec);
    const edit = defaults.flatMap((part) =>
      (partDefinition(part.partId)?.attributes ?? [])
        .filter(
          (attribute) =>
            attribute.editable &&
            attribute.kind === "enum" &&
            attribute.key in part.attributes &&
            (attribute.values ?? []).length >= 2,
        )
        .map((attribute) => ({
          partId: part.partId,
          key: attribute.key,
          value: attribute.values!.find((value) => value !== part.attributes[attribute.key])!,
        })),
    )[0];
    const parts = defaults.map((part) =>
      part.partId === edit.partId
        ? { ...part, attributes: { ...part.attributes, [edit.key]: edit.value } }
        : part,
    );
    expect(parts).not.toEqual(defaults);
    const kept = writeLocalBike({ answers: gravel, parts }, { storage });
    expect(kept?.parts).toEqual(parts);

    const tampered = [{ partId: "saddle", attributes: { evil: true } }];
    const rebuilt = writeLocalBike({ answers: gravel, parts: tampered }, { storage });
    expect(rebuilt?.parts).toEqual(partsForSpec(spec));
  });

  it("returns null when storage is unavailable or full", () => {
    expect(writeLocalBike({ answers: gravel }, { storage: null })).toBeNull();
    expect(writeLocalBike({ answers: gravel }, { storage: brokenStorage })).toBeNull();
  });

  it("uses window.localStorage by default", () => {
    window.localStorage.removeItem(LOCAL_BIKE_KEY);
    expect(hasLocalBike()).toBe(false);
    expect(writeLocalBike({ answers: gravel })).not.toBeNull();
    expect(hasLocalBike()).toBe(true);
    expect(readLocalBike()?.answers).toEqual(gravel);
    clearLocalBike();
    expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBeNull();
  });
});

describe("readLocalBike / parseLocalBike", () => {
  it("reads back exactly what was written", () => {
    const storage = new MemoryStorage();
    const written = writeLocalBike(
      { answers: gravel, fit: { saddleHeightMm: 742 } },
      { storage, now: () => NOW },
    );
    expect(readLocalBike(storage)).toEqual(written);
  });

  it("returns null for an absent key without touching storage", () => {
    const storage = new MemoryStorage();
    expect(readLocalBike(storage)).toBeNull();
    expect(parseLocalBike(null)).toBeNull();
    expect(readLocalBike(null)).toBeNull();
    expect(readLocalBike(brokenStorage)).toBeNull();
  });

  it.each([
    ["not JSON", "{oops"],
    ["not an object", "42"],
    ["wrong version", { version: 2 }],
    ["id not a uuid", { id: "abc" }],
    ["unknown question", { answers: { colour: "red" } }],
    ["answer with a dot", { answers: { drive: "e.bike" } }],
    ["answer too long", { answers: { drive: "a".repeat(33) } }],
    ["parts not an array", { parts: {} }],
    ["fit with a nested object", { fit: { saddleHeightMm: { $gt: 1 } } }],
    ["fit with a non-finite number", { fit: { reach: Number.NaN } }],
    ["date not ISO", { updatedAt: "yesterday" }],
  ])("drops a stored value that does not parse (%s)", (_label, change) => {
    const storage = new MemoryStorage();
    writeLocalBike({ answers: gravel }, { storage });
    const raw =
      typeof change === "string" ? change : JSON.stringify({ ...stored(storage), ...change });
    storage.setItem(LOCAL_BIKE_KEY, raw);

    expect(readLocalBike(storage)).toBeNull();
    expect(storage.items.has(LOCAL_BIKE_KEY)).toBe(false);
  });

  it("re-derives the spec from the answers, ignoring a tampered stored spec", () => {
    const storage = new MemoryStorage();
    writeLocalBike({ answers: gravel }, { storage });
    const value = stored(storage);
    storage.setItem(
      LOCAL_BIKE_KEY,
      JSON.stringify({ ...value, spec: { version: 1, drive: "electric" }, parts: [{ bad: 1 }] }),
    );
    const bike = readLocalBike(storage);
    const spec = buildBikeSpec(answerWithDefaults(gravel));
    expect(bike?.spec).toEqual(spec);
    expect(bike?.parts).toEqual(partsForSpec(spec));
  });

  it("does not fail when clearing broken storage", () => {
    expect(() => clearLocalBike(brokenStorage)).not.toThrow();
    expect(() => clearLocalBike(null)).not.toThrow();
  });
});

describe("newLocalBikeId", () => {
  it("falls back to getRandomValues outside a secure context", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 50 }, () => newLocalBikeId()));
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id).toMatch(UUID);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
