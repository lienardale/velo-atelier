/**
 * The only way user-supplied JSON becomes a `BikeBuild` (§1.2, §2.5), and the
 * edits an owner can make to one.
 *
 * `validateBuild(input: unknown)` checks, in order:
 *
 *   - the envelope is exactly `{ spec, parts }` — any other key is refused;
 *   - `spec` is a well-formed `BikeSpec`, every key known and every leaf one of
 *     its allowed values;
 *   - at most {@link MAX_BUILD_PARTS} parts, each exactly `{ partId, attributes }`;
 *   - every `partId` is in the catalogue, fitted at most once, and either
 *     included on this bike or `optional`; every required part is there;
 *   - every attribute key belongs to the part and is present on this bike
 *     (`presentWhen`); enum values are one of the values, numbers are finite and
 *     inside `min`/`max`, booleans are booleans, text is ≤ {@link MAX_TEXT_LENGTH}
 *     characters;
 *   - no prototype key anywhere: `__proto__`, `constructor` and friends are
 *     unknown keys like any other, and nothing is ever copied by spreading the
 *     input.
 *
 * The result is a fresh object built from the checked values only; server
 * actions persist **only** `validateBuild(…).build` (§4.4).
 *
 * Deviation from the plan's "zod parse": the checks are hand-written, because
 * this module is re-exported by the zod-free barrel (`meshIdsForSpec` and the
 * edit helpers run in client components, §3.1 and §6.4).
 * `validate-build.test.ts` holds the hand-written spec check to
 * `BikeSpecSchema` with a property test, so the two cannot drift.
 */
import {
  BAR_SHAPES,
  BATTERY_POSITIONS,
  BRAKE_MOUNTS,
  BRAKE_TYPES,
  DISCIPLINES,
  DRIVE_KINDS,
  DRIVETRAIN_KINDS,
  ETRTO_DIAMETERS,
  FRAME_STYLES,
  MOTOR_POSITIONS,
  PEDAL_IDS,
  SHIFTER_IDS,
  TIRE_SYSTEMS,
  TRANSMISSIONS,
  WHEEL_LABELS,
} from "../data/conventions";
import { hasMesh, PART_IDS, PARTS, partDefinition, type CatalogPart } from "../data/parts";
import { rotorSizeFor } from "../data/parts/brakes";
import type { BikeSpec } from "../schema/bike-spec";
import type { AttributeDef, AttributeValue, BikeBuild, BikePart } from "../schema/part";

import {
  defaultPart,
  findPart,
  includedParts,
  isAttributePresent,
  isPartIncluded,
} from "./parts-for-spec";

/** A bike has 48 parts at most; the margin covers forward-compatible additions. */
export const MAX_BUILD_PARTS = 80;

/** Longest free-text attribute (a derailleur hanger model, a pad reference). */
export const MAX_TEXT_LENGTH = 64;

export type BuildIssueCode =
  | "invalid-shape"
  | "unknown-key"
  | "too-many-parts"
  | "unknown-part"
  | "duplicate-part"
  | "part-not-allowed"
  | "missing-part"
  | "unknown-attribute"
  | "invalid-value";

export interface BuildIssue {
  /** Dotted path into the input: `spec.brakes.type`, `parts.3.attributes.speeds`. */
  path: string;
  code: BuildIssueCode;
}

export type ValidateBuildResult =
  { ok: true; build: BikeBuild; issues: [] } | { ok: false; build: null; issues: BuildIssue[] };

// ── Plain values ─────────────────────────────────────────────────────────────

type PlainObject = Record<string, unknown>;

