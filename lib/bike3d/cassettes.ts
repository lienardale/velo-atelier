/**
 * Sprocket maths for the drivetrain (§3.2).
 *
 *   pitch radius  r(T) = 0.0127 / (2 · sin(π / T))     (½" chain pitch)
 *   cassette      CASSETTE_TEETH[range][speeds]        smallest → largest
 *
 * Known cassettes are literal; every other range × speeds pair is spread
 * geometrically between the range's end cogs (what real cassettes approximate)
 * with duplicates removed, so any `cassette.range` / `speeds` a user can pick
 * renders a plausible block.
 */

/** ½-inch chain pitch in metres. */
export const CHAIN_PITCH = 0.0127;

export function pitchRadius(teeth: number): number {
  return CHAIN_PITCH / (2 * Math.sin(Math.PI / teeth));
}

const KNOWN: Readonly<Record<string, Readonly<Record<number, readonly number[]>>>> = {
  "11-25": { 11: [11, 12, 13, 14, 15, 16, 17, 19, 21, 23, 25] },
  "11-28": {
    8: [11, 13, 15, 17, 19, 21, 24, 28],
    11: [11, 12, 13, 14, 15, 17, 19, 21, 23, 25, 28],
  },
  "11-30": { 12: [11, 12, 13, 14, 15, 16, 17, 19, 21, 24, 27, 30] },
  "11-32": {
    8: [11, 13, 15, 18, 21, 24, 28, 32],
    9: [11, 12, 14, 16, 18, 21, 24, 28, 32],
    10: [11, 12, 14, 16, 18, 20, 22, 25, 28, 32],
  },
  "11-42": { 11: [11, 13, 15, 17, 19, 21, 24, 28, 32, 37, 42] },
  "10-51": { 12: [10, 12, 14, 16, 18, 21, 24, 28, 32, 36, 42, 51] },
  "10-52": { 12: [10, 12, 14, 16, 18, 21, 24, 28, 32, 36, 42, 52] },
};

/** `"11-32"` → `[11, 32]`; anything unparseable → the default 11-32. */
export function parseRange(range: string | undefined): [number, number] {
  const match = /^(\d{1,2})-(\d{2})$/.exec(range ?? "");
  if (!match) return [11, 32];
  const low = Number(match[1]);
  const high = Number(match[2]);
  return low < high ? [low, high] : [11, 32];
}

/** Teeth of each cog, smallest first; `speeds` entries, strictly increasing. */
export function cassetteTeeth(range: string | undefined, speeds: number): number[] {
  const count = Math.max(1, Math.min(14, Math.round(speeds)));
  const known = range ? KNOWN[range]?.[count] : undefined;
  if (known) return [...known];
  const [low, high] = parseRange(range);
  if (count === 1) return [low];
  // More cogs than distinct tooth counts in the range cannot be strictly increasing.
  if (count > high - low + 1) return cassetteTeeth(`${low}-${low + count - 1}`, count);
  const teeth: number[] = [];
  for (let i = 0; i < count; i++) {
    const ideal = low * Math.pow(high / low, i / (count - 1));
    const previous = teeth[i - 1] ?? low - 1;
    // Leave room for the cogs still to come: each needs at least one more tooth.
    const ceiling = high - (count - 1 - i);
    teeth.push(Math.min(ceiling, Math.max(previous + 1, Math.round(ideal))));
  }
  return teeth;
}

/** Chainring teeth for 1, 2 or 3 rings, largest first. */
export function chainringTeeth(largest: number, rings: 1 | 2 | 3): number[] {
  if (rings === 1) return [largest];
  if (rings === 2) return [largest, largest - 16];
  return [largest, largest - 12, largest - 22];
}

/**
 * Length of a closed chain wrapped round two sprockets (open-belt formula),
 * metres. Increases with either radius and with the centre distance.
 */
export function openChainLength(bigRadius: number, smallRadius: number, distance: number): number {
  const diff = bigRadius - smallRadius;
  const phi = Math.asin(Math.max(-1, Math.min(1, diff / distance)));
  const straight = Math.sqrt(Math.max(0, distance * distance - diff * diff));
  return 2 * straight + (Math.PI + 2 * phi) * bigRadius + (Math.PI - 2 * phi) * smallRadius;
}
