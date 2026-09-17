import { describe, expect, it } from "vitest";

import {
  capsTier,
  createGovernor,
  dprFor,
  GOVERNOR,
  governorStep,
  initialQuality,
  isQualityTier,
  outlinesFor,
  persistQuality,
  QUALITY_STORAGE_KEY,
  readCapsEnv,
  readPersistedQuality,
  windowFps,
  type GovernorState,
} from "./quality";

const desktop = { coarsePointer: false, deviceMemory: 8, saveData: false };

describe("initial tier", () => {
  it("coarse pointer → med; low memory or save-data → low; else high", () => {
    expect(capsTier(desktop)).toBe("high");
    expect(capsTier({ ...desktop, deviceMemory: null })).toBe("high");
    expect(capsTier({ ...desktop, coarsePointer: true })).toBe("med");
    expect(capsTier({ ...desktop, deviceMemory: 2 })).toBe("low");
    expect(capsTier({ ...desktop, coarsePointer: true, saveData: true })).toBe("low");
  });

  it("a persisted tier wins, but never above med on a coarse pointer", () => {
    expect(initialQuality(desktop, "low")).toBe("low");
    expect(initialQuality(desktop, "junk")).toBe("high");
    expect(initialQuality({ ...desktop, coarsePointer: true }, "high")).toBe("med");
    expect(initialQuality({ ...desktop, coarsePointer: true }, "low")).toBe("low");
    expect(initialQuality({ ...desktop, deviceMemory: 1 }, null)).toBe("low");
  });

  it("guards tier values", () => {
    expect(isQualityTier("med")).toBe(true);
    expect(isQualityTier("ultra")).toBe(false);
    expect(isQualityTier(undefined)).toBe(false);
  });
});

describe("render levers", () => {
  it("caps the DPR per tier", () => {
    expect(dprFor("low", 3)).toBe(1);
    expect(dprFor("med", 3)).toBe(1.5);
    expect(dprFor("med", 1)).toBe(1);
    expect(dprFor("high", 3)).toBe(2);
    expect(dprFor("high", Number.NaN)).toBe(1);
    expect(dprFor("high", 0)).toBe(1);
  });

  it("outlines only at the high tier", () => {
    expect(outlinesFor("high")).toBe(true);
    expect(outlinesFor("med")).toBe(false);
    expect(outlinesFor("low")).toBe(false);
  });
});

describe("governor", () => {
  const run = (state: GovernorState, samples: Array<number | null>) =>
    samples.reduce((s, fps) => governorStep(s, fps), state);

  it("discards windows shorter than 500 ms", () => {
    expect(windowFps(10, 499)).toBeNull();
    expect(windowFps(30, 500)).toBe(60);
    expect(windowFps(-1, 900)).toBeNull();
    const start = createGovernor("high", false);
    expect(governorStep(start, null)).toBe(start);
  });

  it("lowers after two slow windows", () => {
    const start = createGovernor("high", false);
    expect(run(start, [30]).tier).toBe("high");
    const lowered = run(start, [30, 30]);
    expect(lowered).toMatchObject({ tier: "med", flips: 1, slowWindows: 0 });
  });

  it("a window in the comfortable band resets both counters", () => {
    const start = createGovernor("high", false);
    expect(run(start, [30, 50, 30]).tier).toBe("high");
    expect(run(start, [30, 50, 30])).toMatchObject({ slowWindows: 1, fastWindows: 0 });
    expect(run(createGovernor("low", false), [59, 59, 45, 59]).tier).toBe("low");
  });

  it("raises after three fast windows, up to high on a fine pointer", () => {
    const start = createGovernor("low", false);
    expect(run(start, [60, 60]).tier).toBe("low");
    expect(run(start, [60, 60, 60]).tier).toBe("med");
    expect(run(start, [30, 60, 60, 60])).toMatchObject({ tier: "med", slowWindows: 0 });
  });

  it("never rises above the initial tier on a coarse pointer", () => {
    const start = createGovernor("med", true);
    const lowered = run(start, [20, 20]);
    expect(lowered.tier).toBe("low");
    expect(run(lowered, [60, 60, 60]).tier).toBe("med");
    expect(run(start, [60, 60, 60, 60, 60, 60]).tier).toBe("med");
  });

  it("flips at most twice per session and never below low", () => {
    const start = createGovernor("high", false);
    const twice = run(start, [20, 20, 20, 20]);
    expect(twice).toMatchObject({ tier: "low", flips: GOVERNOR.maxFlips });
    expect(run(twice, [60, 60, 60, 60, 60, 60]).tier).toBe("low");
    const floor = run(createGovernor("low", false), [10, 10, 10]);
    expect(floor).toMatchObject({ tier: "low", flips: 0 });
  });
});

describe("environment", () => {
  const fakeWindow = (matches: Record<string, boolean>, nav: object, dpr = 2) =>
    ({
      navigator: nav,
      devicePixelRatio: dpr,
      matchMedia: (query: string) => ({ matches: matches[query] ?? false }),
    }) as unknown as Window;

  it("reads media queries and device hints", () => {
    const win = fakeWindow(
      { "(pointer: coarse)": true, "(prefers-reduced-motion: reduce)": true },
      { deviceMemory: 4, connection: { saveData: true } },
    );
    expect(readCapsEnv(win, true)).toEqual({
      webgl2: true,
      coarsePointer: true,
      reducedMotion: true,
      deviceMemory: 4,
      saveData: true,
      devicePixelRatio: 2,
    });
  });

  it("tolerates missing hints and matchMedia", () => {
    const win = { navigator: {}, devicePixelRatio: 0 } as unknown as Window;
    expect(readCapsEnv(win, false)).toEqual({
      webgl2: false,
      coarsePointer: false,
      reducedMotion: false,
      deviceMemory: null,
      saveData: false,
      devicePixelRatio: 1,
    });
  });

  it("persists and reads the tier, surviving hostile storage", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    };
    expect(readPersistedQuality(storage)).toBeNull();
    persistQuality(storage, "low");
    expect(map.get(QUALITY_STORAGE_KEY)).toBe("low");
    expect(readPersistedQuality(storage)).toBe("low");
    map.set(QUALITY_STORAGE_KEY, "<script>");
    expect(readPersistedQuality(storage)).toBeNull();

    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readPersistedQuality(throwing)).toBeNull();
    expect(() => persistQuality(throwing, "high")).not.toThrow();
    expect(readPersistedQuality(null)).toBeNull();
    expect(() => persistQuality(undefined, "high")).not.toThrow();
  });
});