/** A JSON object: not null, not an array, and no prototype but `Object`'s (or none). */
export function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** An own property, or `undefined` — never an inherited one. */
function own(object: PlainObject, key: string): unknown {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn: prototype keys never resolve
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

// ── The spec ─────────────────────────────────────────────────────────────────

type Shape =
  | { t: "one-of"; values: readonly unknown[] }
  | { t: "record"; fields: Readonly<Record<string, Shape>> }
  | { t: "nullable"; shape: Shape };

const oneOf = (values: readonly unknown[]): Shape => ({ t: "one-of", values });
const record = (fields: Record<string, Shape>): Shape => ({ t: "record", fields });
const nullable = (shape: Shape): Shape => ({ t: "nullable", shape });
const BOOLEAN = oneOf([true, false]);

/** `BikeSpecSchema`, restated as data (§2.2). */
const SPEC_SHAPE = record({
  version: oneOf([1]),
  drive: oneOf(DRIVE_KINDS),
  discipline: oneOf(DISCIPLINES),
  wheel: record({ label: oneOf(WHEEL_LABELS), etrtoDiameter: oneOf(ETRTO_DIAMETERS) }),
  brakes: record({
    type: oneOf(BRAKE_TYPES),
    isDisc: BOOLEAN,
    mount: nullable(oneOf(BRAKE_MOUNTS)),
  }),
  drivetrain: record({
    kind: oneOf(DRIVETRAIN_KINDS),
    chainrings: oneOf([1, 2, 3]),
    speeds: oneOf(Array.from({ length: 14 }, (_, index) => index + 1)),
    transmission: oneOf(TRANSMISSIONS),
    shifter: nullable(oneOf(SHIFTER_IDS)),
  }),
  cockpit: record({ bar: oneOf(BAR_SHAPES) }),
  pedals: oneOf(PEDAL_IDS),
  suspension: record({ front: BOOLEAN, rear: BOOLEAN }),
  seatpost: record({ dropper: BOOLEAN }),
  tires: record({ system: oneOf(TIRE_SYSTEMS) }),
  eSystem: nullable(
    record({ motorPosition: oneOf(MOTOR_POSITIONS), batteryPosition: oneOf(BATTERY_POSITIONS) }),
  ),
  frameStyle: oneOf(FRAME_STYLES),
});

function checkShape(shape: Shape, value: unknown, path: string, issues: BuildIssue[]): void {
  if (shape.t === "one-of") {
    if (!shape.values.includes(value)) issues.push({ path, code: "invalid-value" });
  } else if (shape.t === "nullable") {
    if (value !== null) checkShape(shape.shape, value, path, issues);
  } else if (!isPlainObject(value)) {
    issues.push({ path, code: "invalid-shape" });
  } else {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(shape.fields, key))
        issues.push({ path: `${path}.${key}`, code: "unknown-key" });
    }
    for (const [key, field] of Object.entries(shape.fields)) {
      checkShape(field, own(value, key), `${path}.${key}`, issues);
    }
  }
}

/** The problems with a would-be `BikeSpec`; empty when it is one. */
export function specIssues(value: unknown): BuildIssue[] {
  const issues: BuildIssue[] = [];
  checkShape(SPEC_SHAPE, value, "spec", issues);
  return issues;
}

// ── Attribute values ─────────────────────────────────────────────────────────

/** Is `value` a legal value for this attribute (§2.5)? */
export function isValidAttributeValue(attribute: AttributeDef, value: unknown): boolean {
  switch (attribute.kind) {
    case "enum":
      return (attribute.values as readonly unknown[]).includes(value);
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= (attribute.min ?? -Infinity) &&
        value <= (attribute.max ?? Infinity)
      );
    case "text":
      return typeof value === "string" && value.length <= MAX_TEXT_LENGTH;
  }
}

/**
 * A form value turned into the attribute's type, or `undefined` when it is not
 * a legal value: `"11"` → `11` for a numeric enum, `"27.2"` → `27.2` for a
 * number attribute.
 */
export function coerceAttributeValue(
  attribute: AttributeDef,
  value: AttributeValue,
): AttributeValue | undefined {
  if (attribute.kind === "enum") {
    return (attribute.values as readonly AttributeValue[]).find(
      (candidate) => String(candidate) === String(value),
    );
  }
  const candidate =
    attribute.kind === "number" && typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : value;
  return isValidAttributeValue(attribute, candidate) ? candidate : undefined;
}

// ── validateBuild ────────────────────────────────────────────────────────────

const failure = (issues: BuildIssue[]): ValidateBuildResult => ({ ok: false, build: null, issues });

