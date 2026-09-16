/**
 * The part catalogue (§2.3) — 48 parts, and the `PartId` contract (§1.2).
 *
 * Catalogue order is display order: frame, wheels, tyres, drivetrain, brakes,
 * cockpit, saddle, pedals, suspension, e-system, accessories — the order of
 * `PART_SYSTEMS`, and within a system the order of each file.
 *
 *   `PART_IDS`           every id, in catalogue order
 *   `RENDERED_PART_IDS`  the ids with a mesh (§1.2: `PART_IDS.filter(hasMesh)`)
 *   `PartId`             a union of 48 literals — a typo is a `tsc` error
 *
 * Zod-free (`import type` only): reachable from the barrel. The parsers and
 * catalogue refinements live in `schema/part.ts` and run in
 * `tests/unit/domain/parts-for-spec.test.ts`.
 */
import type { PartDefinition } from "../../schema/part";

import { ACCESSORY_PARTS } from "./accessories";
import { BRAKE_PARTS } from "./brakes";
import { COCKPIT_PARTS } from "./cockpit";
import { DRIVETRAIN_PARTS } from "./drivetrain";
import { E_SYSTEM_PARTS } from "./e-system";
import { FRAME_PARTS } from "./frame";
import { PEDAL_PARTS } from "./pedals";
import { SADDLE_PARTS } from "./saddle";
import { SUSPENSION_PARTS } from "./suspension";
import { TIRE_PARTS } from "./tires";
import { WHEEL_PARTS } from "./wheels";

const CATALOGUE = [
  ...FRAME_PARTS,
  ...WHEEL_PARTS,
  ...TIRE_PARTS,
  ...DRIVETRAIN_PARTS,
  ...BRAKE_PARTS,
  ...COCKPIT_PARTS,
  ...SADDLE_PARTS,
  ...PEDAL_PARTS,
  ...SUSPENSION_PARTS,
  ...E_SYSTEM_PARTS,
  ...ACCESSORY_PARTS,
] as const;

export type PartId = (typeof CATALOGUE)[number]["id"];

/** A catalogue entry whose id is a {@link PartId}. */
export type CatalogPart = PartDefinition & { id: PartId };

/** Every part definition, in catalogue order. */
export const PARTS: readonly CatalogPart[] = CATALOGUE;

export const PART_IDS: readonly PartId[] = PARTS.map((definition) => definition.id);

/** Drawn by the 3D viewer, and therefore directly clickable. */
export function hasMesh(definition: PartDefinition): boolean {
  return definition.meshId !== null;
}

export const RENDERED_PART_IDS: readonly PartId[] = PARTS.filter(hasMesh).map((p) => p.id);

/** Clicked through a host: pads through their caliper, a tube through its tyre. */
export const HOSTED_PART_IDS: readonly PartId[] = PARTS.filter((p) => !hasMesh(p)).map((p) => p.id);

const BY_ID: ReadonlyMap<string, CatalogPart> = new Map(PARTS.map((p) => [p.id, p]));

/** Type guard for part ids arriving from a URL, a form or storage. */
export function isPartId(value: unknown): value is PartId {
  return typeof value === "string" && BY_ID.has(value);
}

/** The definition of `id`, or `undefined` for anything that is not a part id. */
export function partDefinition(id: string): CatalogPart | undefined {
  return BY_ID.get(id);
}

/** The part a click lands on: the host for a hosted part, the part itself otherwise. */
export function clickTargetOf(id: PartId): PartId {
  return (BY_ID.get(id)!.hostPartId ?? id) as PartId;
}
