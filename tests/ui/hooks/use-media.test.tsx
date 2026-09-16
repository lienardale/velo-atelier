/**
 * `lib/hooks/use-media.ts` — the hooks live in the `ui` tier, not `unit`,
 * because `matchMedia` only exists in jsdom (tests/setup.dom.ts installs the
 * controllable stub these tests drive with `setMediaQuery`).
 */
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import {
  MEDIA,
  useIsCoarsePointer,
  useIsDesktop,
  useIsShortViewport,
  useMediaQuery,
} from "@/lib/hooks/use-media";
import { setMediaQuery } from "@/tests/setup.dom";

describe("MEDIA", () => {
  it("states each breakpoint once, so components and tests agree", () => {
    expect(MEDIA).toEqual({
      tablet: "(min-width: 768px)",
      desktop: "(min-width: 1024px)",
      shortViewport: "(max-height: 500px)",
      coarsePointer: "(hover: none), (pointer: coarse)",
      reducedMotion: "(prefers-reduced-motion: reduce)",
    });
  });
});

describe("useMediaQuery", () => {
  it("reports whether the query matches right now", () => {
    setMediaQuery("(min-width: 900px)", true);
    const { result } = renderHook(() => useMediaQuery("(min-width: 900px)"));
    expect(result.current).toBe(true);
  });

  it("defaults to false for a query nothing has answered", () => {
    const { result } = renderHook(() => useMediaQuery("(min-width: 900px)"));
    expect(result.current).toBe(false);
  });

  it("re-renders when the query starts or stops matching", () => {
    const { result } = renderHook(() => useMediaQuery(MEDIA.desktop));
    expect(result.current).toBe(false);

    act(() => setMediaQuery(MEDIA.desktop, true));
    expect(result.current).toBe(true);

    act(() => setMediaQuery(MEDIA.desktop, false));
    expect(result.current).toBe(false);
  });

  it("stops listening when the component goes away", () => {
    const { unmount } = renderHook(() => useMediaQuery(MEDIA.desktop));
    unmount();
    // No React act() warning and no update on an unmounted component.
    expect(() => setMediaQuery(MEDIA.desktop, true)).not.toThrow();
  });

  it("follows a query that changes between renders", () => {
    setMediaQuery(MEDIA.tablet, true);
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useMediaQuery(query),
      {
        initialProps: { query: MEDIA.desktop as string },
      },
    );
    expect(result.current).toBe(false);

    rerender({ query: MEDIA.tablet });
    expect(result.current).toBe(true);
  });

  it("falls back to the server value when there is no matchMedia", () => {
    const original = window.matchMedia;
    // @ts-expect-error -- deleting a browser API is exactly the case under test.
    delete window.matchMedia;
    try {
      const { result } = renderHook(() => useMediaQuery(MEDIA.desktop, true));
      expect(result.current).toBe(true);
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });
});

describe("the named breakpoint hooks", () => {
  it.each([
    ["useIsDesktop", useIsDesktop, MEDIA.desktop],
    ["useIsCoarsePointer", useIsCoarsePointer, MEDIA.coarsePointer],
    ["useIsShortViewport", useIsShortViewport, MEDIA.shortViewport],
  ] as const)("%s follows its own query", (_name, hook, query) => {
    const { result } = renderHook(() => hook());
    expect(result.current).toBe(false);
    act(() => setMediaQuery(query, true));
    expect(result.current).toBe(true);
  });
});
