/**
 * Geometry and fit measurements (§2.5, §5.6) — what to measure on a bike and
 * on its rider, and which guide explains how.
 *
 * Every measure points at a `measure` or `adjust` guide; that guide must be a
 * **full** one in both locales (§5.7 — `tests/unit/content/geometry-measures.test.ts`,
 * W1-T4), because a fit page that links to a stub teaches nothing.
 *
 * `cleat-position` points at `adjust-cleats`, the guide that sets it (its
 * fore-aft step carries the measure). Until the stub guides' promotion it
 * pointed at `measure-saddle-setback`, whose own cleat step covers the
 * ball-of-foot-over-axle check, because a measure may only reference a full
 * guide and `adjust-cleats` was a stub.
 *
 * Labels: `parts.measures.<id>.{label,help}`.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import type { AttributeUnit } from "../schema/part";

import type { PartId } from "./parts";

export const GEOMETRY_MEASURE_IDS = [
  "saddle-height",
  "saddle-setback",
  "reach",
  "bar-drop",
  "cleat-position",
  "tire-pressure",
  "sag",
  "chain-wear",
] as const;

export type GeometryMeasureId = (typeof GEOMETRY_MEASURE_IDS)[number];

export interface GeometryMeasure {
  id: GeometryMeasureId;
  /** `parts.measures.<id>.label` */
  labelKey: string;
  /** `parts.measures.<id>.help` */
  helpKey: string;
  /** The `measure` or `adjust` guide that explains how. */
  guideSlug: string;
  /** What the number is in; `null` for a percentage or a pressure (shown with its own unit). */
  unit: AttributeUnit | null;
  /** The parts the measurement is about. */
  partIds: readonly PartId[];
}

const measure = (
  id: GeometryMeasureId,
  guideSlug: string,
  unit: AttributeUnit | null,
  partIds: readonly PartId[],
): GeometryMeasure => ({
  id,
  labelKey: `parts.measures.${id}.label`,
  helpKey: `parts.measures.${id}.help`,
  guideSlug,
  unit,
  partIds,
});

export const GEOMETRY_MEASURES: readonly GeometryMeasure[] = [
  measure("saddle-height", "measure-saddle-height", "mm", ["saddle", "seatpost"]),
  measure("saddle-setback", "measure-saddle-setback", "mm", ["saddle"]),
  measure("reach", "measure-reach-and-drop", "mm", ["stem", "handlebar"]),
  measure("bar-drop", "measure-reach-and-drop", "mm", ["stem", "handlebar", "saddle"]),
  measure("cleat-position", "adjust-cleats", "mm", ["pedal-left", "pedal-right"]),
  measure("tire-pressure", "measure-tire-pressure", null, ["tire-front", "tire-rear"]),
  measure("sag", "adjust-suspension-sag", null, ["fork", "rear-shock"]),
  measure("chain-wear", "measure-chain-wear", null, ["chain"]),
];
