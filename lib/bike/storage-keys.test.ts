import { describe, expect, it } from "vitest";

import {
  BIKE3D_QUALITY_KEY,
  buildListKey,
  checkupKey,
  guestDataKeys,
  isMeasureKey,
  LOCAL_BIKE_KEY,
  measureKey,
  STORAGE_PREFIX,
} from "./storage-keys";

describe("guest storage keys (§1.2)", () => {
  it("spells every key exactly as the contract does", () => {
    expect(LOCAL_BIKE_KEY).toBe("va:bike:local");
    expect(checkupKey("demo")).toBe("va:checkup:demo");
    expect(checkupKey("local")).toBe("va:checkup:local");
    expect(buildListKey("demo")).toBe("va:buildlist:demo");
    expect(buildListKey("local")).toBe("va:buildlist:local");
    expect(measureKey("saddle-height")).toBe("va:measure:saddle-height");
    expect(BIKE3D_QUALITY_KEY).toBe("va:bike3d:quality");
  });

  it("keeps the header link and the guide filter on the same key", async () => {
    const [{ LOCAL_BIKE_STORAGE_KEY }, { LOCAL_BIKE_KEY: filterKey }] = await Promise.all([
      import("@/components/layout/MyBikeLink"),
      import("@/lib/content/filter"),
    ]);
    expect(LOCAL_BIKE_STORAGE_KEY).toBe(LOCAL_BIKE_KEY);
    expect(filterKey).toBe(LOCAL_BIKE_KEY);
  });

  it("lists the guest data keys the import reads and clears", () => {
    expect(guestDataKeys()).toEqual([
      "va:bike:local",
      "va:checkup:demo",
      "va:checkup:local",
      "va:buildlist:demo",
      "va:buildlist:local",
    ]);
    for (const key of guestDataKeys()) expect(key.startsWith(STORAGE_PREFIX)).toBe(true);
  });

  it("refuses a measure id that could smuggle another key", () => {
    for (const bad of ["", "Saddle", "a:b", "../x", "a".repeat(65), "bike:local"]) {
      expect(() => measureKey(bad)).toThrow(/invalid measure id/);
    }
  });

  it("recognises measure keys and nothing else", () => {
    expect(isMeasureKey("va:measure:reach")).toBe(true);
    expect(isMeasureKey("va:measure:")).toBe(false);
    expect(isMeasureKey("va:bike:local")).toBe(false);
    expect(isMeasureKey("xva:measure:reach")).toBe(false);
  });
});
