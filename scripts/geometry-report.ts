#!/usr/bin/env tsx
/**
 * `npm run geom:report` — the derived geometry of every GEOMETRY_TABLE row
 * (§3.2): stack, reach, trail, BB height, chain links, next to the typical
 * size-M catalogue values the rows are tuned against.
 *
 * Rows are inputs (wheelbase, angles, tube lengths…); stack and reach are
 * OUTPUTS of the solver, never inputs (over-determined otherwise). Use this
 * table when tuning a row, then record the change in docs/bike3d-geometry.md.
 * The same catalogue check runs in `lib/bike3d/solver.test.ts` as `expect.soft`
 * (±20 mm stack, ±10 mm reach).
 *
 * Plain Node: no server-only, no database. Exit code is always 0 — this is a
 * report, the gate is the unit test.
 */
import { enumerateBuilds } from "../lib/bike3d/builds";
import { GEOMETRY_TABLE, geometryRowKey } from "../lib/bike3d/geometry-table";
import { CATALOGUE_REFERENCES, frameMeasurements } from "../lib/bike3d/measurements";
import { solve, solverInputFor } from "../lib/bike3d/solver";

const builds = enumerateBuilds();

const header = [
  "row",
  "stack",
  "reach",
  "Δstack",
  "Δreach",
  "wheelbase",
  "trail",
  "BB height",
  "saddle",
  "links",
];
const rows: string[][] = [];

for (const key of Object.keys(GEOMETRY_TABLE)) {
  const build = builds.find(
    (candidate) =>
      geometryRowKey(candidate.spec.discipline, candidate.spec.wheel.etrtoDiameter) === key &&
      candidate.spec.eSystem === null &&
      (candidate.spec.discipline !== "mtb" || candidate.spec.suspension.front),
  );
  if (!build) {
    rows.push([key, "(no reachable spec)"]);
    continue;
  }
  const input = solverInputFor(build);
  // MTB rows are specified with a 130 mm fork: report them at that travel.
  const anchors = solve({
    ...input,
    attributes: {
      ...input.attributes,
      forkTravelMm: build.spec.suspension.front ? 130 : undefined,
    },
  });
  const m = frameMeasurements(anchors);
  const reference = Object.hasOwn(CATALOGUE_REFERENCES, key)
    ? CATALOGUE_REFERENCES[key]
    : undefined;
  const delta = (value: number, ref: number | undefined) =>
    ref === undefined ? "" : `${value - ref >= 0 ? "+" : ""}${value - ref}`;
  rows.push([
    key,
    String(m.stackMm),
    String(m.reachMm),
    delta(m.stackMm, reference?.stackMm),
    delta(m.reachMm, reference?.reachMm),
    String(m.wheelbaseMm),
    String(m.trailMm),
    String(m.bbHeightMm),
    String(m.saddleHeightMm),
    String(m.chainLinks),
  ]);
}

const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
const line = (cells: string[]) => cells.map((c, i) => (c ?? "").padEnd(widths[i]!)).join("  ");
console.log("Derived geometry per row (mm). Δ = difference to the size-M catalogue reference.\n");
console.log(line(header));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of rows) console.log(line(row));
