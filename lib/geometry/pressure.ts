/**
 * Tyre pressure (§5.6) — a table, an interpolation and two corrections.
 *
 * ## What this is
 *
 * A reference pressure per tyre width for an 85 kg **system** weight (rider +
 * bike + what they carry), scaled by weight, then corrected for tubeless and
 * for the front wheel carrying less of the load. The table is the classic
 * road/gravel/MTB curve: pressure falls fast as the tyre gets wider, because a
 * wider casing reaches the same contact-patch length at a much lower pressure.
 *
 * ## What this is NOT
 *
 * A manufacturer's recommendation. The plan flags the numbers as
 * "approximate — *verify* vs SILCA/Zipp before launch", and the page shows them
 * as a starting point with the sidewall limit as the hard ceiling. Anything the
 * sidewall says wins: {@link tirePressure} clamps to `maxBar`/`minBar` when the
 * caller passes them, and a rider who reads 4 bar max on the tyre gets 4 bar
 * whatever the curve thinks.
 *
 * Metric only. psi exists here as a read-only conversion because tyre gauges in
 * shops are still graduated in it (`barToPsi`).
 *
 * Plain TS: no React, no zod.
 */

/** ETRTO width in mm → bar, for an 85 kg system weight, inner tubes, rear wheel. */
export const BASE_BAR_85KG: readonly (readonly [number, number])[] = [
  [23, 7.0],
  [25, 6.3],
  [28, 5.5],
  [32, 4.5],
  [35, 4.0],
  [40, 3.3],
  [45, 2.8],
  [50, 2.4],
  [54, 2.1],
  [58, 1.9],
  [64, 1.7],
];

/** The system weight the table is written for. */
export const REFERENCE_WEIGHT_KG = 85;

/**
 * How pressure follows weight. Linear (exponent 1) over-inflates a heavy rider
 * and under-inflates a light one, because the casing itself carries part of the
 * load; 0.7 is the usual compromise.
 */
export const WEIGHT_EXPONENT = 0.7;

/** A tubeless casing needs ~10 % less air for the same contact patch. */
export const TUBELESS_FACTOR = 0.9;

/** The front wheel carries roughly 40 % of the load: 0.2 bar less than the rear. */
export const FRONT_DELTA_BAR = -0.2;

/** Nothing this site suggests is outside this band, whatever the arithmetic says. */
export const PRESSURE_CLAMP_BAR = { min: 1.2, max: 8.5 } as const;

/** 1 bar = 14.5038 psi. Display only — every stored value is bar. */
export const PSI_PER_BAR = 14.5038;

export function barToPsi(bar: number): number {
  return bar * PSI_PER_BAR;
}

/**
 * The table value for `widthMm`, linearly interpolated between the two nearest
 * rows and clamped to the ends (a 20 mm track tyre gets the 23 mm value, a
 * 2.8" plus tyre the 64 mm one).
 */
export function baseBarFor(widthMm: number): number {
  const first = BASE_BAR_85KG[0];
  const last = BASE_BAR_85KG[BASE_BAR_85KG.length - 1];
  if (widthMm <= first[0]) return first[1];
  if (widthMm >= last[0]) return last[1];

  for (let i = 1; i < BASE_BAR_85KG.length; i++) {
    const [highWidth, highBar] = BASE_BAR_85KG[i];
    if (widthMm > highWidth) continue;
    const [lowWidth, lowBar] = BASE_BAR_85KG[i - 1];
    const t = (widthMm - lowWidth) / (highWidth - lowWidth);
    return lowBar + t * (highBar - lowBar);
  }
  /* c8 ignore next -- unreachable: the loop returns for every width below `last`. */
  return last[1];
}

export interface TirePressureInput {
  riderKg: number;
  bikeKg: number;
  /** ETRTO width in mm (`tire-front`/`tire-rear`'s `etrto-width` attribute). */
  widthMm: number;
  tubeless: boolean;
  /** Extra load: bags, a child seat, a full bikepacking setup. */
  loadKg?: number;
  /** The sidewall's own limits, when the rider read them off the tyre. */
  maxBar?: number;
  minBar?: number;
}

export interface TirePressure {
  front: number;
  rear: number;
  /** The system weight the numbers were computed for. */
  systemKg: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Suggested pressures, in bar.
 *
 * §5.8 AC6: `tirePressure({riderKg: 75, bikeKg: 9, widthMm: 28, tubeless: false}).rear`
 * ≈ 5.46 (± 0.2).
 *
 * Returns `null` for input that cannot describe a bike and a rider — a
 * negative weight, a zero-width tyre — rather than a plausible-looking number.
 */
export function tirePressure(input: TirePressureInput): TirePressure | null {
  const { riderKg, bikeKg, widthMm, tubeless, loadKg = 0 } = input;
  if (![riderKg, bikeKg, widthMm, loadKg].every((n) => Number.isFinite(n))) return null;
  if (riderKg <= 0 || bikeKg <= 0 || widthMm <= 0 || loadKg < 0) return null;

  const systemKg = riderKg + bikeKg + loadKg;
  const scaled = baseBarFor(widthMm) * Math.pow(systemKg / REFERENCE_WEIGHT_KG, WEIGHT_EXPONENT);
  const corrected = tubeless ? scaled * TUBELESS_FACTOR : scaled;

  // The sidewall is the authority; the table only narrows what is left.
  const min = Math.max(PRESSURE_CLAMP_BAR.min, input.minBar ?? PRESSURE_CLAMP_BAR.min);
  const max = Math.min(PRESSURE_CLAMP_BAR.max, input.maxBar ?? PRESSURE_CLAMP_BAR.max);
  if (min > max) return null;

  return {
    rear: clamp(corrected, min, max),
    front: clamp(corrected + FRONT_DELTA_BAR, min, max),
    systemKg,
  };
}
