/**
 * Fit formulas (§5.6) — the arithmetic behind `/velo/[id]/reglages`.
 *
 * Every function here is pure, metric, and deliberately conservative: these are
 * **starting points**, not prescriptions. A saddle height from an inseam is
 * where a rider begins, then moves 5 mm at a time; the page says so, and the
 * guides say it again. Nothing in this file decides anything on its own — the
 * verdicts it returns (`chainWearFromRuler`) are the ones a mechanic would read
 * off the same tool.
 *
 * Units: centimetres for body measurements (that is how riders measure
 * themselves), millimetres for everything on the bike (that is how parts are
 * specified), percent for sag. Conversions are explicit at the boundary
 * (`saddleHeightMmFromInseam`), never implicit.
 *
 * Plain TS: no React, no zod, no next-intl. The values are formatted by the
 * caller with `useFormatter()` so "74,2 cm" and "74.2 cm" are one component.
 */
import type { Discipline } from "@/lib/domain/schema/bike-spec";

// ── Saddle height ────────────────────────────────────────────────────────────

/**
 * Greg LeMond's factor: saddle height (BB centre → saddle top, along the seat
 * tube) ≈ 0.883 × inseam. The oldest published number in cycling fit and still
 * the one every other method is compared against.
 */
export const LEMOND_FACTOR = 0.883;

/** Inseams a human being can have, in cm — anything outside is a typo, not a rider. */
export const INSEAM_RANGE_CM = { min: 50, max: 110 } as const;

/** Saddle heights a frame can produce, in mm (`BikeFit.saddleHeightMm` range). */
export const SADDLE_HEIGHT_RANGE_MM = { min: 500, max: 900 } as const;

/**
 * Saddle height in **cm** for an inseam in cm.
 *
 * `saddleHeightLeMond(84) === 74.172` (§5.8 AC6 asks for 74.2 ± 0.05).
 */
export function saddleHeightLeMond(inseamCm: number): number {
  return inseamCm * LEMOND_FACTOR;
}

/** The same height rounded to whole **millimetres**, which is what `BikeFit` stores. */
export function saddleHeightMmFromInseam(inseamCm: number): number {
  return Math.round(saddleHeightLeMond(inseamCm) * 10);
}

/**
 * The heel method, as a number rather than a sentence: with the heel on the
 * pedal at the bottom of the stroke the leg should be straight, which lands
 * about 2 % below the LeMond height. The guide
 * (`measure-saddle-height`) explains the gesture; this is only the target the
 * page shows next to it.
 */
export const HEEL_METHOD_RATIO = 0.98;

export function saddleHeightHeelMethodMm(inseamCm: number): number {
  return Math.round(saddleHeightMmFromInseam(inseamCm) * HEEL_METHOD_RATIO);
}

// ── Saddle setback (KOPS) ────────────────────────────────────────────────────

/**
 * KOPS — knee over pedal spindle — is a *starting* alignment, not a law of
 * biomechanics, so the verdict has a dead band: anything within ±1 cm of the
 * spindle is "fine, ride it".
 */
export const KOPS_TOLERANCE_CM = 1;

export type KopsVerdict = "forward" | "aligned" | "back";

/**
 * Where the knee sits relative to the pedal spindle, from the horizontal
 * distance in cm (positive = the knee is **ahead** of the spindle).
 */
export function kopsVerdict(offsetCm: number, tolerance = KOPS_TOLERANCE_CM): KopsVerdict {
  if (offsetCm > tolerance) return "forward";
  if (offsetCm < -tolerance) return "back";
  return "aligned";
}

// ── Saddle-to-bar drop ───────────────────────────────────────────────────────

/**
 * Usual saddle-to-bar drop per discipline, in cm (positive = the bar is
 * **below** the saddle). A city bike is normally above, a road bike well below;
 * the page shows the band, never a single number.
 */
