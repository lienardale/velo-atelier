"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The media queries the layout branches on (§6.4, §6.5). They live here, in one
 * place, so a breakpoint is never re-typed as a magic string: the responsive
 * audit convention tests both sides of every breakpoint (767/768, 1023/1024),
 * which only works if the component and the test read the same constant.
 */
export const MEDIA = {
  /** Tablet and up: guide TOCs expand, the header shows its full nav. */
  tablet: "(min-width: 768px)",
  /** Desktop: the bike workspace becomes viewer + docked panel, no bottom sheet. */
  desktop: "(min-width: 1024px)",
  /** A phone held sideways — too short for a bottom sheet (§6.4). */
  shortViewport: "(max-height: 500px)",
  /** Touch input: hover-only chrome is dropped, tap targets stay 44 px. */
  coarsePointer: "(hover: none), (pointer: coarse)",
  /** The user asked their OS for less motion. */
  reducedMotion: "(prefers-reduced-motion: reduce)",
} as const;

/**
 * Subscribe to a CSS media query.
 *
 * `useSyncExternalStore` (not `useState` + `useEffect`) so that:
 *   - the server and the first client render agree on `serverValue`, which
 *     keeps hydration silent — a layout that guessed "mobile" on the server and
 *     "desktop" on the client would otherwise log a mismatch on every desktop;
 *   - React re-reads the query when it re-subscribes, so a query that changed
 *     between render and effect is never missed.
 *
 * `serverValue` is what the hook reports before the browser has been asked
 * (SSR, and any environment without `matchMedia`). Default `false` — the
 * mobile-first answer for `min-width` queries and the safe answer for
 * `prefers-reduced-motion`.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = mediaQueryList(query);
      if (!list) return () => {};
      list.addEventListener("change", onStoreChange);
      return () => list.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => mediaQueryList(query)?.matches ?? serverValue,
    [query, serverValue],
  );

  const getServerSnapshot = useCallback(() => serverValue, [serverValue]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** `window.matchMedia(query)`, or `null` outside a browser (SSR, plain-node tests). */
function mediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
}

/** `true` from 1024 px up — the width at which the bike workspace docks its panel. */
export function useIsDesktop(): boolean {
  return useMediaQuery(MEDIA.desktop);
}

/** `true` on a touch screen, where hover-only affordances never appear. */
export function useIsCoarsePointer(): boolean {
  return useMediaQuery(MEDIA.coarsePointer);
}

/** `true` on a landscape phone: too little vertical room for a bottom sheet. */
export function useIsShortViewport(): boolean {
  return useMediaQuery(MEDIA.shortViewport);
}
