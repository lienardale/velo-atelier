/**
 * Small pure helpers: hashing, vectors, highlight precedence, materials, the
 * sample builds and the e2e hook installer.
 */
import { describe, expect, it } from "vitest";

import { installE2EHooks, type VaTestHooks } from "@/lib/testing/e2e-hooks";

import { enumerateBuilds, PRESET_BUILDS } from "./builds";
import { canonicalJson, fnv1a, hashOf } from "./hash";
import {
  highlightTarget,
  isPickedMesh,
  meshStatus,
  resolveMaterialKey,
  type HighlightState,
} from "./highlight";
import {
  applyPalette,
  DEFAULT_PALETTE,
  MATERIAL_KEYS,
  materialCount,
  materialFor,
  readPalette,
  resetMaterials,
} from "./materials";
import {
  add,
  boundsOf,
  distance,
  isFiniteVec,
  lerp,
  normalize,
  offset,
  round,
  scale,
  sub,
  withZ,
} from "./vec";

describe("hash", () => {
  it("is independent of key order and ignores undefined", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: undefined, c: null }] })).toBe(
      '{"a":[1,{"c":null}],"b":1}',
    );
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
    expect(canonicalJson(undefined)).toBe("null");
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("vec", () => {
  it("does the arithmetic", () => {
    expect(add([1, 2, 3], [1, 1, 1])).toEqual([2, 3, 4]);
    expect(sub([1, 2, 3], [1, 1, 1])).toEqual([0, 1, 2]);
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
    expect(distance([0, 0, 0], [3, 4, 0])).toBe(5);
    expect(lerp([0, 0, 0], [2, 2, 2], 0.5)).toEqual([1, 1, 1]);
    expect(withZ([1, 2, 3], 9)).toEqual([1, 2, 9]);
    expect(offset([1, 1, 1], 1, 2, 3)).toEqual([2, 3, 4]);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
    expect(round(normalize([0, 3, 4]))).toEqual([0, 0.6, 0.8]);
    expect(isFiniteVec([0, Number.NaN, 0])).toBe(false);
    expect(round([0.1234567, -0.0000001, 1], 3)).toEqual([0.123, 0, 1]);
    expect(
      boundsOf([
        [0, 5, -1],
        [2, -1, 3],
      ]),
    ).toEqual({ min: [0, -1, -1], max: [2, 5, 3] });
  });
});

describe("highlight precedence: hover > selected > status > picked > base", () => {
  const state = (patch: Partial<HighlightState>): HighlightState => ({
    hoveredPartId: null,
    selectedPartId: null,
    pickedPartIds: new Set(),
    status: undefined,
    ...patch,
  });

  it("resolves each layer", () => {
    const all = state({
      hoveredPartId: "saddle",
      selectedPartId: "saddle",
      status: { saddle: "ko" },
      pickedPartIds: new Set(["saddle"]),
    });
    expect(resolveMaterialKey("rubber", "saddle", all)).toBe("highlightHover");
    expect(resolveMaterialKey("rubber", "saddle", { ...all, hoveredPartId: null })).toBe(
      "highlightSelected",
    );
    expect(
      resolveMaterialKey("rubber", "saddle", { ...all, hoveredPartId: null, selectedPartId: null }),
    ).toBe("statusKo");
    expect(
      resolveMaterialKey(
        "rubber",
        "saddle",
        state({ status: { saddle: "ok" }, pickedPartIds: new Set(["saddle"]) }),
      ),
    ).toBe("statusOk");
    expect(
      resolveMaterialKey(
        "rubber",
        "saddle",
        state({ status: { saddle: "todo" }, pickedPartIds: new Set(["saddle"]) }),
      ),
    ).toBe("highlightPicked");
    expect(resolveMaterialKey("rubber", "saddle", state({}))).toBe("rubber");
  });

  it("lights the host of a hosted part", () => {
    expect(highlightTarget("brake-pads-front")).toBe("brake-caliper-front");
    expect(highlightTarget(null)).toBeNull();
    expect(
      resolveMaterialKey(
        "alu",
        "brake-caliper-front",
        state({ selectedPartId: "brake-pads-front" }),
      ),
    ).toBe("highlightSelected");
    expect(
      meshStatus("brake-caliper-front", { "brake-caliper-front": "ok", "brake-pads-front": "ko" }),
    ).toBe("ko");
    expect(meshStatus("brake-caliper-front", { "brake-pads-front": "ok", saddle: "ko" })).toBe(
      "ok",
    );
    // An OWN `__proto__` key (a literal `{ __proto__: "ko" }` sets no key at all:
    // a string cannot be a prototype, so that object was empty — CodeQL #11).
    const poisoned = {};
    Object.defineProperty(poisoned, "__proto__", { value: "ko", enumerable: true });
    expect(Object.keys(poisoned)).toEqual(["__proto__"]);
    expect(meshStatus("frame", poisoned as never)).toBeNull();
    expect(meshStatus("frame", undefined)).toBeNull();
    expect(isPickedMesh("tire-rear", new Set(["sealant"]))).toBe(true);
    expect(isPickedMesh("tire-rear", new Set(["saddle"]))).toBe(false);
  });
});