export const DROP_CM: Readonly<Record<Discipline, readonly [number, number]>> = {
  road: [-10, -4],
  gravel: [-6, -2],
  mtb: [-2, 2],
  "city-hybrid": [0, 6],
  kids: [-2, 4],
};

export type DropVerdict = "low" | "typical" | "high";

/**
 * Note the sign convention of `DROP_CM`: a **more negative** number is a
 * *lower* bar (more drop). `dropVerdict(-12, 'road')` is therefore `"low"` —
 * the bar is below the usual band.
 */
export function dropVerdict(dropCm: number, discipline: Discipline): DropVerdict {
  const [min, max] = DROP_CM[discipline];
  if (dropCm < min) return "low";
  if (dropCm > max) return "high";
  return "typical";
}

// ── Suspension sag ───────────────────────────────────────────────────────────

/** Sag bands in percent of travel (§5.6). */
export const SAG_PERCENT = {
  forkXc: [15, 20],
  forkTrail: [20, 25],
  shock: [25, 30],
} as const satisfies Record<string, readonly [number, number]>;

export type SagTarget = keyof typeof SAG_PERCENT;

/**
 * The band to aim for. A fork on a bike that also has a rear shock is ridden
 * harder than a hardtail's, so it gets the trail band; an XC hardtail fork gets
 * the firmer one.
 */
export function sagTargetFor(part: "fork" | "shock", fullSuspension: boolean): SagTarget {
  if (part === "shock") return "shock";
  return fullSuspension ? "forkTrail" : "forkXc";
}

export function sagRange(target: SagTarget): readonly [number, number] {
  return SAG_PERCENT[target];
}

/** Sag as a percentage of travel, from the o-ring reading and the stroke. */
export function sagPercent(sagMm: number, travelMm: number): number | null {
  if (!(travelMm > 0) || !Number.isFinite(sagMm) || sagMm < 0) return null;
  return (sagMm / travelMm) * 100;
}

export type SagVerdict = "firm" | "ok" | "soft";

export function sagVerdict(percent: number, target: SagTarget): SagVerdict {
  const [min, max] = SAG_PERCENT[target];
  if (percent < min) return "firm";
  if (percent > max) return "soft";
  return "ok";
}

// ── Chain wear ───────────────────────────────────────────────────────────────

/** Twelve links of a new chain, in mm: 12 × 1 inch × 25.4. */
export const NEW_CHAIN_12_LINKS_MM = 304.8;

/**
 * Replacement thresholds as a multiple of a new chain: 0.5 % elongation for
 * 11-speed and above (the cassettes are thinner and wear faster), 0.75 % for
 * 10-speed and below.
 */
export const CHAIN_WEAR_LIMIT = { modern: 1.005, classic: 1.0075 } as const;

/** Speeds at or above which the tighter 0.5 % limit applies. */
export const CHAIN_WEAR_MODERN_SPEEDS = 11;

export type ChainWearVerdict = "ok" | "replace";

/** The measured length in mm at which a chain of `speeds` is worn out. */
export function chainWearLimitMm(speeds: number): number {
  const factor =
    speeds >= CHAIN_WEAR_MODERN_SPEEDS ? CHAIN_WEAR_LIMIT.modern : CHAIN_WEAR_LIMIT.classic;
  return NEW_CHAIN_12_LINKS_MM * factor;
}

/**
 * Twelve links measured pin-centre to pin-centre with a steel ruler
 * (§5.8 AC6: `(306.5, 11) === 'replace'`, `(306.0, 11) === 'ok'`).
 */
export function chainWearFromRuler(mm: number, speeds: number): ChainWearVerdict {
  return mm >= chainWearLimitMm(speeds) ? "replace" : "ok";
}

/** Elongation in percent — what a chain checker's gauge is graduated in. */
export function chainElongationPercent(mm: number): number {
  return (mm / NEW_CHAIN_12_LINKS_MM - 1) * 100;
}
