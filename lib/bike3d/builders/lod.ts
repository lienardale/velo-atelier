/**
 * `LOD_TABLE` (§3.3): two geometry tiers. `med` quality renders the `high`
 * geometry at DPR ≤ 1.5 without outlines, so it has no row of its own.
 *
 * The numbers are what keeps the triangle budgets of §3.4 (low ≤ 60 k,
 * high ≤ 150 k on the heaviest preset); `tests/perf` measures them.
 */
import type { GeometryTier, QualityTier } from "../types";

export interface LodSettings {
  /** Radial segments of straight and bent tubes. */
  tubeRadial: number;
  /** Tubular segments per bent path (whole path). */
  pathSegments: number;
  torusRadial: number;
  torusTubular: number;
  discSegments: number;
  /** Real teeth (extruded profile) or a plain cylinder. */
  gearTeeth: boolean;
  capsuleSegments: number;
}

export const LOD_TABLE: Readonly<Record<GeometryTier, LodSettings>> = {
  low: {
    tubeRadial: 6,
    pathSegments: 48,
    torusRadial: 8,
    torusTubular: 40,
    discSegments: 20,
    gearTeeth: false,
    capsuleSegments: 8,
  },
  high: {
    tubeRadial: 12,
    pathSegments: 160,
    torusRadial: 14,
    torusTubular: 96,
    discSegments: 40,
    gearTeeth: true,
    capsuleSegments: 14,
  },
};

export function geometryTierFor(quality: QualityTier): GeometryTier {
  return quality === "low" ? "low" : "high";
}
