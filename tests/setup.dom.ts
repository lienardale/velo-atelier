/**
 * jsdom tiers (ui, bike3d): jest-dom matchers, RTL cleanup, and the browser
 * APIs jsdom does not implement but our components use.
 *
 * Each stub is the smallest thing that behaves correctly, plus a test-side
 * control where a component's behaviour depends on it:
 *
 *   matchMedia            `setMediaQuery("(prefers-reduced-motion: reduce)", true)`
 *                         — reduced motion, coarse pointer, breakpoints (§3.3, §6.5)
 *   IntersectionObserver  `triggerIntersection(element)` — BikeViewer mounts
 *                         the 3D chunk only once visible (§3.3 "Loading")
 *   ResizeObserver        `triggerResize(element, { width, height })` — viewer refit
 *   requestIdleCallback   runs on the next macrotask (fake timers apply)
 *   pointer capture,
 *   scrollIntoView,
 *   scrollTo              no-ops — MobileSheet drags, stepper focus management
 *
 * Globals are assigned directly (not `vi.stubGlobal`) because the config sets
 * `unstubGlobals: true`, which would remove them after the first test. Their
 * state lives on `globalThis.__vaDomStubs` and is reset after every test.
 *
 * Tests import the controls from this file: `import { setMediaQuery } from "@/tests/setup.dom"`.
 */
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

import { primeTreeDrawings } from "@/components/decision-tree/tree-drawings";

type Listener = (event: MediaQueryListEvent) => void;

interface DomStubState {
  media: Map<string, boolean>;
  mediaListeners: Map<string, Set<Listener>>;
  intersection: Set<FakeIntersectionObserver>;
  resize: Set<FakeResizeObserver>;
}

const globalState = globalThis as typeof globalThis & { __vaDomStubs?: DomStubState };
const state: DomStubState = (globalState.__vaDomStubs ??= {
  media: new Map(),
  mediaListeners: new Map(),
  intersection: new Set(),
  resize: new Set(),
});

// ── matchMedia ───────────────────────────────────────────────────────────────

/** Make `window.matchMedia(query).matches` return `matches`, notifying listeners. */
export function setMediaQuery(query: string, matches: boolean): void {
  state.media.set(query, matches);
  for (const listener of state.mediaListeners.get(query) ?? []) {
    listener({ matches, media: query } as MediaQueryListEvent);
  }
}

function matchMedia(query: string): MediaQueryList {
  const listeners = () => {
    let set = state.mediaListeners.get(query);
    if (!set) state.mediaListeners.set(query, (set = new Set()));
    return set;
  };
  const list = {
    media: query,
    get matches() {
      return state.media.get(query) ?? false;
    },
    onchange: null,
    addEventListener: (_type: string, listener: Listener) => listeners().add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners().delete(listener),
    addListener: (listener: Listener) => listeners().add(listener),
    removeListener: (listener: Listener) => listeners().delete(listener),
    dispatchEvent: () => true,
  };
  return list as unknown as MediaQueryList;
}

// ── IntersectionObserver ─────────────────────────────────────────────────────

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  readonly targets = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
    state.intersection.add(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    state.intersection.delete(this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  fire(target: Element, isIntersecting: boolean): void {
    const rect = target.getBoundingClientRect();
    this.callback(
      [
        {
          target,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          boundingClientRect: rect,
          intersectionRect: rect,
          rootBounds: null,
          time: performance.now(),
        },
      ],
      this,
    );
  }
}

/**
 * Report `target` (default: every observed element) as entering — or, with
 * `isIntersecting: false`, leaving — the viewport.
 */
export function triggerIntersection(target?: Element, isIntersecting = true): void {
  for (const observer of [...state.intersection]) {
    for (const observed of [...observer.targets]) {
      if (!target || observed === target) observer.fire(observed, isIntersecting);
    }
  }
}

// ── ResizeObserver ───────────────────────────────────────────────────────────

class FakeResizeObserver implements ResizeObserver {
  readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    state.resize.add(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    state.resize.delete(this);
  }

  fire(target: Element, size: { width: number; height: number }): void {
    const box = [{ inlineSize: size.width, blockSize: size.height }];
    this.callback(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            ...size,
            right: size.width,
            bottom: size.height,
          } as DOMRectReadOnly,
          borderBoxSize: box,
          contentBoxSize: box,
          devicePixelContentBoxSize: box,
        },
      ],
      this,
    );
  }
}

/** Report a new size for `target` (default: every observed element). */
export function triggerResize(
  target: Element | undefined,
  size: { width: number; height: number },
): void {
  for (const observer of [...state.resize]) {
    for (const observed of [...observer.targets]) {
      if (!target || observed === target) observer.fire(observed, size);
    }
  }
}

// ── install ──────────────────────────────────────────────────────────────────

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: matchMedia,
});
Object.defineProperty(window, "IntersectionObserver", {
  configurable: true,
  writable: true,
  value: FakeIntersectionObserver,
});
Object.defineProperty(window, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: FakeResizeObserver,
});
Object.defineProperty(window, "requestIdleCallback", {
  configurable: true,
  writable: true,
  value: (callback: IdleRequestCallback) =>
    window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0),
});
Object.defineProperty(window, "cancelIdleCallback", {
  configurable: true,
  writable: true,
  value: (handle: number) => window.clearTimeout(handle),
});
Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value: () => {} });

const elementProto = window.Element.prototype as Element & {
  setPointerCapture?: unknown;
  releasePointerCapture?: unknown;
  hasPointerCapture?: unknown;
  scrollIntoView?: unknown;
};
elementProto.setPointerCapture ??= function setPointerCapture() {};
elementProto.releasePointerCapture ??= function releasePointerCapture() {};
elementProto.hasPointerCapture ??= function hasPointerCapture() {
  return false;
};
elementProto.scrollIntoView ??= function scrollIntoView() {};

// The decision tree's drawings arrive from `/api/tree-drawings` after
// hydration (`.debug/005`). Hand the store an empty map instead, so no
// component test reaches the network: the frame, the `<title>` and the callout
// legend — everything these tests assert — are rendered by `TreeDrawing`
// itself, and `components/decision-tree/tree-drawings.test.ts` covers the fetch.
beforeEach(() => {
  primeTreeDrawings({});
});

afterEach(() => {
  cleanup();
  state.media.clear();
  state.mediaListeners.clear();
  state.intersection.clear();
  state.resize.clear();
});