function checkAttributes(
  raw: unknown,
  definition: CatalogPart,
  spec: BikeSpec,
  path: string,
  issues: BuildIssue[],
): Record<string, AttributeValue> {
  const attributes: Record<string, AttributeValue> = {};
  if (!isPlainObject(raw)) {
    issues.push({ path, code: "invalid-shape" });
    return attributes;
  }
  for (const [key, value] of Object.entries(raw)) {
    const attribute = definition.attributes.find((candidate) => candidate.key === key);
    if (attribute === undefined || !isAttributePresent(attribute, spec)) {
      issues.push({ path: `${path}.${key}`, code: "unknown-attribute" });
    } else if (!isValidAttributeValue(attribute, value)) {
      issues.push({ path: `${path}.${key}`, code: "invalid-value" });
    } else {
      // eslint-disable-next-line security/detect-object-injection -- `key` is an attribute key of the catalogue, checked just above
      attributes[key] = value as AttributeValue;
    }
  }
  return attributes;
}

function checkPart(
  raw: unknown,
  path: string,
  spec: BikeSpec,
  seen: Set<string>,
  issues: BuildIssue[],
): BikePart | null {
  if (!isPlainObject(raw)) {
    issues.push({ path, code: "invalid-shape" });
    return null;
  }
  for (const key of Object.keys(raw)) {
    if (key !== "partId" && key !== "attributes") {
      issues.push({ path: `${path}.${key}`, code: "unknown-key" });
    }
  }
  const partId = own(raw, "partId");
  const definition = typeof partId === "string" ? partDefinition(partId) : undefined;
  if (definition === undefined) {
    issues.push({ path: `${path}.partId`, code: "unknown-part" });
    return null;
  }
  if (seen.has(definition.id)) {
    issues.push({ path: `${path}.partId`, code: "duplicate-part" });
    return null;
  }
  seen.add(definition.id);
  if (!definition.optional && !isPartIncluded(definition, spec)) {
    issues.push({ path: `${path}.partId`, code: "part-not-allowed" });
    return null;
  }
  const attributes = checkAttributes(
    own(raw, "attributes"),
    definition,
    spec,
    `${path}.attributes`,
    issues,
  );
  return { partId: definition.id, attributes };
}

/** Parse untrusted JSON into a `BikeBuild`, or say precisely why not. */
export function validateBuild(input: unknown): ValidateBuildResult {
  if (!isPlainObject(input)) return failure([{ path: "", code: "invalid-shape" }]);

  const issues: BuildIssue[] = [];
  for (const key of Object.keys(input)) {
    if (key !== "spec" && key !== "parts") issues.push({ path: key, code: "unknown-key" });
  }
  const rawSpec = own(input, "spec");
  issues.push(...specIssues(rawSpec));

  const rawParts = own(input, "parts");
  if (!Array.isArray(rawParts)) {
    issues.push({ path: "parts", code: "invalid-shape" });
    return failure(issues);
  }
  if (rawParts.length > MAX_BUILD_PARTS) {
    issues.push({ path: "parts", code: "too-many-parts" });
    return failure(issues);
  }
  // Which parts are allowed depends on the spec: a broken spec ends the check here.
  if (issues.length > 0) return failure(issues);

  const spec = structuredClone(rawSpec) as BikeSpec;
  const seen = new Set<string>();
  const parts: BikePart[] = [];
  rawParts.forEach((raw, index) => {
    const part = checkPart(raw, `parts.${index}`, spec, seen, issues);
    if (part !== null) parts.push(part);
  });
  for (const definition of includedParts(spec)) {
    if (!definition.optional && !seen.has(definition.id)) {
      issues.push({ path: `parts.${definition.id}`, code: "missing-part" });
    }
  }

  return issues.length > 0 ? failure(issues) : { ok: true, build: { spec, parts }, issues: [] };
}

// ── Edits ────────────────────────────────────────────────────────────────────

export type BuildChangeCode =
  | "unknown-part"
  | "part-not-fitted"
  | "unknown-attribute"
  | "not-editable"
  | "invalid-value"
  | "not-optional"
  | "already-fitted";

