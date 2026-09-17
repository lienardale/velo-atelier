import { beforeEach, describe, expect, it, vi } from "vitest";

import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { findPart } from "@/lib/domain/engine/parts-for-spec";

import { readLocalBike, writeLocalBike, type KeyValueStorage } from "./local-bike";
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
