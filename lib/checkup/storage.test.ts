/**
 * `lib/checkup/storage.ts` (§5.4): the guest key, the guard, the autosave and
 * the injected server store.
 *
 * Storage is user input. Every "what if the value is rubbish" path is here, and
 * so is every "what if storage itself refuses" one — a phone in private mode
 * throws on `getItem`, a full quota throws on `setItem`, and neither may take
 * the wizard down with it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeState, threeStepPlan } from "@/tests/_helpers/checkup";

import {
  answeredCount,
  AUTOSAVE_DELAY_MS,
  createAutosave,
  createServerStore,
  fromStored,
  guestRefOf,
  localStorageStore,
  readGuestBuildList,
  readStoredCheckup,
  toStored,
  writeGuestBuildList,
  writeStoredCheckup,
  type KeyValueStorage,
  type StoredCheckup,
} from "./storage";
import { deriveBuildList } from "./build-list";

const PLAN = threeStepPlan();
const [PADS, , CHAIN] = PLAN;

/** A `localStorage` stand-in that can be made to fail. */
function memoryStorage(fail: { read?: boolean; write?: boolean } = {}): KeyValueStorage & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => {
      if (fail.read) throw new Error("blocked");
      return map.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (fail.write) throw new Error("quota");
      map.set(key, value);
    },
    removeItem: (key) => {
      if (fail.write) throw new Error("quota");
      map.delete(key);
    },
  };
}

