/**
 * Viewer state — one zustand 5 vanilla store per `BikeViewer`, shared through
 * React context (R3F bridges it into the `<Canvas>` tree).
 *
 * Reactive state drives rendering (selection, hover, picks, quality, ready,
 * context loss). The `bridge` is deliberately NOT state: the lazy scene
 * registers its renderer, scene, camera and controls there for the camera rig
 * and the build-gated test hooks, without re-rendering anyone.
 */
"use client";

import { createContext, createElement, useContext, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import { clickTargetOf, type PartId } from "@/lib/domain/data/parts";
import type { PartStatus, QualityTier, SelectSource, ViewerMode } from "@/lib/bike3d/types";

export interface SelectOptions {
  focus?: boolean;
  source: SelectSource;
}

/** What the lazy scene registers (typed loosely so this module stays three-free). */
export interface SceneBridge {
  gl: unknown;
  scene: unknown;
  camera: unknown;
  controls: unknown;
  invalidate: () => void;
  /** Frame durations in ms, most recent last (bounded). */
  frameTimes: number[];
  canvas: HTMLCanvasElement;
}

export interface ViewerState {
  selectedPartId: PartId | null;
  hoveredPartId: PartId | null;
  pickedPartIds: ReadonlySet<PartId>;
  mode: ViewerMode;
  quality: QualityTier;
  ready: boolean;
  contextLost: boolean;
  contextLossCount: number;
  sceneError: boolean;
  focusNonce: number;
  resetNonce: number;
  lastSource: SelectSource | null;
  status: Partial<Record<PartId, PartStatus>> | undefined;
  /** Parts on the current build (hosted ones included): selection is pruned to these. */
  availablePartIds: ReadonlySet<PartId>;
  hoverEnabled: boolean;
  rotateMode: boolean;
  mountCount: number;
  contextCreations: number;
  buildStartedAt: number;
  buildMs: number | null;

  select(id: PartId | null, options: SelectOptions): void;
  /** A tap / click on a part in the canvas or the SVG. */
  activate(id: PartId, source: "canvas" | "svg"): void;
  hover(id: PartId | null): void;
  togglePick(id: PartId): void;
  setPicked(ids: Iterable<PartId>): void;
  setMode(mode: ViewerMode): void;
  setQuality(quality: QualityTier): void;
  setReady(ready: boolean): void;
  setContextLost(lost: boolean): void;
  setSceneError(error: boolean): void;
  retry3d(): void;
  setStatus(status: ViewerState["status"]): void;
  setAvailable(ids: Iterable<PartId>): void;
  setHoverEnabled(enabled: boolean): void;
  setRotateMode(on: boolean): void;
  requestReset(): void;
  noteMount(): void;
  noteContextCreated(): void;
}

export interface ViewerStoreInit {
  selectedPartId?: PartId | null;
  pickedPartIds?: readonly PartId[];
  mode?: ViewerMode;
  quality?: QualityTier;
  status?: ViewerState["status"];
  availablePartIds: readonly PartId[];
}

export interface ViewerStore {
  api: StoreApi<ViewerState>;
  /** Read the bridge the lazy scene registered (null until the canvas exists). */
  getBridge(): SceneBridge | null;
  /** Register, update (partial) or clear the bridge. Not reactive by design. */
  setBridge(bridge: SceneBridge | null): void;
  patchBridge(patch: Partial<SceneBridge>): void;
}

/** Losses after which the viewer stays on the SVG (§3.3). */
export const MAX_CONTEXT_LOSSES = 2;

export function createViewerStore(init: ViewerStoreInit): ViewerStore {
  const available = new Set(init.availablePartIds);
  const keep = (id: PartId | null | undefined) => (id && available.has(id) ? id : null);

  const api = createStore<ViewerState>()((set, get) => ({
    selectedPartId: keep(init.selectedPartId),
    hoveredPartId: null,
    pickedPartIds: new Set((init.pickedPartIds ?? []).filter((id) => available.has(id))),
    mode: init.mode ?? "browse",
    quality: init.quality ?? "high",
    ready: false,
    contextLost: false,
    contextLossCount: 0,
    sceneError: false,
    focusNonce: 0,
    resetNonce: 0,
    lastSource: null,
    status: init.status,
    availablePartIds: available,
    hoverEnabled: true,
    rotateMode: false,
    mountCount: 0,
    contextCreations: 0,
    buildStartedAt: typeof performance === "undefined" ? 0 : performance.now(),
    buildMs: null,

    select(id, { focus = false, source }) {
      const next = id !== null && get().availablePartIds.has(id) ? id : null;
      set((state) => ({
        selectedPartId: next,
        lastSource: source,
        focusNonce: focus && next !== null ? state.focusNonce + 1 : state.focusNonce,
      }));
    },

    activate(id, source) {
      const state = get();
      if (state.mode === "pick") state.togglePick(id);
      state.select(id, { source, focus: false });
    },

    hover(id) {
      if (!get().hoverEnabled && id !== null) return;
      if (get().hoveredPartId !== id) set({ hoveredPartId: id });
    },

    togglePick(id) {
      if (!get().availablePartIds.has(id)) return;
      const picked = new Set(get().pickedPartIds);
      if (picked.has(id)) picked.delete(id);
      else picked.add(id);
      set({ pickedPartIds: picked });
    },

    setPicked(ids) {
      const available = get().availablePartIds;
      set({ pickedPartIds: new Set([...ids].filter((id) => available.has(id))) });
    },

    setMode(mode) {
      if (get().mode === mode) return;
      set(mode === "browse" ? { mode, pickedPartIds: new Set() } : { mode });
    },

    setQuality(quality) {
      if (get().quality !== quality) set({ quality });
    },

    setReady(ready) {
      const state = get();
      if (state.ready === ready) return;
      set({
        ready,
        buildMs:
          ready && state.buildMs === null && typeof performance !== "undefined"
            ? performance.now() - state.buildStartedAt
            : state.buildMs,
      });
    },

    setContextLost(lost) {
      set((state) =>
        lost
          ? { contextLost: true, ready: false, contextLossCount: state.contextLossCount + 1 }
          : { contextLost: false },
      );
    },

    setSceneError(error) {
      set(error ? { sceneError: true, ready: false } : { sceneError: false });
    },

    retry3d() {
      const state = get();
      if (state.contextLossCount >= MAX_CONTEXT_LOSSES) return;
      set({ contextLost: false, sceneError: false });
    },

    setStatus(status) {
      set({ status });
    },

    setAvailable(ids) {
      const next = new Set(ids);
      const state = get();
      const prune = (id: PartId | null) => (id !== null && next.has(id) ? id : null);
      set({
        availablePartIds: next,
        selectedPartId: prune(state.selectedPartId),
        hoveredPartId: prune(state.hoveredPartId),
        pickedPartIds: new Set([...state.pickedPartIds].filter((id) => next.has(id))),
      });
    },

    setHoverEnabled(enabled) {
      set(enabled ? { hoverEnabled: true } : { hoverEnabled: false, hoveredPartId: null });
    },

    setRotateMode(on) {
      set({ rotateMode: on });
    },

    requestReset() {
      set((state) => ({ resetNonce: state.resetNonce + 1 }));
    },

    noteMount() {
      set((state) => ({ mountCount: state.mountCount + 1 }));
    },

    noteContextCreated() {
      set((state) => ({ contextCreations: state.contextCreations + 1 }));
    },
  }));

  let bridge: SceneBridge | null = null;
  return {
    api,
    getBridge: () => bridge,
    setBridge: (next) => {
      bridge = next;
    },
    patchBridge: (patch) => {
      if (bridge) bridge = { ...bridge, ...patch, frameTimes: bridge.frameTimes };
    },
  };
}

/** The mesh-bearing part that carries the selection outline. */
export const outlineTargetOf = (id: PartId | null): PartId | null =>
  id ? clickTargetOf(id) : null;

const ViewerStoreContext = createContext<ViewerStore | null>(null);

export function ViewerStoreProvider({
  store,
  children,
}: {
  store: ViewerStore;
  children: ReactNode;
}): React.JSX.Element {
  return createElement(ViewerStoreContext.Provider, { value: store }, children);
}

/** The surrounding viewer store, or `null` outside a provider. */
export function useMaybeViewerStoreApi(): ViewerStore | null {
  return useContext(ViewerStoreContext);
}

export function useViewerStoreApi(): ViewerStore {
  const store = useContext(ViewerStoreContext);
  if (!store) throw new Error("useViewerStore must be used inside <ViewerStoreProvider>");
  return store;
}

export function useViewerStore<T>(selector: (state: ViewerState) => T): T {
  return useStore(useViewerStoreApi().api, selector);
}

/** Create a store once per component instance. */
export function useCreateViewerStore(init: () => ViewerStoreInit): ViewerStore {
  const [store] = useState(() => createViewerStore(init()));
  return store;
}
