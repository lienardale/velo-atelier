"use client";

import { useSyncExternalStore } from "react";

/**
 * The document URL's query string, as a value a component can render — with an
 * **empty server snapshot**, which is the whole point.
 *
 * The decision tree's state lives in the query (`tree-state.ts`). It used to
 * read it with `useSearchParams()` during render, which on a static route puts
 * the reader under a `<Suspense>` boundary: React prerenders the fallback,
 * throws its DOM away when the real subtree arrives, and BUILDS that subtree on
 * the client instead of hydrating it. On the home page that second render was a
 * long task of its own and the 7 % `/fr` and `/en` were over their 300 ms TBT
 * budget by (`.debug/008` measured it, `.debug/011` removed it).
 *
 * Reading it here instead lets the whole tree be prerendered into the document
 * and hydrated once. The server has no URL, so `getServerSnapshot` returns `""`
 * and the prerendered HTML — and the first client render, which must match it —
 * is the landing screen; React re-reads the real value once hydration is done,
 * which costs nothing on `/fr` itself and one render on a deep link.
 *
 * Same shape as `tree-drawings.ts`, and for the same reason: a browser-only
 * value with a server snapshot is what `useSyncExternalStore` is for, and it
 * says so in one place instead of an effect that sets state on mount.
 *
 * **Subscribing.** `popstate` covers the browser's back and forward buttons.
 * Nothing else fires: `history.pushState` / `replaceState` — how the tree
 * writes an answer, and how the App Router writes a soft navigation — are
 * silent by specification, so whoever calls them says so with
 * `notifyLocationSearchChanged()`. `RouterSearch` is how the router's own
 * writes reach that call.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

/** Tell every reader to look at `window.location` again, after a history write. */
export function notifyLocationSearchChanged(): void {
  for (const listener of listeners) listener();
}

/** `window.location.search` (with its leading `?`, or `""`), and `""` on the server. */
export function useLocationSearch(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
}