describe("materials", () => {
  it("creates at most 12 singletons, stable by key", () => {
    resetMaterials();
    expect(materialCount()).toBe(0);
    const paint = materialFor("paint");
    expect(materialFor("paint")).toBe(paint);
    expect(materialCount()).toBe(12);
    expect(MATERIAL_KEYS).toHaveLength(12);
    expect(new Set(MATERIAL_KEYS.map((key) => materialFor(key))).size).toBe(12);
    expect(materialFor("statusKo").color.getHexString()).toBe(DEFAULT_PALETTE.danger.slice(1));
  });

  it("recolours overlays in place from the palette", () => {
    const selected = materialFor("highlightSelected");
    const paint = materialFor("paint").color.getHexString();
    applyPalette({ ...DEFAULT_PALETTE, accent: "#7db6df", warn: "#e08a3c" });
    expect(materialFor("highlightSelected")).toBe(selected);
    expect(selected.color.getHexString()).toBe("7db6df");
    expect(materialFor("highlightPicked").emissive.getHexString()).toBe("e08a3c");
    expect(materialFor("paint").color.getHexString()).toBe(paint);
    resetMaterials();
    applyPalette(DEFAULT_PALETTE);
    expect(materialCount()).toBe(12);
    resetMaterials();
  });

  it("reads CSS tokens, falling back per token", () => {
    const style = {
      getPropertyValue: (name: string) =>
        ({
          "--color-accent": " #7db6df ",
          "--color-danger": "rgb(224, 103, 91)",
          "--color-warn": "url(evil)",
        })[name] ?? "",
    };
    expect(readPalette(style)).toEqual({
      ...DEFAULT_PALETTE,
      accent: "#7db6df",
      danger: "rgb(224, 103, 91)",
    });
    expect(readPalette(null)).toEqual(DEFAULT_PALETTE);
  });
});

describe("sample builds", () => {
  it("cover the presets and a deduplicated spec space", () => {
    expect(PRESET_BUILDS).toHaveLength(7);
    const builds = enumerateBuilds();
    expect(new Set(builds.map((b) => hashOf(b.spec))).size).toBe(builds.length);
    expect(new Set(builds.map((b) => b.spec.discipline)).size).toBe(5);
  });
});

describe("installE2EHooks", () => {
  it("installs on window.__va and uninstalls only its own hooks", () => {
    const win = {} as Window & { __va?: VaTestHooks };
    const hooks = { bike: {}, perf: {} } as VaTestHooks;
    const uninstall = installE2EHooks(hooks, win);
    expect(win.__va).toBe(hooks);
    const newer = { bike: {}, perf: {} } as VaTestHooks;
    const uninstallNewer = installE2EHooks(newer, win);
    uninstall();
    expect(win.__va).toBe(newer);
    uninstallNewer();
    expect(win.__va).toBeUndefined();
  });
});
