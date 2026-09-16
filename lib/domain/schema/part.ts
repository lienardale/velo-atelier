/**
 * The part taxonomy (§2.3) — one definition per thing you can click, inspect,
 * check, clean, adjust or replace.
 *
 * The part **catalogue** itself lives in `lib/domain/data/parts/*.ts` (W1-T2);
 * this file is its contract. `PartId` is therefore a plain id string here and a
 * literal union over `PART_IDS` there: the catalogue is the source of ids, the
 * schema is the source of shape.
 *
 * Two rules carry most of the weight:
 *
 *   - every part has **exactly one** of `meshId` (it is drawn, and clicking the
 *     mesh selects it) or `hostPartId` (it has no geometry of its own and is
 *     reached through its host — pads through their caliper, tube through its
 *     tyre). Host chains are one level deep, so a click always resolves.
 *   - an attribute's `default` is explicit: a `fallback` plus ordered `when`
 *     rules. No zod `.default()` anywhere (§2), so the inferred type of a data
 *     file never quietly turns an omitted field into a required one.
 */
import * as z from "zod";

import { ATTRIBUTE_UNITS, ID_PATTERN, PART_POSITIONS, PART_SYSTEMS } from "../data/conventions";

import type { BikeSpec, SpecPath } from "./bike-spec";
import { SpecConditionSchema, type SpecCondition } from "./condition";
import type { ProcedureKind } from "./procedure";

export type PartSystem = (typeof PART_SYSTEMS)[number];
export type PartPosition = (typeof PART_POSITIONS)[number];
export type AttributeUnit = (typeof ATTRIBUTE_UNITS)[number];

/** What an attribute can hold once it is set on a bike. */
export type AttributeValue = string | number | boolean;

export type AttributeKind = "enum" | "boolean" | "number" | "text";

/**
 * `fallback: null` means "we cannot guess" — the key is left off the part and
 * `missingAttributes()` asks the visitor when it matters (§2.4).
 */
export interface AttributeDefault<P extends string = SpecPath> {
  fallback: AttributeValue | null;
  when: readonly { when: SpecCondition<P>; value: AttributeValue }[];
}

export interface AttributeDef<P extends string = SpecPath> {
  /** Unique within the part; the same key means the same thing across parts. */
  key: string;
  kind: AttributeKind;
  /** `enum` only, at least two entries. */
  values?: readonly AttributeValue[];
  unit?: AttributeUnit;
  /** `number` only. */
  min?: number;
  max?: number;
  /** Can the owner change it from the part panel? */
  editable: boolean;
  /** Absent = always present. A fork's travel only exists on a suspension fork. */
  presentWhen?: SpecCondition<P>;
  default: AttributeDefault<P>;
  /** `parts.attr.<key>.label` */
  labelKey: string;
  /** `parts.attr.<key>.help` */
  helpKey?: string;
}

export interface PartDefinition<P extends string = SpecPath> {
  id: string;
  system: PartSystem;
  /** `parts.<id>.label` */
  labelKey: string;
  /** `parts.<id>.description` */
  descriptionKey: string;
  /** Absent = on every bike. */
  includeWhen?: SpecCondition<P>;
  /** Optional parts are offered but not fitted by default (a rack, a kickstand). */
  optional: boolean;
  position: PartPosition;
  /** Set when the part is drawn; `null` when it is reached through `hostPartId`. */
  meshId: string | null;
  /** Set when the part has no geometry of its own. Exactly one of the two. */
  hostPartId?: string;
  attributes: readonly AttributeDef<P>[];
  /** Guide slugs per kind: `{ check: ['check-brakes-disc'], replace: [...] }`. */
  procedures: Partial<Record<ProcedureKind, readonly string[]>>;
  /** Lower goes first in a full checkup: brakes before bottle cages. */
  checkupPriority: number;
  /** Wears out with use, so the checkup always asks about it. */
  wearItem: boolean;
}

/** One part as fitted to one bike: the definition plus the values that were chosen. */
export interface BikePart {
  partId: string;
  /** A key is absent when its default is `null` and nobody has filled it in yet. */
  attributes: Record<string, AttributeValue>;
}

/** A bike, fully materialised: what it is, and what is on it. */
export interface BikeBuild {
  spec: BikeSpec;
  parts: BikePart[];
}

const AttributeValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const IdSchema = z.string().regex(ID_PATTERN).max(48);

export const AttributeDefSchema: z.ZodType<AttributeDef<string>> = z.strictObject({
  key: IdSchema,
  kind: z.enum(["enum", "boolean", "number", "text"]),
  values: z.array(AttributeValueSchema).optional(),
  unit: z.enum(ATTRIBUTE_UNITS).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  editable: z.boolean(),
  presentWhen: SpecConditionSchema.optional(),
  default: z.strictObject({
    fallback: AttributeValueSchema.nullable(),
    when: z.array(z.strictObject({ when: SpecConditionSchema, value: AttributeValueSchema })),
  }),
  labelKey: z.string().min(1),
  helpKey: z.string().min(1).optional(),
});

