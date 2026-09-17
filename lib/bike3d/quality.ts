/**
 * Rendering quality (§3.3) — pure over injected capabilities.
 *
 * Initial tier: `deviceMemory ≤ 2 || saveData` → low; coarse pointer → med;
 * otherwise high. A tier persisted under `va:bike3d:quality` wins, except that
 * a coarse pointer never starts above med.
 *
 * `QualityGovernor` feeds `governorStep` one fps sample per camera interaction
 * window (`controlstart` → `controlend`, discarded under 500 ms): it lowers the
 * tier after 2 windows under 40 fps, raises it after 3 windows over 58 fps,
 * flips at most twice per session, and never rises above the initial tier on a
 * coarse pointer. No drei PerformanceMonitor / AdaptiveDpr / AdaptiveEvents.
 *
 * `readCapsEnv()` touches `window` and `navigator`: call it only in an effect.
 */
import type { QualityTier } from "./types";

export const QUALITY_STORAGE_KEY = "va:bike3d:quality";

export interface ViewerCaps {
  webgl2: boolean;
  coarsePointer: boolean;
  reducedMotion: boolean;
  deviceMemory: number | null;
  saveData: boolean;
  devicePixelRatio: number;
}

const ORDER: readonly QualityTier[] = ["low", "med", "high"];
const rank = (tier: QualityTier) => ORDER.indexOf(tier);

export function isQualityTier(value: unknown): value is QualityTier {
  return value === "low" || value === "med" || value === "high";
}

/** The tier the hardware suggests, before any persisted preference. */
export function capsTier(
  caps: Pick<ViewerCaps, "coarsePointer" | "deviceMemory" | "saveData">,
): QualityTier {
  if ((caps.deviceMemory !== null && caps.deviceMemory <= 2) || caps.saveData) return "low";
  if (caps.coarsePointer) return "med";
  return "high";
}

export function initialQuality(
  caps: Pick<ViewerCaps, "coarsePointer" | "deviceMemory" | "saveData">,
  persisted: unknown,
): QualityTier {
  const suggested = capsTier(caps);
  if (!isQualityTier(persisted)) return suggested;
  if (caps.coarsePointer && rank(persisted) > rank("med")) return "med";
  return persisted;
}

/** Device-pixel-ratio cap per tier (low 1, med ≤ 1.5, high ≤ 2). */
export function dprFor(tier: QualityTier, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (tier === "low") return 1;
  return Math.min(dpr, tier === "med" ? 1.5 : 2);
}

/** Selection outlines are a high-tier luxury (§3.3: med = high geometry without outlines). */
export function outlinesFor(tier: QualityTier): boolean {
  return tier === "high";
}

// ── governor ─────────────────────────────────────────────────────────────────

export const GOVERNOR = {
  minWindowMs: 500,
  lowFps: 40,
  highFps: 58,
  lowerAfter: 2,
  raiseAfter: 3,
  maxFlips: 2,
} as const;

export interface GovernorState {
  tier: QualityTier;
  /** The tier the session started on; a coarse pointer never rises above it. */
  initial: QualityTier;
  coarsePointer: boolean;
  slowWindows: number;
  fastWindows: number;
  flips: number;
}

export function createGovernor(tier: QualityTier, coarsePointer: boolean): GovernorState {
  return { tier, initial: tier, coarsePointer, slowWindows: 0, fastWindows: 0, flips: 0 };
}

/** Frames per second of one interaction window, or `null` when it is too short to trust. */
export function windowFps(frames: number, elapsedMs: number): number | null {
  if (!(elapsedMs >= GOVERNOR.minWindowMs) || frames < 0) return null;
  return (frames * 1000) / elapsedMs;
}

export function governorStep(state: GovernorState, fps: number | null): GovernorState {
  if (fps === null || state.flips >= GOVERNOR.maxFlips) return state;
  if (fps < GOVERNOR.lowFps) {
    const slowWindows = state.slowWindows + 1;
    if (slowWindows >= GOVERNOR.lowerAfter && rank(state.tier) > 0) {
      return {
        ...state,
        tier: ORDER[rank(state.tier) - 1]!,
        slowWindows: 0,
        fastWindows: 0,
        flips: state.flips + 1,
      };
    }
    return { ...state, slowWindows, fastWindows: 0 };
  }
  if (fps > GOVERNOR.highFps) {
    const fastWindows = state.fastWindows + 1;
    const ceiling = state.coarsePointer ? rank(state.initial) : ORDER.length - 1;
    if (fastWindows >= GOVERNOR.raiseAfter && rank(state.tier) < ceiling) {
      return {
        ...state,
        tier: ORDER[rank(state.tier) + 1]!,
        slowWindows: 0,
        fastWindows: 0,
        flips: state.flips + 1,
      };
    }
    return { ...state, fastWindows, slowWindows: 0 };
  }
  return { ...state, slowWindows: 0, fastWindows: 0 };
}

// ── environment ──────────────────────────────────────────────────────────────

interface NavigatorWithHints {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/** Read capabilities from a browser window. Call in `useEffect` only. */
export function readCapsEnv(win: Window, webgl2: boolean): ViewerCaps {
  const nav = win.navigator as Navigator & NavigatorWithHints;
  const media = (query: string) => win.matchMedia?.(query).matches ?? false;
  return {
    webgl2,
    coarsePointer: media("(pointer: coarse)"),
    reducedMotion: media("(prefers-reduced-motion: reduce)"),
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    saveData: nav.connection?.saveData === true,
    devicePixelRatio: win.devicePixelRatio || 1,
  };
}

/** The persisted tier, or `null` (storage can be missing, blocked or hold junk). */
export function readPersistedQuality(
  storage: Pick<Storage, "getItem"> | null | undefined,
): QualityTier | null {
  try {
    const value = storage?.getItem(QUALITY_STORAGE_KEY);
    return isQualityTier(value) ? value : null;
  } catch {
    return null;
  }
}

export function persistQuality(
  storage: Pick<Storage, "setItem"> | null | undefined,
  tier: QualityTier,
): void {
  try {
    storage?.setItem(QUALITY_STORAGE_KEY, tier);
  } catch {
    // Private mode / quota: the tier simply is not remembered.
  }
}
