/**
 * The soft tier's ladder, as pure functions (`scripts/perf/compare.ts` applies
 * it to the run files; `tests/unit/perf/ladder.test.ts` pins it).
 *
 * One ladder everywhere (PR and nightly), per §7.3:
 *     ≤ warn % of baseline   ok
 *     > warn %               warning in the job summary
 *     > fail %               hard failure (exit 1)
 * with warn/fail from `perf.budgets.json` `timingLadder` (150 / 300).
 *
 * `longFrames` is a COUNT and is laddered on (run + 1) / (baseline + 1): with a
 * baseline of zero long frames a plain ratio is infinite for the first one.
 * Smoothed, a zero baseline warns at one long frame and fails at three; at any
 * other baseline the fail line sits exactly two long frames later than a plain
 * ratio's (baseline 10: fail from 33, not 31) and the warn line at most one
 * later. The durations are plain ratios.
 *
 * **Long frames never fail on a software renderer** (the W4 ruling,
 * `.debug/012` §12). CI draws through SwiftShader, where a long frame (an rAF
 * interval over 50 ms) is the rasteriser's own scheduling, not a hitch a
 * visitor would see: over five repetitions of identical code on ONE runner, the
 * nightly that recorded the W4 baselines counted `perf-mobile` /
 * `mtb-full-dropper-1x12` at [4, 1, 1, 1, 3], and the first comparison against
 * that median of 1 failed at 6 with the code unchanged. Above the fail line the
 * count is still reported, as a warning; the durations keep their failure, and
 * on a real GPU long frames fail as before.
 */

/** Metrics that are a timing and therefore subject to the ladder. */
export const TIMING_METRICS: ReadonlySet<string> = new Set([
  "p50FrameMs",
  "p95FrameMs",
  "longFrames",
  "buildMs",
  "tapLatencyMs",
]);

/** Of those, the one that is a count of events rather than a duration. */
export const COUNT_METRICS: ReadonlySet<string> = new Set(["longFrames"]);

/** Timings whose failure is capped at a warning when the run rendered in software. */
export const SOFTWARE_WARN_ONLY: ReadonlySet<string> = new Set(["longFrames"]);

/**
 * A renderer string that names a software rasteriser: SwiftShader (CI), Mesa's
 * llvmpipe / softpipe, Windows' WARP "Basic Render Driver", Apple's Software
 * Renderer. The local GPU gate (`tests/perf/bike3d.perf.spec.ts`) refuses the
 * same list.
 */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

export function isSoftwareRenderer(renderer: unknown): boolean {
  return typeof renderer === "string" && SOFTWARE_RENDERER.test(renderer);
}

export interface Ladder {
  warnPct: number;
  failPct: number;
}

export function ratioPct(metric: string, value: number, before: number): number {
  if (COUNT_METRICS.has(metric)) return ((value + 1) / (before + 1)) * 100;
  if (before === 0) return value === 0 ? 100 : Number.POSITIVE_INFINITY;
  return (value / before) * 100;
}

export interface Verdict {
  pct: number;
  verdict: "ok" | "warn" | "FAIL";
  /** Past the fail line, but reported as a warning (software renderer). */
  capped: boolean;
}

export function verdictOf(
  metric: string,
  value: number,
  before: number,
  ladder: Ladder,
  softwareRenderer: boolean,
): Verdict {
  const pct = ratioPct(metric, value, before);
  if (pct > ladder.failPct) {
    const capped = softwareRenderer && SOFTWARE_WARN_ONLY.has(metric);
    return { pct, verdict: capped ? "warn" : "FAIL", capped };
  }
  if (pct > ladder.warnPct) return { pct, verdict: "warn", capped: false };
  return { pct, verdict: "ok", capped: false };
}