function answered(): ReturnType<typeof makeState> {
  return makeState(PLAN, {
    answers: { [PADS.key]: "ok", [CHAIN.key]: "ko" },
    symptoms: { [CHAIN.key]: ["chain-elongation"] },
    notes: { [CHAIN.key]: "elle saute" },
    toolsMissing: ["chain-checker"],
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("toStored / fromStored", () => {
  it("writes the answers and not the plan", () => {
    const stored = toStored(answered());
    expect(Object.keys(stored)).not.toContain("steps");
    expect(Object.keys(stored)).not.toContain("cursor");
    expect(stored.answers[CHAIN.key]).toBe("ko");
  });

  it("keeps completedAt only when there is one", () => {
    expect(toStored(answered()).completedAt).toBeUndefined();
    expect(toStored(makeState(PLAN, { completedAt: "2026-09-19T09:00:00.000Z" })).completedAt).toBe(
      "2026-09-19T09:00:00.000Z",
    );
  });

  it("re-plans on the way back in and parks the cursor on the first open question", () => {
    const state = fromStored(toStored(answered()), PLAN, "content-v2");
    expect(state.answers).toEqual({ [PADS.key]: "ok", [CHAIN.key]: "ko" });
    expect(state.steps).toEqual(PLAN);
    expect(state.cursor).toBe(1);
    expect(state.contentVersion).toBe("content-v2");
    expect(state.toolsMissing).toEqual(["chain-checker"]);
  });

  it("carries a completed checkup back as completed", () => {
    const done = makeState(PLAN, {
      answers: { [PADS.key]: "ok", [PLAN[1].key]: "ok", [CHAIN.key]: "ok" },
      completedAt: "2026-09-19T09:00:00.000Z",
    });
    expect(fromStored(toStored(done), PLAN, "v").completedAt).toBe("2026-09-19T09:00:00.000Z");
  });

  it("counts the answers", () => {
    expect(answeredCount(toStored(answered()))).toBe(2);
  });
});

describe("guestRefOf", () => {
  it("names the browser-side bikes and refuses a saved one", () => {
    expect(guestRefOf({ kind: "demo" })).toBe("demo");
    expect(guestRefOf({ kind: "local" })).toBe("local");
    expect(guestRefOf({ kind: "db", id: "x" })).toBeNull();
  });
});

describe("readStoredCheckup / writeStoredCheckup", () => {
  it("round-trips through va:checkup:<ref>", () => {
    const storage = memoryStorage();
    expect(writeStoredCheckup("demo", toStored(answered()), storage)).toBe(true);
    expect(storage.map.has("va:checkup:demo")).toBe(true);
    expect(readStoredCheckup("demo", storage)?.answers[CHAIN.key]).toBe("ko");
  });

  it("is null when nothing is stored", () => {
    expect(readStoredCheckup("local", memoryStorage())).toBeNull();
  });

  it("drops a value that is not JSON, and removes it", () => {
    const storage = memoryStorage();
    storage.map.set("va:checkup:demo", "{oops");
    expect(readStoredCheckup("demo", storage)).toBeNull();
    expect(storage.map.has("va:checkup:demo")).toBe(false);
  });

  it("drops a value the schema refuses", () => {
    const storage = memoryStorage();
    storage.map.set("va:checkup:demo", JSON.stringify({ version: 1, id: "not-a-uuid" }));
    expect(readStoredCheckup("demo", storage)).toBeNull();
  });

  it("refuses a step key that is not one", () => {
    const stored = toStored(answered()) as unknown as { answers: Record<string, string> };
    stored.answers["../../etc/passwd"] = "ko";
    const storage = memoryStorage();
    storage.map.set("va:checkup:demo", JSON.stringify(stored));
    expect(readStoredCheckup("demo", storage)).toBeNull();
  });

  it("survives a browser that throws on read, on write and on remove", () => {
    expect(readStoredCheckup("demo", memoryStorage({ read: true }))).toBeNull();
    expect(writeStoredCheckup("demo", toStored(answered()), memoryStorage({ write: true }))).toBe(
      false,
    );

    const blocked = memoryStorage();
    blocked.map.set("va:checkup:demo", "{oops");
    const throwsOnRemove: KeyValueStorage = {
      getItem: (key) => blocked.map.get(key) ?? null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredCheckup("demo", throwsOnRemove)).toBeNull();
  });

  it("does nothing at all without storage", () => {
    expect(readStoredCheckup("demo", null)).toBeNull();
    expect(writeStoredCheckup("demo", toStored(answered()), null)).toBe(false);
  });

  it("defaults to the window's storage — absent on the server, refused in private mode", () => {
    // This tier is `environment: node`: there is no window, and the default is
    // "nothing is stored" rather than a crash during a server render.
    expect(readStoredCheckup("demo")).toBeNull();

    vi.stubGlobal("window", {
      get localStorage(): never {
        throw new Error("site data blocked");
      },
    });
    expect(readStoredCheckup("demo")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("localStorageStore", () => {
  it("loads, saves and lists both guest bikes", async () => {
    const storage = memoryStorage();
    const store = localStorageStore("demo", storage);

    expect(await store.load()).toBeNull();
    await store.save(answered());
    expect((await store.load())?.answers[PADS.key]).toBe("ok");

    await localStorageStore("local", storage).save(
      makeState(PLAN, { bikeRef: { kind: "local" }, answers: { [PADS.key]: "ko" } }),
    );
    const list = await store.list();
    expect(list.map((entry) => entry.bikeRef.kind).sort()).toEqual(["demo", "local"]);
    expect(list.map((entry) => entry.answered).sort()).toEqual([1, 2]);
  });

  it("reports a save the browser refused", async () => {
    const store = localStorageStore("demo", memoryStorage({ write: true }));
    await expect(store.save(answered())).rejects.toThrow("va:checkup:demo");
  });

  it("lists a completed checkup with its completion date", async () => {
    const storage = memoryStorage();
    await localStorageStore("demo", storage).save(
      makeState(PLAN, { completedAt: "2026-09-19T09:00:00.000Z" }),
    );
    expect((await localStorageStore("demo", storage).list())[0].completedAt).toBe(
      "2026-09-19T09:00:00.000Z",
    );
  });
});

describe("createServerStore", () => {
  it("delegates to the injected actions and hands them the stored shape", async () => {
    const saved: StoredCheckup[] = [];
    const store = createServerStore({
      load: async () => toStored(answered()),
      save: async (stored) => {
        saved.push(stored);
      },
      list: async () => [],
    });

    expect((await store.load())?.id).toBe(answered().id);
    await store.save(answered());
    expect(saved[0].answers[CHAIN.key]).toBe("ko");
    expect(await store.list()).toEqual([]);
  });
});

describe("createAutosave", () => {
  it("debounces, then writes once", async () => {
    vi.useFakeTimers();
    const saves: number[] = [];
    const onSaved = vi.fn();
    const autosave = createAutosave(
      { load: async () => null, list: async () => [], save: async () => void saves.push(1) },
      { onSaved },
    );

    autosave.schedule(answered());
    autosave.schedule(answered());
    expect(saves).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saves).toHaveLength(1);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("flushes immediately, and a flush with nothing pending writes nothing", async () => {
    const saves: number[] = [];
    const autosave = createAutosave({
      load: async () => null,
      list: async () => [],
      save: async () => void saves.push(1),
    });

    await autosave.flush();
    expect(saves).toHaveLength(0);

    autosave.schedule(answered());
    await autosave.flush();
    expect(saves).toHaveLength(1);
  });

  it("cancels a pending write", async () => {
    vi.useFakeTimers();
    const saves: number[] = [];
    const autosave = createAutosave({
      load: async () => null,
      list: async () => [],
      save: async () => void saves.push(1),
    });

    autosave.schedule(answered());
    autosave.cancel();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(saves).toHaveLength(0);
  });

  it("reports a failed save instead of swallowing it", async () => {
    const onError = vi.fn();
    const autosave = createAutosave(
      {
        load: async () => null,
        list: async () => [],
        save: async () => {
          throw new Error("offline");
        },
      },
      { onError, delay: 1 },
    );

    autosave.schedule(answered());
    await autosave.flush();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("the guest to-fix list", () => {
  const items = deriveBuildList(
    makeState(PLAN, {
      answers: { [CHAIN.key]: "ko" },
      symptoms: { [CHAIN.key]: ["chain-elongation"] },
    }),
  );

  const CHECKUP_ID = "9f2c1d40-5b3e-4a7c-8d21-6e0f4a9b3c55";

  it("round-trips through va:buildlist:<ref>", () => {
    const storage = memoryStorage();
    expect(
      writeGuestBuildList(
        "demo",
        items,
        CHECKUP_ID,
        storage,
        () => new Date("2026-09-19T10:00:00.000Z"),
      ),
    ).toBe(true);
    expect(storage.map.has("va:buildlist:demo")).toBe(true);

    const read = readGuestBuildList("demo", storage);
    expect(read?.updatedAt).toBe("2026-09-19T10:00:00.000Z");
    expect(read?.items).toEqual(items);
    // The checkup that wrote it: what tells a re-run from a later checkup.
    expect(read?.checkupId).toBe(CHECKUP_ID);
  });

  it("stamps the write with the real clock by default", () => {
    const storage = memoryStorage();
    writeGuestBuildList("local", items, CHECKUP_ID, storage);
    expect(Number.isNaN(Date.parse(readGuestBuildList("local", storage)?.updatedAt ?? ""))).toBe(
      false,
    );
  });

  it("is null when there is nothing, when the value is rubbish, or with no storage", () => {
    const storage = memoryStorage();
    expect(readGuestBuildList("demo", storage)).toBeNull();
    storage.map.set("va:buildlist:demo", "[not json");
    expect(readGuestBuildList("demo", storage)).toBeNull();
    storage.map.set("va:buildlist:demo", JSON.stringify({ version: 2, items: [] }));
    expect(readGuestBuildList("demo", storage)).toBeNull();
    expect(readGuestBuildList("demo", null)).toBeNull();
  });

  it("reports a write the browser refused, and does nothing without storage", () => {
    expect(writeGuestBuildList("demo", items, CHECKUP_ID, memoryStorage({ write: true }))).toBe(
      false,
    );
    expect(writeGuestBuildList("demo", items, CHECKUP_ID, null)).toBe(false);
  });
});
