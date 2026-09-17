/**
 * Derived frame measurements (§3.2): what `npm run geom:report` prints and
 * what the catalogue cross-checks in `solver.test.ts` compare (`expect.soft`,
 * ±20 mm stack, ±10 mm reach). Millimetres, rounded.
 */
import type { BikeAnchors } from "./types";
import { CHAIN_PITCH } from "./cassettes";

export interface FrameMeasurements {
  stackMm: number;
  reachMm: number;
  wheelbaseMm: number;
  chainstayMm: number;
  bbHeightMm: number;
  frontCenterMm: number;
  trailMm: number;
  saddleHeightMm: number;
  chainLinks: number;
}

const mm = (metres: number) => Math.round(metres * 1000);

export function frameMeasurements(anchors: BikeAnchors): FrameMeasurements {
  const { row } = anchors;
  const ha = (row.headAngleDeg * Math.PI) / 180;
  const radius = anchors.wheelFront.wheelRadius;
  const trail = (radius * Math.cos(ha) - row.forkRake) / Math.sin(ha);
  return {
    stackMm: mm(anchors.stack),
    reachMm: mm(anchors.reach),
    wheelbaseMm: mm(anchors.frontAxle[0] - anchors.rearAxle[0]),
    chainstayMm: mm(Math.hypot(anchors.rearAxle[0], anchors.rearAxle[1])),
    bbHeightMm: mm(-anchors.ground),
    frontCenterMm: mm(Math.hypot(anchors.frontAxle[0], anchors.frontAxle[1])),
    trailMm: mm(trail),
    saddleHeightMm: mm(Math.hypot(anchors.saddle[0], anchors.saddle[1])),
    chainLinks: Math.round(anchors.chainLength / CHAIN_PITCH),
  };
}

/** Typical size-M catalogue values the rows are tuned against (docs/bike3d-geometry.md). */
export const CATALOGUE_REFERENCES: Readonly<Record<string, { stackMm: number; reachMm: number }>> =
  {
    "road/622": { stackMm: 560, reachMm: 385 },
    "gravel/622": { stackMm: 585, reachMm: 385 },
    "mtb/622": { stackMm: 630, reachMm: 430 },
    "city-hybrid/622": { stackMm: 610, reachMm: 385 },
  };
