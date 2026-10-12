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
/** The id of a guest bike that is in no storage. */
const GONE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

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
  /** The guest bike in storage: a guest repo is built for ONE bike, by its id. */
  let bikeId: string;

  beforeEach(() => {
    bikeId = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!.id;
  });

  it("persists an attribute edit and keeps it across a reload", async () => {
    const repo = localBikeRepo(bikeId, { storage });
    const before = readLocalBike(storage)!;
    const result = await repo.setAttribute(
      { spec: before.spec, parts: before.parts },
      { partId: "saddle", key: "saddle-width", value: 155 },
    );

    expect(result.ok).toBe(true);
    expect(findPart(readLocalBike(storage)!, "saddle")?.attributes["saddle-width"]).toBe(155);
    expect(readLocalBike(storage)!.id, "still that bike").toBe(bikeId);
  });

  it("re-reads storage before writing, so a stale build cannot clobber a newer edit", async () => {
    const repo = localBikeRepo(bikeId, { storage });
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
    const repo = localBikeRepo(bikeId, { storage });
    await repo.setFit({ riderKg: 72 });
    const result = await repo.setFit({ saddleHeightMm: 742 });

    expect(result).toMatchObject({ ok: true, data: { riderKg: 72, saddleHeightMm: 742 } });
    expect(readLocalBike(storage)?.fit).toEqual({ riderKg: 72, saddleHeightMm: 742 });
  });

  it("answers NOT_FOUND when there is no guest bike at all", async () => {
    const empty = localBikeRepo(bikeId, { storage: new MemoryStorage() });
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
    const repo = localBikeRepo(bikeId, { storage });
    storage.full = true;
    const result = await repo.setFit({ riderKg: 72 });
    expect(result).toMatchObject({
      ok: false,
      code: "CONFLICT",
      fieldErrors: { form: "bike.errors.storageFull" },
    });
  });

  it("refuses an edit the domain refuses, with the key as the field", async () => {
    const repo = localBikeRepo(bikeId, { storage });
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

/**
 * `va:bike:local` is a slot. The guest bike in it is replaced by a NEW one —
 * a new id — by the demo's "Modifier ce vélo" and by the tree's "Générer mon
 * vélo", and a page showing the first can still be open: another tab, or this
 * one a moment before it hears of it. Until 2026-10-12 the guest repo read
 * the slot before every write and wrote back under whatever id it found, so
 * a write made for bike A landed on bike B: 45 typed for A's front tyre and
 * not left was written to B's by the field's removal (`.debug/017` §5.8,
 * "Fourth review"). A guest repo is for ONE bike.
 */
describe("the local repo writes the bike it was built for, and no other", () => {
  const WIDTH_45 = { partId: "tire-front", key: "etrto-width", value: 45 } as const;
  const frontWidth = () =>
    findPart(readLocalBike(storage)!, "tire-front")?.attributes["etrto-width"];

  const REPLACED = [
    [
      "the demo's local copy",
      () => forkDemoToLocal({ answers: BIKE_PRESETS["gravel-1x11"] }, storage),
    ],
    [
      "a bike generated again from the tree",
      () => writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage }),
    ],
  ] as const;

  it.each(REPLACED)(
    "guest bike A replaced in the slot by %s: an attribute edit and a fit, both made through A's repo, write nothing and answer NOT_FOUND",
    async (_how, replace) => {
      const a = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
      const repo = localBikeRepo(a.id, { storage });
      const build = { spec: a.spec, parts: a.parts };

      const b = replace()!;
      expect(b.id).not.toBe(a.id);
      const bytes = storage.getItem(LOCAL_BIKE_KEY);

      await expect(repo.setAttribute(build, WIDTH_45)).resolves.toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      await expect(repo.setFit({ riderKg: 72 })).resolves.toEqual({
        ok: false,
        code: "NOT_FOUND",
      });

      // Not one byte of B moved — `updatedAt` included.
      expect(storage.getItem(LOCAL_BIKE_KEY)).toBe(bytes);
      expect(frontWidth()).toBe(42);
      expect(readLocalBike(storage)!.fit).toBeNull();

      // B is written by the repo built for B.
      const next = localBikeRepo(b.id, { storage });
      await expect(
        next.setAttribute({ spec: b.spec, parts: b.parts }, WIDTH_45),
      ).resolves.toMatchObject({ ok: true });
      await expect(next.setFit({ riderKg: 72 })).resolves.toMatchObject({ ok: true });
      expect(frontWidth()).toBe(45);
      expect(readLocalBike(storage)!.id).toBe(b.id);
      // …and A's repo is no nearer to it for that.
      await expect(repo.setAttribute(build, { ...WIDTH_45, value: 47 })).resolves.toMatchObject({
        ok: false,
        code: "NOT_FOUND",
      });
      expect(frontWidth()).toBe(45);
    },
  );

  it("the SAME bike written again under its id — another tab's edit, this repo's own — is still its bike", async () => {
    const a = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
    const repo = localBikeRepo(a.id, { storage });
    // Another tab: the same bike, a fit added.
    writeLocalBike(
      { id: a.id, answers: a.answers, parts: a.parts, fit: { riderKg: 70 } },
      { storage },
    );

    await expect(
      repo.setAttribute({ spec: a.spec, parts: a.parts }, WIDTH_45),
    ).resolves.toMatchObject({ ok: true });
    expect(frontWidth()).toBe(45);
    expect(readLocalBike(storage)).toMatchObject({ id: a.id, fit: { riderKg: 70 } });
  });

  it("a repo of NO bike refuses every write, whatever the slot holds, and touches nothing", async () => {
    const stored = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
    const bytes = storage.getItem(LOCAL_BIKE_KEY);
    const build = { spec: stored.spec, parts: stored.parts };

    for (const repo of [localBikeRepo(null, { storage }), bikeRepoFor("local", { storage })]) {
      await expect(repo.setAttribute(build, WIDTH_45)).resolves.toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      await expect(repo.setFit({ riderKg: 72 })).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
      expect(repo.canEdit).toBe(true);
    }
    expect(storage.getItem(LOCAL_BIKE_KEY)).toBe(bytes);

    // Not even a value it could not have parsed: it does not read at all.
    storage.setItem(LOCAL_BIKE_KEY, "{ not json");
    await localBikeRepo(null, { storage }).setFit({ riderKg: 72 });
    expect(storage.getItem(LOCAL_BIKE_KEY)).toBe("{ not json");
  });

  it("a guest bike that is in no storage is not written into being", async () => {
    const stored = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
    const bytes = storage.getItem(LOCAL_BIKE_KEY);
    const repo = localBikeRepo(GONE_ID, { storage });

    await expect(
      repo.setAttribute({ spec: stored.spec, parts: stored.parts }, WIDTH_45),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(storage.getItem(LOCAL_BIKE_KEY)).toBe(bytes);
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
    expect(bikeRepoFor("local", { bikeId: GONE_ID, storage }).kind).toBe("local");
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

  it("builds a guest repo for the guest bike it is given: that one is written, and a repo given another's id writes nothing", async () => {
    const bike = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;

    await expect(
      bikeRepoFor("local", { bikeId: GONE_ID, storage }).setFit({ riderKg: 72 }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(readLocalBike(storage)!.fit).toBeNull();

    await expect(
      bikeRepoFor("local", { bikeId: bike.id, storage }).setFit({ riderKg: 72 }),
    ).resolves.toMatchObject({ ok: true });
    expect(readLocalBike(storage)).toMatchObject({ id: bike.id, fit: { riderKg: 72 } });
  });
});

/**
 * What outlives a mount is keyed by the BIKE (`components/bike/PartEditForm.tsx`,
 * `lib/bike/own-writes.ts`, `.debug/017` §5.8) — and two things that lead to a
 * bike are not one. A repo object: `BikeWorkspace` builds one each time it
 * mounts. The `[id]` segment of the route: `/velo/local` is a slot, and the
 * guest bike in it is replaced by another without the document being loaded
 * again.
 *
 * And the key says where a write through the repo GOES: for a guest repo, its
 * own bike while that bike is in the slot, and nothing (`null`) once it is
 * not — never the bike that took its place.
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

  it("a guest bike is the bike its repo was built for, by its own id — the same for every repo built over it, and across its own writes", async () => {
    const bike = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
    const first = localBikeRepo(bike.id, { storage });
    const again = bikeRepoFor("local", { bikeId: bike.id, storage });
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
   * new one was taken for the old. Between that review and the fourth the
   * repo built over the first NAMED THE SECOND from then on — and wrote it.
   * Now it names no bike at all: its own is gone, and it has none to write.
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
    "a guest bike REPLACED in the slot — %s — is another bike: the repo built over the first names none from then on, and the second's names the second",
    (_how, replace) => {
      const first = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
      const repo = localBikeRepo(first.id, { storage });
      const before = repo.bikeKey();
      expect(before).toBe(`local:${first.id}`);

      const second = replace();
      expect(second).not.toBeNull();
      expect(second!.id).not.toBe(first.id);
      // Neither the first bike's key — it is not there to be written — nor,
      // above all, the key of the bike that took its place.
      expect(repo.bikeKey()).toBeNull();

      const next = localBikeRepo(second!.id, { storage });
      expect(next.bikeKey()).toBe(`local:${second!.id}`);
      expect(next.bikeKey()).not.toBe(before);
    },
  );

  it("a repo built for a guest bike that is not the one in the slot names no bike, and one built for none names none", () => {
    const bike = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
    expect(localBikeRepo(GONE_ID, { storage }).bikeKey()).toBeNull();
    expect(bikeRepoFor("local", { bikeId: GONE_ID, storage }).bikeKey()).toBeNull();
    expect(localBikeRepo(null, { storage }).bikeKey()).toBeNull();
    expect(bikeRepoFor("local", { storage }).bikeKey()).toBeNull();
    expect(localBikeRepo(bike.id, { storage }).bikeKey()).toBe(`local:${bike.id}`);
  });

  it("no two kinds of bike can share a key: a guest bike's is not a UUID, and not the slot's name", () => {
    const bike = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
    const key = localBikeRepo(bike.id, { storage }).bikeKey()!;
    expect(bike.id).toMatch(UUID);
    expect(key).not.toMatch(UUID);
    expect(key).not.toBe("local");
    expect(key).not.toBe("demo");
    // What the record's field names are built on (`fieldOf`).
    expect(key).not.toContain("/");
    expect(BIKE_ID).toMatch(UUID);
  });

  it("there is no key where there is no bike to write: no storage, an empty slot, a value that does not parse", () => {
    expect(localBikeRepo(GONE_ID, { storage: null }).bikeKey()).toBeNull();
    expect(localBikeRepo(GONE_ID, { storage }).bikeKey()).toBeNull();
    expect(bikeRepoFor("local", { bikeId: GONE_ID, storage }).bikeKey()).toBeNull();

    storage.setItem(LOCAL_BIKE_KEY, "{ not json");
    expect(localBikeRepo(GONE_ID, { storage }).bikeKey()).toBeNull();
    // Not even when the unreadable value carries the very id the repo is for.
    storage.setItem(LOCAL_BIKE_KEY, JSON.stringify({ version: 1, id: GONE_ID }));
    expect(localBikeRepo(GONE_ID, { storage }).bikeKey()).toBeNull();
    storage.setItem(LOCAL_BIKE_KEY, JSON.stringify({ version: 1, id: "not-a-uuid" }));
    expect(localBikeRepo(GONE_ID, { storage }).bikeKey()).toBeNull();

    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(localBikeRepo(GONE_ID, { storage: throwing }).bikeKey()).toBeNull();
  });

  /**
   * It is asked when a field is left. `readLocalBike` REMOVES a value it
   * cannot parse; asking which bike is there must not.
   */
  it("asking removes nothing from storage, readable or not", () => {
    storage.setItem(LOCAL_BIKE_KEY, "{ not json");
    expect(localBikeRepo(GONE_ID, { storage }).bikeKey()).toBeNull();
    expect(storage.getItem(LOCAL_BIKE_KEY)).toBe("{ not json");

    const bike = writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage })!;
    const raw = storage.getItem(LOCAL_BIKE_KEY);
    expect(localBikeRepo(bike.id, { storage }).bikeKey()).toBe(`local:${bike.id}`);
    expect(localBikeRepo(GONE_ID, { storage }).bikeKey()).toBeNull();
    expect(storage.getItem(LOCAL_BIKE_KEY)).toBe(raw);
  });
});