export type BuildChange = { ok: true; build: BikeBuild } | { ok: false; code: BuildChangeCode };

const CATALOGUE_ORDER: ReadonlyMap<string, number> = new Map(
  PART_IDS.map((id, index) => [id, index]),
);

function inCatalogueOrder(parts: BikePart[]): BikePart[] {
  return [...parts].sort(
    (left, right) =>
      (CATALOGUE_ORDER.get(left.partId) as number) - (CATALOGUE_ORDER.get(right.partId) as number),
  );
}

/**
 * Set (or, with `null`, clear) one editable attribute of a fitted part — the
 * attributes that mirror a decision-tree answer (`editable: false`) change
 * with the answer instead. Form strings are
 * coerced (`"11"` → `11`); a caliper's `rotor-size` follows a change of its
 * `mount` or `adapter` ({@link rotorSizeFor}).
 */
export function setAttribute(
  build: BikeBuild,
  partId: string,
  key: string,
  value: AttributeValue | null,
): BuildChange {
  const definition = partDefinition(partId);
  if (definition === undefined) return { ok: false, code: "unknown-part" };
  const current = findPart(build, partId);
  if (current === undefined) return { ok: false, code: "part-not-fitted" };
  const attribute = definition.attributes.find((candidate) => candidate.key === key);
  if (attribute === undefined || !isAttributePresent(attribute, build.spec)) {
    return { ok: false, code: "unknown-attribute" };
  }
  // Mirrors of a decision-tree answer (brake type, bar shape…) change with the answer, not here.
  if (!attribute.editable) return { ok: false, code: "not-editable" };

  const attributes: Record<string, AttributeValue> = { ...current.attributes };
  if (value === null) {
    // eslint-disable-next-line security/detect-object-injection -- `key` is an attribute key of the catalogue, checked above
    delete attributes[key];
  } else {
    const coerced = coerceAttributeValue(attribute, value);
    if (coerced === undefined) return { ok: false, code: "invalid-value" };
    // eslint-disable-next-line security/detect-object-injection -- `key` is an attribute key of the catalogue, checked above
    attributes[key] = coerced;
  }

  if (key === "mount" || key === "adapter") {
    const size = rotorSizeFor(attributes.mount, attributes.adapter);
    if (size === null) delete attributes["rotor-size"];
    else attributes["rotor-size"] = size;
  }

  const parts = build.parts.map((part) => (part.partId === partId ? { partId, attributes } : part));
  return { ok: true, build: { spec: build.spec, parts } };
}

/** Fit an optional part (a rack, a cassette in place of a freewheel) with its defaults. */
export function addOptionalPart(build: BikeBuild, partId: string): BuildChange {
  const definition = partDefinition(partId);
  if (definition === undefined) return { ok: false, code: "unknown-part" };
  if (!definition.optional) return { ok: false, code: "not-optional" };
  if (findPart(build, partId) !== undefined) return { ok: false, code: "already-fitted" };
  const parts = inCatalogueOrder([...build.parts, defaultPart(definition, build.spec)]);
  return { ok: true, build: { spec: build.spec, parts } };
}

/** Take an optional part off. Required parts cannot be removed. */
export function removeOptionalPart(build: BikeBuild, partId: string): BuildChange {
  const definition = partDefinition(partId);
  if (definition === undefined) return { ok: false, code: "unknown-part" };
  if (!definition.optional) return { ok: false, code: "not-optional" };
  if (findPart(build, partId) === undefined) return { ok: false, code: "part-not-fitted" };
  const parts = build.parts.filter((part) => part.partId !== partId);
  return { ok: true, build: { spec: build.spec, parts } };
}

/** Optional parts this bike does not have by default — what "add a part" offers. */
export function optionalPartsFor(spec: BikeSpec): CatalogPart[] {
  return PARTS.filter((definition) => definition.optional && !isPartIncluded(definition, spec));
}

/** The meshes the 3D viewer draws for this bike (§3.1). */
export function meshIdsForSpec(spec: BikeSpec): string[] {
  return includedParts(spec)
    .filter(hasMesh)
    .map((definition) => definition.meshId as string);
}
