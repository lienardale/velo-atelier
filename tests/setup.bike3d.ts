/**
 * bike3d tier — React Three Fiber under jsdom (after setup.ts and setup.dom.ts).
 *
 * jsdom has no WebGL. Two kinds of test live in this tier (§3.5) and need
 * different things from that fact:
 *
 * - `@react-three/test-renderer` scenes (`BikeModel`, parts, selection) never
 *   create a GL context at all — they only need React's act() environment.
 *
 * - RTL tests of `BikeViewer` exercise its capability branches: no WebGL →
 *   interactive SVG + `bike3d.noWebgl`; context lost → SVG + `bike3d.reload3d`;
 *   `hasWebGL2()` must release its probe context through `WEBGL_lose_context`.
 *   For those, `HTMLCanvasElement.prototype.getContext` is replaced by a
 *   switchable fake:
 *
 *     setWebGLSupport("none")    // default — what jsdom really offers (null)
 *     setWebGLSupport("webgl2")  // getContext("webgl2"|"webgl") → fake context
 *     loseContext(canvas)        // dispatches `webglcontextlost` like a GPU reset
 *
 *   The fake context is enough to be *detected* and *released*, not to render:
 *   drawing belongs to Playwright (`tests/e2e/bike3d`, `tests/perf`) on a real
 *   SwiftShader context.
 *
 * `window.__va` (the Playwright test-hook contract, §1.2) is deleted after
 * every test so a hook installed by one test never leaks into the next.
 */
import { afterEach, vi } from "vitest";

type WebGLSupport = "none" | "webgl" | "webgl2";

let support: WebGLSupport = "none";
const contexts = new WeakMap<HTMLCanvasElement, FakeWebGLContext>();

/** Controls what `canvas.getContext("webgl2" | "webgl")` returns from now on. */
export function setWebGLSupport(next: WebGLSupport): void {
  support = next;
}

/** Simulate a GPU reset on `canvas`: the context reports lost and `webglcontextlost` fires. */
export function loseContext(canvas: HTMLCanvasElement): void {
  contexts.get(canvas)?.loseContextExtension.loseContext();
}

/** Every fake context handed out since the last reset (for "was the probe released?"). */
export const createdContexts: FakeWebGLContext[] = [];

class FakeWebGLContext {
  private lost = false;
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;

  readonly loseContextExtension = {
    loseContext: vi.fn(() => {
      if (this.lost) return;
      this.lost = true;
      this.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    }),
    restoreContext: vi.fn(() => {
      if (!this.lost) return;
      this.lost = false;
      this.canvas.dispatchEvent(new Event("webglcontextrestored"));
    }),
  };

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly version: 1 | 2,
  ) {
    this.drawingBufferWidth = canvas.width;
    this.drawingBufferHeight = canvas.height;
  }

  isContextLost(): boolean {
    return this.lost;
  }

  getExtension(name: string): unknown {
    if (name === "WEBGL_lose_context") return this.loseContextExtension;
    return null;
  }

  getSupportedExtensions(): string[] {
    return ["WEBGL_lose_context"];
  }

  getContextAttributes(): WebGLContextAttributes {
    return {
      alpha: true,
      antialias: true,
      depth: true,
      stencil: false,
      powerPreference: "default",
    };
  }

  getParameter(): null {
    return null;
  }
}

function getContext(this: HTMLCanvasElement, kind: string): unknown {
  const wantsGl = kind === "webgl2" || kind === "webgl" || kind === "experimental-webgl";
  if (!wantsGl) return null; // 2D canvas is not used by the viewer; null is jsdom's answer too
  if (support === "none" || (kind === "webgl2" && support !== "webgl2")) return null;
  let context = contexts.get(this);
  if (!context) {
    context = new FakeWebGLContext(this, kind === "webgl2" ? 2 : 1);
    contexts.set(this, context);
    createdContexts.push(context);
  }
  return context;
}

// jsdom's own getContext logs "Not implemented: HTMLCanvasElement.prototype.getContext"
// on every call; the fake answers silently and truthfully.
Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  writable: true,
  value: getContext,
});

// jsdom defines neither constructor, so a capability probe written as
// `ctx instanceof WebGL2RenderingContext` would throw a ReferenceError. These
// stand-ins exist only for `instanceof`, which they answer for the fake.
const contextConstructors = [
  ["WebGLRenderingContext", () => true],
  ["WebGL2RenderingContext", (ctx: FakeWebGLContext) => ctx.version === 2],
] as const;
for (const [name, accepts] of contextConstructors) {
  if (name in window) continue;
  const StandIn = class {
    static [Symbol.hasInstance](value: unknown): boolean {
      return value instanceof FakeWebGLContext && accepts(value);
    }
  };
  Object.defineProperty(window, name, { configurable: true, writable: true, value: StandIn });
}

// React 19 + R3F's test renderer: silence "not wrapped in act(...)" by declaring
// this an act() environment, as RTL does for react-dom.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  support = "none";
  createdContexts.length = 0;
  delete (window as Window & { __va?: unknown }).__va;
});
