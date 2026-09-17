/**
 * Viewer store and `?part=` / `?parts=` URL sync (§3.3).
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createViewerStore,
  MAX_CONTEXT_LOSSES,
  outlineTargetOf,
  useViewerStore,
  type ViewerStore,
} from "@/components/bike3d/store";
import { bindUrlSync, URL_SYNC_DEBOUNCE_MS } from "@/components/bike3d/url-sync";
import type { PartId } from "@/lib/domain/data/parts";

const AVAILABLE: PartId[] = ["frame", "chain", "saddle", "brake-caliper-front", "brake-pads-front"];

const make = (patch: Partial<Parameters<typeof createViewerStore>[0]> = {}): ViewerStore =>
  createViewerStore({ availablePartIds: AVAILABLE, ...patch });

describe("viewer store", () => {
  it("selects only parts on the bike, bumping focus on request", () => {
    const { api } = make();
    api.getState().select("rear-shock", { source: "list", focus: true });
    expect(api.getState()).toMatchObject({
      selectedPartId: null,
      focusNonce: 0,
      lastSource: "list",
    });
    api.getState().select("chain", { source: "list", focus: true });
    expect(api.getState()).toMatchObject({ selectedPartId: "chain", focusNonce: 1 });
    api.getState().select("saddle", { source: "url" });
    expect(api.getState()).toMatchObject({
      selectedPartId: "saddle",
      focusNonce: 1,
      lastSource: "url",
    });
    expect(outlineTargetOf("brake-pads-front")).toBe("brake-caliper-front");
    expect(outlineTargetOf(null)).toBeNull();
  });

  it("filters the initial state to the bike", () => {
    const { api } = make({ selectedPartId: "rear-shock", pickedPartIds: ["chain", "rear-shock"] });
    expect(api.getState().selectedPartId).toBeNull();
    expect([...api.getState().pickedPartIds]).toEqual(["chain"]);
  });

  it("activation toggles picks only in pick mode", () => {
    const { api } = make();
    api.getState().activate("chain", "canvas");
    expect(api.getState().pickedPartIds.size).toBe(0);
    api.getState().setMode("pick");
    api.getState().activate("chain", "canvas");
    api.getState().activate("saddle", "svg");
    api.getState().togglePick("rear-shock");
    expect([...api.getState().pickedPartIds]).toEqual(["chain", "saddle"]);
    api.getState().setPicked(["frame", "rear-shock"]);
    expect([...api.getState().pickedPartIds]).toEqual(["frame"]);
    api.getState().setMode("pick");
    expect(api.getState().pickedPartIds.size).toBe(1);
    api.getState().setMode("browse");
    expect(api.getState().pickedPartIds.size).toBe(0);
  });

  it("prunes selection, hover and picks when the bike changes", () => {
    const { api } = make({
      mode: "pick",
      pickedPartIds: ["chain", "saddle"],
      selectedPartId: "chain",
    });
    api.getState().hover("chain");
    api.getState().setAvailable(["frame", "saddle"]);
    expect(api.getState()).toMatchObject({ selectedPartId: null, hoveredPartId: null });
    expect([...api.getState().pickedPartIds]).toEqual(["saddle"]);
  });

  it("hover can be disabled (coarse pointers)", () => {
    const { api } = make();
    api.getState().hover("chain");
    api.getState().hover("chain");
    expect(api.getState().hoveredPartId).toBe("chain");
    api.getState().setHoverEnabled(false);
    expect(api.getState().hoveredPartId).toBeNull();
    api.getState().hover("saddle");
    expect(api.getState().hoveredPartId).toBeNull();
    api.getState().setHoverEnabled(true);
    api.getState().hover("saddle");
    expect(api.getState().hoveredPartId).toBe("saddle");
  });

  it("tracks readiness, build time, context losses and scene errors", () => {
    const { api } = make({ quality: "med" });
    expect(api.getState().quality).toBe("med");
    api.getState().setQuality("med");
    api.getState().setReady(true);
    api.getState().setReady(true);
    const buildMs = api.getState().buildMs;
    expect(buildMs).not.toBeNull();
    api.getState().setContextLost(true);
    expect(api.getState()).toMatchObject({ contextLost: true, ready: false, contextLossCount: 1 });
    api.getState().retry3d();
    expect(api.getState().contextLost).toBe(false);
    api.getState().setReady(true);
    expect(api.getState().buildMs).toBe(buildMs);
    for (let i = 1; i < MAX_CONTEXT_LOSSES; i++) api.getState().setContextLost(true);
    api.getState().retry3d();
    expect(api.getState().contextLost).toBe(true);
    api.getState().setContextLost(false);
    expect(api.getState().contextLost).toBe(false);
    api.getState().setSceneError(true);
    expect(api.getState()).toMatchObject({ sceneError: true, ready: false });
    api.getState().setSceneError(false);
    expect(api.getState().sceneError).toBe(false);
  });

  it("counts mounts, contexts, resets and holds the scene bridge outside state", () => {
    const store = make();
    const { api } = store;
    api.getState().noteMount();
    api.getState().noteContextCreated();
    api.getState().requestReset();
    api.getState().setRotateMode(true);
    api.getState().setStatus({ chain: "ko" });
    expect(api.getState()).toMatchObject({
      mountCount: 1,
      contextCreations: 1,
      resetNonce: 1,
      rotateMode: true,
      status: { chain: "ko" },
    });

    expect(store.getBridge()).toBeNull();
    store.patchBridge({ controls: 1 });
    expect(store.getBridge()).toBeNull();
    const frameTimes = [16];
    store.setBridge({
      gl: 1,
      scene: 2,
      camera: 3,
      controls: null,
      invalidate: () => {},
      frameTimes,
      canvas: document.createElement("canvas"),
    });
    store.patchBridge({ controls: "cc", frameTimes: [] });
    expect(store.getBridge()).toMatchObject({ controls: "cc", gl: 1 });
    expect(store.getBridge()!.frameTimes).toBe(frameTimes);
    store.setBridge(null);
    expect(store.getBridge()).toBeNull();
  });

  it("useViewerStore outside a provider is a programming error", () => {
    function Orphan() {
      useViewerStore((state) => state.ready);
      return null;
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/ViewerStoreProvider/);
    consoleError.mockRestore();
  });
});

describe("url sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({ keep: true }, "", "/fr/velo/demo?step=3#panel");
  });
  afterEach(() => vi.useRealTimers());

  it("debounces ?part= / ?parts= into replaceState, keeping other params, state and hash", () => {
    const { api } = make({ mode: "pick" });
    const replace = vi.spyOn(window.history, "replaceState");
    const stop = bindUrlSync(api);

    api.getState().select("chain", { source: "canvas" });
    api.getState().select("saddle", { source: "canvas" });
    api.getState().togglePick("chain");
    expect(replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(URL_SYNC_DEBOUNCE_MS);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/fr/velo/demo?step=3&part=saddle&parts=chain#panel",
    );
    expect(window.history.state).toEqual({ keep: true });

    // A change that does not touch the URL fields writes nothing.
    api.getState().setQuality("low");
    vi.advanceTimersByTime(URL_SYNC_DEBOUNCE_MS);
    expect(replace).toHaveBeenCalledTimes(1);

    // Same URL → no write.
    api.getState().select("saddle", { source: "canvas" });
    vi.advanceTimersByTime(URL_SYNC_DEBOUNCE_MS);
    expect(replace).toHaveBeenCalledTimes(1);

    api.getState().select(null, { source: "canvas" });
    api.getState().togglePick("chain");
    vi.advanceTimersByTime(URL_SYNC_DEBOUNCE_MS);
    expect(window.location.search).toBe("?step=3");
    stop();
    replace.mockRestore();
  });

  it("reads the URL back on popstate without a camera move, dropping junk", () => {
    const { api } = make({ mode: "pick" });
    const stop = bindUrlSync(api);
    window.history.pushState(null, "", "/fr/velo/demo?part=chain&parts=saddle,__proto__,frame");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(api.getState()).toMatchObject({
      selectedPartId: "chain",
      lastSource: "url",
      focusNonce: 0,
    });
    expect([...api.getState().pickedPartIds]).toEqual(["saddle", "frame"]);
    // Applying the URL does not schedule a write of the same URL.
    const replace = vi.spyOn(window.history, "replaceState");
    vi.advanceTimersByTime(URL_SYNC_DEBOUNCE_MS);
    expect(replace).not.toHaveBeenCalled();

    window.history.pushState(null, "", "/fr/velo/demo?part=%3Cscript%3E");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(api.getState().selectedPartId).toBeNull();
    stop();
    replace.mockRestore();
  });

  it("flushes a pending write when unbound, then stops listening", () => {
    const { api } = make();
    const stop = bindUrlSync(api);
    api.getState().select("frame", { source: "list" });
    stop();
    expect(window.location.search).toBe("?step=3&part=frame");
    window.history.pushState(null, "", "/fr/velo/demo?part=chain");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(api.getState().selectedPartId).toBe("frame");
    const again = bindUrlSync(api);
    again();
  });
});
