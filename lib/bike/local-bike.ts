/**
 * The guest bike in `localStorage` (§1.2 `va:bike:local`): exactly one bike,
 * no account needed, imported into the account on first sign-in (§4, W3-T3).
 *
 *   { version: 1, id: uuid, answers, spec, parts, fit, updatedAt }
 *
 * Storage is untrusted input. Reading goes through a `zod/mini` schema (this
 * module is bundled for the browser, where classic zod is banned), and a value
 * that does not parse is **dropped** — removed from storage — rather than
 * half-used. Past the envelope, `answers` stay the source of truth: the spec is
 * always re-derived from them, and the stored parts survive only if
 * `validateBuild` accepts them against that fresh spec (they carry the owner's
 * attribute edits); otherwise the default parts are rebuilt.
 *
 * Heavy on purpose, so import it lazily from pages that must stay light (the
 * home page loads it only when "Générer mon vélo" is pressed): it pulls the
 * part catalogue in.
 */
import * as z from "zod/mini";

import { QUESTION_IDS } from "@/lib/domain/data/decision-tree";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import { answerWithDefaults, pruneAnswers } from "@/lib/domain/engine/decision";
import { partsForSpec } from "@/lib/domain/engine/parts-for-spec";
import { validateBuild } from "@/lib/domain/engine/validate-build";
import type { BikeSpec } from "@/lib/domain/schema/bike-spec";
import type { Answers } from "@/lib/domain/schema/decision";
import type { BikePart } from "@/lib/domain/schema/part";

import { LOCAL_BIKE_KEY } from "./storage-keys";

/** The envelope version this release writes. */
export const LOCAL_BIKE_VERSION = 1;

/**
 * Remembered fit measurements (`/velo/local/reglages`, W2-T3 owns their
 * meaning and ranges). Here only the shape a JSON map of scalars can take.
 */
export type LocalBikeFit = Record<string, number | string | boolean>;

export interface LocalBike {
  version: typeof LOCAL_BIKE_VERSION;
  /** Generated on creation; becomes `Bike.guestLocalId` on import (dedupes re-imports). */
  id: string;
  answers: Answers;
  spec: BikeSpec;
  parts: BikePart[];
  fit: LocalBikeFit | null;
  /** ISO 8601. */
  updatedAt: string;
}

const OptionId = z.string().check(z.regex(/^[a-z0-9-]+$/), z.maxLength(32));

/** What is accepted from storage before the domain validates the build. */
export const StoredLocalBikeSchema = z.object({
  version: z.literal(LOCAL_BIKE_VERSION),
  id: z.uuid(),
  answers: z.partialRecord(z.enum(QUESTION_IDS), OptionId),
  spec: z.unknown(),
  parts: z.array(z.unknown()),
  fit: z.nullable(
    z.record(
      z.string().check(z.maxLength(64)),
      z.union([z.number().check(z.refine(Number.isFinite)), z.string(), z.boolean()]),
    ),
  ),
  updatedAt: z.iso.datetime({ offset: true }),
});

/** The storage a caller passes — `window.localStorage` by default, a fake in tests. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Safari private mode, blocked site data: behave as if nothing is stored.
    return null;
  }
}

/**
 * A v4 UUID. `crypto.randomUUID` exists only in secure contexts (https,
 * localhost); a LAN IP over plain http gets the `getRandomValues` fallback.
 */
export function newLocalBikeId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The spec for these answers, unanswered questions at their defaults. */
function specFor(answers: Answers): BikeSpec {
  return buildBikeSpec(answerWithDefaults(answers));
}

/** `parts` if the domain accepts them for `spec`, else the default parts. */
function partsFor(spec: BikeSpec, parts: unknown): BikePart[] {
  if (parts !== undefined) {
    const result = validateBuild({ spec, parts });
    if (result.ok) return result.build.parts;
  }
  return partsForSpec(spec);
}

/**
 * Parse a raw storage value. `null` when absent or invalid — the caller decides
 * whether to drop it ({@link readLocalBike} does).
 */
export function parseLocalBike(raw: string | null): LocalBike | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = StoredLocalBikeSchema.safeParse(json);
  if (!parsed.success) return null;

  const { id, fit, updatedAt } = parsed.data;
  const answers = pruneAnswers(parsed.data.answers);
  const spec = specFor(answers);
  return {
    version: LOCAL_BIKE_VERSION,
    id,
    answers,
    spec,
    parts: partsFor(spec, parsed.data.parts),
    fit,
    updatedAt,
  };
}

/** The stored guest bike, or `null`. An unreadable value is removed from storage. */
export function readLocalBike(
  storage: KeyValueStorage | null = defaultStorage(),
): LocalBike | null {
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(LOCAL_BIKE_KEY);
  } catch {
    return null;
  }
  const bike = parseLocalBike(raw);
  if (bike === null && raw !== null) clearLocalBike(storage);
  return bike;
}

/** Is a readable guest bike stored? */
export function hasLocalBike(storage: KeyValueStorage | null = defaultStorage()): boolean {
  return readLocalBike(storage) !== null;
}

export interface WriteLocalBikeInput {
  answers: Answers;
  /** Kept when valid for the new spec (attribute edits); otherwise rebuilt from the spec. */
  parts?: unknown;
  fit?: LocalBikeFit | null;
  /** Keep this id (an update); omit to create a NEW bike with a fresh id. */
  id?: string;
}

export interface WriteLocalBikeOptions {
  storage?: KeyValueStorage | null;
  now?: () => Date;
  newId?: () => string;
}

/**
 * Store the guest bike, replacing any previous one. The spec is derived from
 * the answers here, whatever the caller holds (§1.2: answers are the source of
 * truth; spec and parts are recomputed on every write).
 *
 * Returns the bike as written, or `null` when storage is unavailable or full —
 * the caller tells the visitor instead of pretending it saved.
 */
export function writeLocalBike(
  input: WriteLocalBikeInput,
  {
    storage = defaultStorage(),
    now = () => new Date(),
    newId = newLocalBikeId,
  }: WriteLocalBikeOptions = {},
): LocalBike | null {
  const answers = pruneAnswers(input.answers);
  const spec = specFor(answers);
  const bike: LocalBike = {
    version: LOCAL_BIKE_VERSION,
    id: input.id !== undefined && z.uuid().safeParse(input.id).success ? input.id : newId(),
    answers,
    spec,
    parts: partsFor(spec, input.parts),
    fit: input.fit ?? null,
    updatedAt: now().toISOString(),
  };
  if (storage === null) return null;
  try {
    storage.setItem(LOCAL_BIKE_KEY, JSON.stringify(bike));
  } catch {
    return null;
  }
  return bike;
}

/** Remove the guest bike (after an import, or when it is unreadable). */
export function clearLocalBike(storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(LOCAL_BIKE_KEY);
  } catch {
    // Nothing to do: storage that cannot be written cannot hold a stale bike either.
  }
}
