/**
 * The rules every write to a bike obeys (§4.2), in one zod-free module.
 *
 * ## Why they live here and not in the actions
 *
 * There are three places a bike can be written — the server actions, the guest
 * repo in `localStorage`, and the seed — and all three must produce the same
 * row. Putting "answers are the source of truth, spec and parts are derived"
 * in the action layer would mean writing it three times and drifting twice.
 *
 * ## The rules
 *
 * 1. **`answers` is the source of truth.** Every write recomputes
 *    `spec = buildBikeSpec(answers)` and `parts = partsForSpec(spec)`. A
 *    caller's `spec` is never trusted, never stored as given
 *    ({@link deriveBike}).
 * 2. **Attribute edits survive a change of answers** — for the parts that still
 *    exist, and only for attributes the new spec still has
 *    ({@link mergeAttributes}). A rim-brake bike turned disc keeps its saddle
 *    width and loses its (now absent) brake-pad compound.
 * 3. **One `BikePartState` per fitted part**, created `UNKNOWN`; the states of
 *    parts that vanished are deleted ({@link partStateDiff}).
 * 4. **Quotas** ({@link QUOTAS}) and a 32 KB ceiling on every JSON column
 *    ({@link withinJsonBudget}) — both answered `TOO_MANY`, never an exception
 *    from Postgres.
 *
 * Hand-written validation rather than zod, exactly like
 * `lib/domain/engine/validate-build.ts`: client components import the fit
 * ranges to bound their inputs, and a parser in that import graph would put a
 * copy of zod in the first-load JS of `/velo/[id]/reglages`.
 */
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import { answerWithDefaults, pruneAnswers } from "@/lib/domain/engine/decision";
import { defaultPart, includedParts, isAttributePresent } from "@/lib/domain/engine/parts-for-spec";
import { isValidAttributeValue } from "@/lib/domain/engine/validate-build";
import { partDefinition } from "@/lib/domain/data/parts";
import type { GeometryMeasureId } from "@/lib/domain/data/geometry-measures";
import type { BikeSpec } from "@/lib/domain/schema/bike-spec";
import type { Answers } from "@/lib/domain/schema/decision";
import type { AttributeValue, BikeBuild, BikePart } from "@/lib/domain/schema/part";

// ── Quotas (§4.2 c) ──────────────────────────────────────────────────────────

/**
 * What one account may hold. Generous enough that no real rider meets them and
 * low enough that a script cannot fill the database: twenty bikes is a shop's
 * worth, fifty checkups is a decade of servicing one bike.
 */
export const QUOTAS = {
  bikesPerUser: 20,
  checkupsPerBike: 50,
  listsPerBike: 10,
  itemsPerList: 50,
} as const;

/** Ceiling for every JSON column (`answers`, `spec`, `parts`, `fit`, …). */
export const MAX_JSON_BYTES = 32 * 1024;

/** `Bike.name` is `VarChar(80)`; the form refuses longer before Postgres does. */
export const BIKE_NAME_MAX = 80;

/** Is there room for one more, given how many exist already? */
export function withinQuota(existing: number, max: number): boolean {
  return existing < max;
}

/**
 * UTF-8 size of the JSON encoding of `value`. `TextEncoder`, not `Buffer`:
 * this module is in the import graph of a client component (the fit inputs read
 * `FIT_FIELDS`), and `Buffer` there means a polyfill in the bundle.
 */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

export function withinJsonBudget(value: unknown, max = MAX_JSON_BYTES): boolean {
  return jsonBytes(value) <= max;
}

// ── Derivation (§4.2 a) ──────────────────────────────────────────────────────

export interface DerivedBike {
  /** Pruned: an answer to a question this bike is never asked is dropped. */
  answers: Answers;
  spec: BikeSpec;
  parts: BikePart[];
}

/**
 * Keep the attribute values of `previous` that the new definition still
 * accepts, and default the rest.
 *
 * Only **editable** attributes carry over: the others mirror a decision-tree
 * answer (a brake type, a bar shape) and must follow the new answers, not the
 * old part.
 */
export function mergeAttributes(
  partId: string,
  spec: BikeSpec,
  previous: Readonly<Record<string, AttributeValue>> | undefined,
): Record<string, AttributeValue> {
  const definition = partDefinition(partId);
  if (definition === undefined) return {};
  const fresh = defaultPart(definition, spec).attributes;
  if (previous === undefined) return fresh;

  const merged: Record<string, AttributeValue> = { ...fresh };
  for (const attribute of definition.attributes) {
    if (!attribute.editable || !isAttributePresent(attribute, spec)) continue;
    const value = Object.hasOwn(previous, attribute.key) ? previous[attribute.key] : undefined;
    if (value === undefined) continue;
    if (isValidAttributeValue(attribute, value)) {
      merged[attribute.key] = value;
    }
  }
  return merged;
}

/**
 * The bike these answers describe: the canonical answers, the spec they build,
 * and the parts that spec fits — with the owner's attribute edits carried over
 * from `previousParts` wherever they still apply.
 *
 * This is the ONLY way a `Bike` row's `answers`/`spec`/`parts` are produced,
 * in the actions, in the guest repo and in the seed alike.
 */
export function deriveBike(answers: Answers, previousParts?: readonly BikePart[]): DerivedBike {
  const kept = pruneAnswers(answers);
  const spec = buildBikeSpec(answerWithDefaults(kept));
  const before = new Map((previousParts ?? []).map((part) => [part.partId, part.attributes]));
  const parts = includedParts(spec).map((definition) => ({
    partId: definition.id,
    attributes: mergeAttributes(definition.id, spec, before.get(definition.id)),
  }));
  return { answers: kept, spec, parts };
}

