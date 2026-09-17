/**
 * The Playwright test-hook contract (§1.2) — `window.__va`.
 *
 *   window.__va = {
 *     bike: { ready, selectedPartId, pickedPartIds, partIds, screenPositionOf(id),
 *             focus(id), hittable(pose), materialOf(id), loseContext(),
 *             restoreContext(), mountCount, quality, setQuality },
 *     perf: { snapshot(), runOrbit(ms), renderFrames(n), buildMs, contextCreations },
 *   }
 *
 * BUILD-TIME GATED. Only `components/bike3d/perf/PerfProbe.tsx` imports this
 * module, and `BikeViewer` references PerfProbe only when
 * `process.env.NEXT_PUBLIC_TEST_HOOKS === "1"` at build time. A production
 * build therefore contains no hook code (§3.6 AC7). The CI e2e/perf build sets
 * `NEXT_PUBLIC_TEST_HOOKS=1 ENABLE_TEST_PAGES=1`; Vercel never does.
 */

export interface ScreenPoint {
  /** Client (CSS pixel) coordinates, ready for `page.mouse.click(x, y)`. */
  x: number;
  y: number;
}

export interface PerfSnapshot {
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  /** Frame durations recorded since the canvas mounted (bounded). */
  frameMs: number[];
  dpr: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  viewportWidth: number;
  lodTier: "low" | "high";
  quality: "low" | "med" | "high";
  materials: number;
}

export interface VaBikeHooks {
  readonly ready: boolean;
  readonly selectedPartId: string | null;
  readonly pickedPartIds: string[];
  /** Rendered part ids of the current plan. */
  readonly partIds: string[];
  /** A point on screen where a click lands on `id` (its host for a hosted part), or null. */
  screenPositionOf(id: string): ScreenPoint | null;
  /** Select `id` with a camera focus, as a list click does. */
  focus(id: string): void;
  /** Move the camera to a named pose and return every part clickable from it. */
  hittable(pose: string): Record<string, ScreenPoint>;
  /** The material singleton the part's first mesh wears (`paint`, `highlightSelected`, …). */
  materialOf(id: string): string | null;
  /** Force a WebGL context loss (WEBGL_lose_context). */
  loseContext(): boolean;
  /** Ask the viewer to bring the 3D back (the "reload 3D" button). */
  restoreContext(): void;
  readonly mountCount: number;
  readonly quality: "low" | "med" | "high";
  setQuality(tier: "low" | "med" | "high"): void;
}

export interface VaPerfHooks {
  snapshot(): PerfSnapshot | null;
  /** Orbit the camera for `ms` with the frameloop forced on; resolves to frame intervals. */
  runOrbit(ms: number): Promise<number[]>;
  /** Render `n` frames (demand frameloop) and resolve after the last one. */
  renderFrames(n: number): Promise<void>;
  readonly buildMs: number | null;
  readonly contextCreations: number;
}

export interface VaTestHooks {
  bike: VaBikeHooks;
  perf: VaPerfHooks;
}

type HookWindow = Window & { __va?: VaTestHooks };

/** Install the hooks on `window.__va`; returns the uninstaller. */
export function installE2EHooks(hooks: VaTestHooks, win: Window = window): () => void {
  const target = win as HookWindow;
  target.__va = hooks;
  return () => {
    if (target.__va === hooks) delete target.__va;
  };
}
