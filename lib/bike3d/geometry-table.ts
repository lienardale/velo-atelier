/**
 * `GEOMETRY_TABLE` — one frame per discipline × wheel diameter, size M (§3.2).
 *
 * The seed rows are §3.2's table; `docs/bike3d-geometry.md` records where each
 * number comes from and `npm run geom:report` prints the derived stack / reach
 * next to typical catalogue values. Rows are keyed `<discipline>/<etrto>`.
 *
 * Rows the plan's table does not list but the decision tree can produce
 * (`road/584` — 650b road — and `city-hybrid/559` — 26" city) are derived the
 * way the plan derives smaller wheels: "as the 622/584 row, wheelbase −0.02".
 * A unit test enumerates every discipline × visible wheel-size answer and
 * requires a row for each.
 */
import type { Discipline, EtrtoDiameter } from "@/lib/domain";

import type { FrameGeometryRow } from "./types";

export type GeometryRowKey = `${Discipline}/${EtrtoDiameter}`;

const ROAD_622: FrameGeometryRow = {
  wheelbase: 0.995,
  bbDrop: 0.072,
  chainstay: 0.41,
  headAngleDeg: 72.5,
  seatAngleDeg: 73.5,
  headTubeLength: 0.15,
  seatTubeLength: 0.52,
  forkAxleToCrown: 0.372,
  forkTravelIncludedMm: 0,
  forkRake: 0.045,
  topTubeDropAtSeat: 0.03,
  frameStyle: "diamond",
  tubes: { top: 0.0145, down: 0.019, seat: 0.0155, head: 0.024, stay: 0.009 },
  tireWidth: 0.028,
  stemLength: 0.1,
  barWidth: 0.42,
  saddleHeightDefault: 0.72,
};

const GRAVEL_622: FrameGeometryRow = {
  ...ROAD_622,
  wheelbase: 1.03,
  bbDrop: 0.075,
  chainstay: 0.425,
  headAngleDeg: 71.5,
  headTubeLength: 0.155,
  forkAxleToCrown: 0.395,
  forkRake: 0.05,
  tireWidth: 0.042,
  stemLength: 0.09,
  barWidth: 0.44,
};

const MTB_622: FrameGeometryRow = {
  ...ROAD_622,
  wheelbase: 1.17,
  bbDrop: 0.06,
  chainstay: 0.435,
  headAngleDeg: 66,
  seatAngleDeg: 75,
  headTubeLength: 0.095, // seed 0.110; tuned with geom:report (stack 656 → 642 mm at 130 mm travel)
  seatTubeLength: 0.44,
  forkAxleToCrown: 0.55,
  forkTravelIncludedMm: 130,
  forkRake: 0.044,
  topTubeDropAtSeat: 0.08,
  tubes: { top: 0.017, down: 0.022, seat: 0.0165, head: 0.026, stay: 0.011 },
  tireWidth: 0.058,
  stemLength: 0.05,
  barWidth: 0.78,
  saddleHeightDefault: 0.7,
};

const CITY_622: FrameGeometryRow = {
  ...ROAD_622,
  wheelbase: 1.08,
  bbDrop: 0.07,
  chainstay: 0.45,
  headAngleDeg: 70,
  seatAngleDeg: 72,
  headTubeLength: 0.17,
  seatTubeLength: 0.5,
  forkAxleToCrown: 0.42,
  forkRake: 0.045,
  frameStyle: "step-through",
  tubes: { top: 0.016, down: 0.024, seat: 0.016, head: 0.025, stay: 0.01 },
  tireWidth: 0.047,
  stemLength: 0.08,
  barWidth: 0.62,
  saddleHeightDefault: 0.7,
};

/** "as <row>, wheelbase −delta" — how §3.2 derives the smaller-wheel rows. */
function shorter(
  row: FrameGeometryRow,
  delta: number,
  tireWidth = row.tireWidth,
): FrameGeometryRow {
  return { ...row, wheelbase: row.wheelbase - delta, tireWidth };
}

/** Outer wheel radius of a row, metres. */
function outerRadius(etrto: number, tireWidth: number): number {
  return etrto / 2000 + tireWidth;
}

/**
 * Kids' frames: the city row scaled by the wheel-diameter ratio (§3.2). Every
 * length scales; angles do not. The style is diamond (a kids' frame has a low,
 * sloping top tube, drawn as a diamond).
 */
function kidsRow(etrto: EtrtoDiameter): FrameGeometryRow {
  const tireWidth = 0.05 * (etrto / 507);
  const k = outerRadius(etrto, tireWidth) / outerRadius(622, CITY_622.tireWidth);
  const scale = (value: number) => Number((value * k).toFixed(4));
  return {
    ...CITY_622,
    wheelbase: scale(CITY_622.wheelbase),
    bbDrop: scale(CITY_622.bbDrop) - 0.02,
    chainstay: scale(CITY_622.chainstay),
    headTubeLength: scale(CITY_622.headTubeLength),
    seatTubeLength: scale(CITY_622.seatTubeLength),
    forkAxleToCrown: scale(CITY_622.forkAxleToCrown),
    forkRake: scale(CITY_622.forkRake),
    topTubeDropAtSeat: scale(0.06),
    frameStyle: "diamond",
    tireWidth: Number(tireWidth.toFixed(4)),
    stemLength: scale(CITY_622.stemLength),
    barWidth: scale(CITY_622.barWidth),
    saddleHeightDefault: scale(CITY_622.saddleHeightDefault),
  };
}

export const GEOMETRY_TABLE: Readonly<Partial<Record<GeometryRowKey, FrameGeometryRow>>> = {
  "road/622": ROAD_622,
  "road/584": shorter(ROAD_622, 0.02, 0.032),
  "gravel/622": GRAVEL_622,
  "gravel/584": shorter(GRAVEL_622, 0.02, 0.047),
  "mtb/622": MTB_622,
  "mtb/584": shorter(MTB_622, 0.02),
  "mtb/559": shorter(MTB_622, 0.04),
  "city-hybrid/622": CITY_622,
  "city-hybrid/584": CITY_622,
  "city-hybrid/559": shorter(CITY_622, 0.02),
  "kids/507": kidsRow(507),
  "kids/406": kidsRow(406),
  "kids/305": kidsRow(305),
};

/** Thrown when no row exists — a unit test proves no reachable spec gets here. */
export class MissingGeometryRowError extends Error {
  constructor(readonly key: string) {
    super(`No geometry row for ${key}`);
    this.name = "MissingGeometryRowError";
  }
}

export function geometryRowKey(discipline: Discipline, etrto: EtrtoDiameter): GeometryRowKey {
  return `${discipline}/${etrto}`;
}

export function geometryRowFor(discipline: Discipline, etrto: EtrtoDiameter): FrameGeometryRow {
  const key = geometryRowKey(discipline, etrto);
  const row = Object.hasOwn(GEOMETRY_TABLE, key) ? GEOMETRY_TABLE[key] : undefined;
  if (!row) throw new MissingGeometryRowError(key);
  return row;
}
