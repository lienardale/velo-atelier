/**
 * `?part=` / `?parts=` ↔ viewer store (§3.3).
 *
 * The App Router has no shallow routing, so the URL is written with
 * `history.replaceState` (debounced 100 ms) — never `router.replace`, which
 * would fetch an RSC payload per selection. `popstate` reads the URL back
 * through the hand-written guards of `lib/bike3d/query.ts` and selects with
 * `source: 'url'` and no camera move. There is no `useSearchParams` in the
 * viewer: the host page reads `await searchParams` and passes `initialPartId`.
 */
import type { StoreApi } from "zustand/vanilla";

import { parsePartId, parsePartIds, withViewerParams } from "@/lib/bike3d/query";

import type { ViewerState } from "./store";

export const URL_SYNC_DEBOUNCE_MS = 100;

type HistoryWindow = Pick<
  Window,
  | "location"
  | "history"
  | "addEventListener"
  | "removeEventListener"
  | "setTimeout"
  | "clearTimeout"
>;

export function bindUrlSync(
  api: StoreApi<ViewerState>,
  win: HistoryWindow = window,
  debounceMs = URL_SYNC_DEBOUNCE_MS,
): () => void {
  let timer: number | null = null;
  let applyingUrl = false;

  const write = () => {
    timer = null;
    const { selectedPartId, pickedPartIds } = api.getState();
    const next = withViewerParams(win.location.href, selectedPartId, [...pickedPartIds]);
    const current = `${win.location.pathname}${win.location.search}${win.location.hash}`;
    if (next !== current) win.history.replaceState(win.history.state, "", next);
  };

  const unsubscribe = api.subscribe((state, previous) => {
    if (applyingUrl) return;
    if (
      state.selectedPartId === previous.selectedPartId &&
      state.pickedPartIds === previous.pickedPartIds
    ) {
      return;
    }
    if (timer !== null) win.clearTimeout(timer);
    timer = win.setTimeout(write, debounceMs);
  });

  const onPopState = () => {
    const params = new URL(win.location.href).searchParams;
    applyingUrl = true;
    try {
      const state = api.getState();
      state.select(parsePartId(params.get("part")), { source: "url", focus: false });
      state.setPicked(parsePartIds(params.get("parts")));
    } finally {
      applyingUrl = false;
    }
  };
  win.addEventListener("popstate", onPopState);

  return () => {
    unsubscribe();
    if (timer !== null) {
      win.clearTimeout(timer);
      write();
    }
    win.removeEventListener("popstate", onPopState);
  };
}
