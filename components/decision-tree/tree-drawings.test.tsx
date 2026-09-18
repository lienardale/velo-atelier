/**
 * The store that fetches the decision tree's shapes (`.debug/007`).
 *
 * `tests/setup.dom.ts` primes it empty for every other jsdom test, so this is
 * the one place the fetch itself is exercised: one request for all the
 * drawings however many mount, and a failure that costs decoration rather than
 * the page.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrawingNode } from "@/components/illustrations/tree-drawing-node";

import {
  loadTreeDrawings,
  primeTreeDrawings,
  resetTreeDrawings,
  TREE_DRAWINGS_URL,
  useTreeDrawing,
} from "./tree-drawings";

const CIRCLE: DrawingNode = { t: "circle", a: { cx: "1", cy: "1", r: "1" } };
const GEOMETRY = { "ill-drive": [CIRCLE] };

/** What a mounted `TreeDrawing` would see for `id`. */
function drawingOf(id: string): readonly DrawingNode[] {
  return renderHook(() => useTreeDrawing(id)).result.current;
}

beforeEach(() => {
  resetTreeDrawings();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  primeTreeDrawings({});
});

describe("tree drawings store", () => {
  it("fetches the map once, however many drawings ask for it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(GEOMETRY) });
    vi.stubGlobal("fetch", fetchMock);

    expect(drawingOf("ill-drive")).toEqual([]);
    loadTreeDrawings();
    loadTreeDrawings();
    loadTreeDrawings();
    await vi.waitFor(() => expect(drawingOf("ill-drive")).toEqual([CIRCLE]));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(TREE_DRAWINGS_URL);
  });

  it("leaves every drawing empty when the request fails, and does not throw", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    loadTreeDrawings();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(drawingOf("ill-drive")).toEqual([]);
  });

  it("leaves every drawing empty on a non-ok response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.resolve(GEOMETRY) });
    vi.stubGlobal("fetch", fetchMock);
    loadTreeDrawings();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(drawingOf("ill-drive")).toEqual([]);
  });

  it("reports an id the map does not carry as empty", () => {
    primeTreeDrawings(GEOMETRY);
    expect(drawingOf("ill-discipline")).toEqual([]);
    expect(drawingOf("ill-drive")).toEqual([CIRCLE]);
  });
});