export const PartDefinitionSchema: z.ZodType<PartDefinition<string>> = z.strictObject({
  id: IdSchema,
  system: z.enum(PART_SYSTEMS),
  labelKey: z.string().min(1),
  descriptionKey: z.string().min(1),
  includeWhen: SpecConditionSchema.optional(),
  optional: z.boolean(),
  position: z.enum(PART_POSITIONS),
  meshId: z.string().regex(ID_PATTERN).nullable(),
  hostPartId: IdSchema.optional(),
  attributes: z.array(AttributeDefSchema),
  procedures: z.partialRecord(
    z.enum(["check", "replace", "clean", "adjust", "measure"]),
    z.array(z.string().min(1)),
  ),
  checkupPriority: z.int(),
  wearItem: z.boolean(),
});

/** The value an attribute of this `kind` is allowed to default to. */
function matchesKind(kind: AttributeKind, value: AttributeValue): boolean {
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "number") return typeof value === "number";
  return typeof value === "string" || typeof value === "number";
}

/**
 * Catalogue-wide refinements (§2.3). Returns one message per problem, empty for
 * a well-formed catalogue; exported so a test can feed it a broken one.
 */
export function checkPartCatalog(parts: readonly PartDefinition<string>[]): string[] {
  const errors: string[] = [];
  const byId = new Map<string, PartDefinition<string>>();
  const meshOwners = new Map<string, string>();

  for (const part of parts) {
    if (byId.has(part.id)) errors.push(`${part.id}: duplicate part id`);
    byId.set(part.id, part);

    if (part.labelKey !== `parts.${part.id}.label`) {
      errors.push(`${part.id}: labelKey must be "parts.${part.id}.label"`);
    }
    if (part.descriptionKey !== `parts.${part.id}.description`) {
      errors.push(`${part.id}: descriptionKey must be "parts.${part.id}.description"`);
    }
    if ((part.meshId === null) === (part.hostPartId === undefined)) {
      errors.push(`${part.id}: set exactly one of meshId and hostPartId`);
    }
    if (part.meshId !== null) {
      const owner = meshOwners.get(part.meshId);
      if (owner !== undefined) {
        errors.push(`${part.id}: meshId "${part.meshId}" is already used by ${owner}`);
      }
      meshOwners.set(part.meshId, part.id);
    }

    const keys = new Set<string>();
    for (const attribute of part.attributes) {
      if (keys.has(attribute.key)) {
        errors.push(`${part.id}.${attribute.key}: duplicate attribute key`);
      }
      keys.add(attribute.key);
      errors.push(...checkAttribute(part.id, attribute));
    }
  }

  // Host resolution needs the whole catalogue, so it gets its own pass.
  for (const part of parts) {
    if (part.hostPartId === undefined) continue;
    const host = byId.get(part.hostPartId);
    if (host === undefined) {
      errors.push(`${part.id}: hostPartId "${part.hostPartId}" is not a part`);
    } else if (host.meshId === null) {
      errors.push(`${part.id}: host "${part.hostPartId}" has no mesh of its own`);
    }
  }

  return errors;
}

function checkAttribute(partId: string, attribute: AttributeDef<string>): string[] {
  const errors: string[] = [];
  const where = `${partId}.${attribute.key}`;

  if (attribute.labelKey !== `parts.attr.${attribute.key}.label`) {
    errors.push(`${where}: labelKey must be "parts.attr.${attribute.key}.label"`);
  }
  if (attribute.helpKey !== undefined && attribute.helpKey !== `parts.attr.${attribute.key}.help`) {
    errors.push(`${where}: helpKey must be "parts.attr.${attribute.key}.help"`);
  }
  if (attribute.kind === "enum" && (attribute.values ?? []).length < 2) {
    errors.push(`${where}: an enum attribute needs at least two values`);
  }
  if (attribute.kind !== "enum" && attribute.values !== undefined) {
    errors.push(`${where}: only an enum attribute carries values`);
  }
  if (attribute.kind !== "number" && (attribute.min !== undefined || attribute.max !== undefined)) {
    errors.push(`${where}: only a number attribute carries min/max`);
  }
  if (
    attribute.default.fallback !== null &&
    !matchesKind(attribute.kind, attribute.default.fallback)
  ) {
    errors.push(`${where}: default fallback does not match kind "${attribute.kind}"`);
  }
  for (const rule of attribute.default.when) {
    if (!matchesKind(attribute.kind, rule.value)) {
      errors.push(`${where}: conditional default does not match kind "${attribute.kind}"`);
    }
  }
  if (attribute.kind === "enum" && attribute.values !== undefined) {
    const allowed = attribute.values;
    const candidates = [
      ...(attribute.default.fallback === null ? [] : [attribute.default.fallback]),
      ...attribute.default.when.map((rule) => rule.value),
    ];
    for (const candidate of candidates) {
      if (!allowed.includes(candidate)) {
        errors.push(`${where}: default "${String(candidate)}" is not one of the values`);
      }
    }
  }

  return errors;
}

export const PartCatalogSchema = z.array(PartDefinitionSchema).check((ctx) => {
  for (const message of checkPartCatalog(ctx.value)) {
    ctx.issues.push({ code: "custom", message, input: ctx.value });
  }
});

/** One part as stored on a bike — the only shape user JSON is ever parsed into. */
export const BikePartSchema: z.ZodType<BikePart> = z.strictObject({
  partId: IdSchema,
  attributes: z.record(IdSchema, AttributeValueSchema),
});
