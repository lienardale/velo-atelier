import { beforeEach, describe, expect, it, vi } from "vitest";

import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { findPart } from "@/lib/domain/engine/parts-for-spec";

import { readLocalBike, writeLocalBike, type KeyValueStorage } from "./local-bike";
import { LOCAL_BIKE_KEY } from "./storage-keys";
import {
  bikeRepoFor,
  demoBikeRepo,
  forkDemoToLocal,
  localBikeRepo,
  remoteBikeRepo,
  type RemoteBikeActions,
} from "./repo";
import { buildOf, deriveBike } from "./rules";

const BIKE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  full = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.full) throw new DOMException("quota", "QuotaExceededError");
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

describe("the demo repo", () => {
  it("refuses every write, in the shape the forms already handle", async () => {
    const repo = demoBikeRepo();
    expect(repo.canEdit).toBe(false);
    await expect(
      repo.setAttribute(buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"])), {
        partId: "saddle",
        key: "saddle-width",
        value: 155,
      }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(repo.setFit({ saddleHeightMm: 742 })).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("forks to a local copy the visitor owns", () => {
    const demo = deriveBike(BIKE_PRESETS["gravel-1x11"]);
    const forked = forkDemoToLocal({ answers: demo.answers }, storage);
    expect(forked).not.toBeNull();
    expect(readLocalBike(storage)?.answers).toEqual(demo.answers);
    expect(forked!.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("the local repo", () => {
  beforeEach(() => {
    writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage });
  });

  it("persists an attribute edit and keeps it across a reload", async () => {
    const repo = localBikeRepo({ storage });
    const before = readLocalBike(storage)!;
    const result = await repo.setAttribute(
      { spec: before.spec, parts: before.parts },
      { partId: "saddle", key: "saddle-width", value: 155 },
    );

    expect(result.ok).toBe(true);
    expect(findPart(readLocalBike(storage)!, "saddle")?.attributes["saddle-width"]).toBe(155);
  });

  it("re-reads storage before writing, so a stale build cannot clobber a newer edit", async () => {
    const repo = localBikeRepo({ storage });
    const stale = readLocalBike(storage)!;

    // Another tab changes the saddle…
    await repo.setAttribute(
      { spec: stale.spec, parts: stale.parts },
      { partId: "saddle", key: "saddle-width", value: 155 },
    );
    // …and this one, holding the pre-edit build, changes the cassette.
    await repo.setAttribute(
      { spec: stale.spec, parts: stale.parts },
      { partId: "cassette", key: "range", value: "11-42" },
    );

    const after = readLocalBike(storage)!;
    expect(findPart(after, "saddle")?.attributes["saddle-width"]).toBe(155);
    expect(findPart(after, "cassette")?.attributes["range"]).toBe("11-42");
  });

  it("merges a fit patch rather than replacing the whole object", async () => {
    const repo = localBikeRepo({ storage });
    await repo.setFit({ riderKg: 72 });
    const result = await repo.setFit({ saddleHeightMm: 742 });

    expect(result).toMatchObject({ ok: true, data: { riderKg: 72, saddleHeightMm: 742 } });
    expect(readLocalBike(storage)?.fit).toEqual({ riderKg: 72, saddleHeightMm: 742 });
  });

  it("answers NOT_FOUND when there is no guest bike at all", async () => {
    const empty = localBikeRepo({ storage: new MemoryStorage() });
    await expect(
      empty.setAttribute(buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"])), {
        partId: "saddle",
        key: "saddle-width",
        value: 155,
      }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(empty.setFit({ riderKg: 70 })).resolves.toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("says so when storage refuses the write", async () => {
    const repo = localBikeRepo({ storage });
    storage.full = true;
    const result = await repo.setFit({ riderKg: 72 });
    expect(result).toMatchObject({
      ok: false,
      code: "CONFLICT",
      fieldErrors: { form: "bike.errors.storageFull" },
    });
  });

  it("refuses an edit the domain refuses, with the key as the field", async () => {
    const repo = localBikeRepo({ storage });
    const bike = readLocalBike(storage)!;
    await expect(
      repo.setAttribute(
        { spec: bike.spec, parts: bike.parts },
        { partId: "saddle", key: "saddle-width", value: 9_999 },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { "saddle-width": "bike.errors.invalid-value" },
    });

    await expect(
      repo.setAttribute(
        { spec: bike.spec, parts: bike.parts },
        { partId: "e-motor", key: "torque", value: 85 },
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("the remote repo", () => {
  it("hands the edit to the action with the bike id it was built for", async () => {
    const actions: RemoteBikeActions = {
      updatePart: vi.fn().mockResolvedValue({ ok: true, data: { spec: {}, parts: [] } }),
      updateFit: vi.fn().mockResolvedValue({ ok: true, data: { riderKg: 70 } }),
    };
    const repo = remoteBikeRepo(BIKE_ID, actions);

    await repo.setAttribute(buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"])), {
      partId: "saddle",
      key: "saddle-width",
      value: 155,
    });
    await repo.setFit({ riderKg: 70 });

    expect(actions.updatePart).toHaveBeenCalledWith({
      bikeId: BIKE_ID,
      partId: "saddle",
      attributes: { "saddle-width": 155 },
    });
    expect(actions.updateFit).toHaveBeenCalledWith({ bikeId: BIKE_ID, fit: { riderKg: 70 } });
  });
});

describe("bikeRepoFor", () => {
  it("picks the repo from the ref kind", () => {
    expect(bikeRepoFor("demo", {}).canEdit).toBe(false);
    expect(bikeRepoFor("local", { storage }).kind).toBe("local");
    expect(
      bikeRepoFor("db", {
        bikeId: BIKE_ID,
        actions: { updatePart: vi.fn(), updateFit: vi.fn() } as unknown as RemoteBikeActions,
      }).kind,
    ).toBe("db");
  });

  it("refuses to build a db repo without the things only the page knows", () => {
    expect(() => bikeRepoFor("db", {})).toThrow(/bikeId/);
  });
});

/**
 * What outlives a mount is keyed by the BIKE (`components/bike/PartEditForm.tsx`,
 * `lib/bike/own-writes.ts`, `.debug/017` §5.8) — and two things that lead to a
 * bike are not one. A repo object: `BikeWorkspace` builds one each time it
 * mounts. The `[id]` segment of the route: `/velo/local` is a slot, and the
 * guest bike in it is replaced by another without the document being loaded
 * again.
 */
describe("bikeKey — WHICH bike a repo writes", () => {
  const actions = { updatePart: vi.fn(), updateFit: vi.fn() } as unknown as RemoteBikeActions;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it("a saved bike is its id, the same for every repo built over it, and another bike's is another", () => {
    const otherActions = {
      updatePart: vi.fn(),
      updateFit: vi.fn(),
    } as unknown as RemoteBikeActions;
    const first = bikeRepoFor("db", { bikeId: BIKE_ID, actions });
    const again = bikeRepoFor("db", { bikeId: BIKE_ID, actions: otherActions });
    expect(again).not.toBe(first);
    expect(first.bikeKey()).toBe(BIKE_ID);
    expect(again.bikeKey()).toBe(BIKE_ID);
    expect(remoteBikeRepo(BIKE_ID, actions).bikeKey()).toBe(BIKE_ID);

    const other = bikeRepoFor("db", { bikeId: "9b2d7c1a-5e3f-4a8b-b6c4-0d1e2f3a4b5c", actions });
    expect(other.bikeKey()).not.toBe(first.bikeKey());
  });

  it("the demo bike is the one demo bike", () => {
    expect(bikeRepoFor("demo", {}).bikeKey()).toBe("demo");
    expect(demoBikeRepo().bikeKey()).toBe("demo");
  });

  it("a guest bike is the bike in storage, by its own id — the same for every repo built over it, and across its own writes", async () => {
    const bike = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
    const first = localBikeRepo({ storage });
    const again = bikeRepoFor("local", { storage });
    expect(again).not.toBe(first);
    expect(first.bikeKey()).toBe(`local:${bike.id}`);
    expect(again.bikeKey()).toBe(`local:${bike.id}`);

    // A write keeps the bike's id: it is still that bike.
    const result = await first.setAttribute(
      { spec: bike.spec, parts: bike.parts },
      { partId: "saddle", key: "saddle-width", value: 155 },
    );
    expect(result.ok).toBe(true);
    await first.setFit({ riderKg: 72 });
    expect(first.bikeKey()).toBe(`local:${bike.id}`);
  });

  /**
   * The demo's "Modifier ce vélo" and the tree's "Générer mon vélo" both store
   * a guest bike WITHOUT an id — a new bike — in the slot the previous one was
   * in. Until the third review every guest bike was named `local`, and the
   * new one was taken for the old.
   */
  it.each([
    [
      "the demo's local copy",
      () => forkDemoToLocal({ answers: BIKE_PRESETS["gravel-1x11"] }, storage),
    ],
    [
      "a bike generated again from the tree",
      () => writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage }),
    ],
  ] as const)(
    "a guest bike REPLACED in the slot — %s — is another bike, to the very repo that was built over the first",
    (_how, replace) => {
      const first = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
      const repo = localBikeRepo({ storage });
      const before = repo.bikeKey();
      expect(before).toBe(`local:${first.id}`);

      const second = replace();
      expect(second).not.toBeNull();
      expect(second!.id).not.toBe(first.id);
      expect(repo.bikeKey()).toBe(`local:${second!.id}`);
      expect(repo.bikeKey()).not.toBe(before);
    },
  );

  it("no two kinds of bike can share a key: a guest bike's is not a UUID, and not the slot's name", () => {
    const bike = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
    const key = localBikeRepo({ storage }).bikeKey()!;
    expect(bike.id).toMatch(UUID);
    expect(key).not.toMatch(UUID);
    expect(key).not.toBe("local");
    expect(key).not.toBe("demo");
    // What the record's field names are built on (`fieldOf`).
    expect(key).not.toContain("/");
    expect(BIKE_ID).toMatch(UUID);
  });

  it("there is no key where there is no bike to write: no storage, an empty slot, a value that does not parse", () => {
    expect(localBikeRepo({ storage: null }).bikeKey()).toBeNull();
    expect(localBikeRepo({ storage }).bikeKey()).toBeNull();
    expect(bikeRepoFor("local", { storage }).bikeKey()).toBeNull();

    storage.setItem(LOCAL_BIKE_KEY, "{ not json");
    expect(localBikeRepo({ storage }).bikeKey()).toBeNull();
    storage.setItem(LOCAL_BIKE_KEY, JSON.stringify({ version: 1, id: "not-a-uuid" }));
    expect(localBikeRepo({ storage }).bikeKey()).toBeNull();

    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(localBikeRepo({ storage: throwing }).bikeKey()).toBeNull();
  });

  /**
   * It is asked when a field is left. `readLocalBike` REMOVES a value it
   * cannot parse; asking which bike is there must not.
   */
  it("asking removes nothing from storage, readable or not", () => {
    storage.setItem(LOCAL_BIKE_KEY, "{ not json");
    expect(localBikeRepo({ storage }).bikeKey()).toBeNull();
    expect(storage.getItem(LOCAL_BIKE_KEY)).toBe("{ not json");

    writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage });
    const raw = storage.getItem(LOCAL_BIKE_KEY);
    localBikeRepo({ storage }).bikeKey();
    expect(storage.getItem(LOCAL_BIKE_KEY)).toBe(raw);
  });
});