/** `{ spec, parts }` as `BikeBuild`, for the viewer and the guide queries. */
export function buildOf(derived: DerivedBike): BikeBuild {
  return { spec: derived.spec, parts: derived.parts };
}

// ── Part states (§4.2 a) ─────────────────────────────────────────────────────

export interface PartStateDiff {
  /** Part ids with no state row yet — created `UNKNOWN`. */
  create: string[];
  /** State rows whose part is no longer on the bike — deleted. */
  remove: string[];
}

/**
 * Which `BikePartState` rows to add and which to drop after a change of
 * answers. Untouched rows keep their status, their notes and their service
 * dates: replacing a cassette does not forget that the chain was serviced.
 */
export function partStateDiff(
  existingPartIds: Iterable<string>,
  nextPartIds: Iterable<string>,
): PartStateDiff {
  const existing = new Set(existingPartIds);
  const next = new Set(nextPartIds);
  return {
    create: [...next].filter((id) => !existing.has(id)),
    remove: [...existing].filter((id) => !next.has(id)),
  };
}

// ── Fit (§5.6) ───────────────────────────────────────────────────────────────

/**
 * One stored measurement. Every field is a number in the unit named by its
 * suffix — no unit ever travels with a value, and nothing is stored in inches.
 */
export interface FitFieldDef {
  key: FitKey;
  /** The `/reglages` card this input belongs to. */
  measureId: GeometryMeasureId;
  unit: "mm" | "cm" | "kg" | "percent";
  min: number;
  max: number;
  /** Input granularity; also the number of decimals shown. */
  step: number;
}

export const FIT_FIELDS = [
  { key: "inseamCm", measureId: "saddle-height", unit: "cm", min: 50, max: 110, step: 0.5 },
  { key: "saddleHeightMm", measureId: "saddle-height", unit: "mm", min: 500, max: 900, step: 1 },
  { key: "saddleSetbackMm", measureId: "saddle-setback", unit: "mm", min: -50, max: 150, step: 1 },
  { key: "reachMm", measureId: "reach", unit: "mm", min: 300, max: 700, step: 1 },
  { key: "barDropMm", measureId: "bar-drop", unit: "mm", min: -150, max: 150, step: 1 },
  { key: "cleatPositionMm", measureId: "cleat-position", unit: "mm", min: -30, max: 30, step: 1 },
  { key: "riderKg", measureId: "tire-pressure", unit: "kg", min: 20, max: 200, step: 0.5 },
  { key: "bikeKg", measureId: "tire-pressure", unit: "kg", min: 3, max: 40, step: 0.1 },
  { key: "sagPercent", measureId: "sag", unit: "percent", min: 0, max: 60, step: 1 },
  { key: "chainWearMm", measureId: "chain-wear", unit: "mm", min: 290, max: 330, step: 0.1 },
] as const satisfies readonly FitFieldDef[];

export type FitKey =
  | "inseamCm"
  | "saddleHeightMm"
  | "saddleSetbackMm"
  | "reachMm"
  | "barDropMm"
  | "cleatPositionMm"
  | "riderKg"
  | "bikeKg"
  | "sagPercent"
  | "chainWearMm";

export const FIT_KEYS: readonly FitKey[] = FIT_FIELDS.map((field) => field.key);

/** What `Bike.fit` / `va:bike:local.fit` holds. Every key optional, every value a number. */
export type BikeFit = Partial<Record<FitKey, number>>;

const FIT_FIELD_BY_KEY: ReadonlyMap<string, FitFieldDef> = new Map(
  FIT_FIELDS.map((field) => [field.key, field]),
);

export function fitFieldsFor(measureId: GeometryMeasureId): FitFieldDef[] {
  return FIT_FIELDS.filter((field) => field.measureId === measureId);
}

export function fitField(key: string): FitFieldDef | undefined {
  return FIT_FIELD_BY_KEY.get(key);
}

/** Is `value` an acceptable number for the fit field `key`? */
export function isValidFitValue(key: string, value: unknown): value is number {
  const field = FIT_FIELD_BY_KEY.get(key);
  if (field === undefined) return false;
  return (
    typeof value === "number" && Number.isFinite(value) && value >= field.min && value <= field.max
  );
}

/**
 * Parse untrusted JSON (a form, a localStorage payload, a server action's
 * input) into a `BikeFit`.
 *
 * Strict on purpose: an unknown key or an out-of-range value makes the whole
 * object `null` rather than being silently dropped, so a client that is writing
 * garbage hears about it instead of watching half its numbers disappear.
 * `null` and `undefined` mean "no fit recorded" and parse to `{}`.
 */
export function parseFit(input: unknown): BikeFit | null {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return null;

  const fit: BikeFit = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    // A cleared input arrives as null; that is a removal, not a violation.
    if (value === null || value === undefined) continue;
    if (!isValidFitValue(key, value)) return null;

    fit[key as FitKey] = value;
  }
  return fit;
}

/**
 * The same parse, tolerant: unknown or out-of-range entries are dropped and the
 * rest is kept. Used when reading storage a previous release wrote, where
 * refusing the whole object would lose good data.
 */
export function coerceFit(input: unknown): BikeFit {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const fit: BikeFit = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isValidFitValue(key, value)) fit[key as FitKey] = value;
  }
  return fit;
}

/** `previous` with `patch` applied; a `null` value clears its key. */
export function mergeFit(previous: BikeFit | null | undefined, patch: BikeFit): BikeFit {
  const merged: BikeFit = { ...(previous ?? {}) };
  for (const key of FIT_KEYS) {
    // eslint-disable-next-line security/detect-object-injection -- `key` is a FitKey literal
    const value = patch[key];
    // eslint-disable-next-line security/detect-object-injection -- same
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}
