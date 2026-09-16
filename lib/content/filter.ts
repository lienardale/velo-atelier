/**
 * The `/guides` filter (§6.2): kind, part system and "Pour mon vélo".
 *
 * Its own module because it runs in the browser: it must not pull the part
 * catalogue (`./guides.ts` needs it to derive systems, which the server does
 * once, into `GuideSummary.systems`), nor any zod. Everything here reads
 * untrusted input — the query string, `localStorage` — and treats anything it
 * does not recognise as absent, never as an error (§6.2: "unknown ignored").
 */
import { PART_SYSTEMS } from "@/lib/domain/data/conventions";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import { answerWithDefaults, pruneAnswers } from "@/lib/domain/engine/decision";
import type { BikeSpec } from "@/lib/domain/schema/bike-spec";
import type { Answers } from "@/lib/domain/schema/decision";

import { matchesSpec } from "./applies-to";
import type { GuideSummary } from "./types";

/** The kinds, in `/guides` display order (mirrors `GUIDE_KIND_ORDER`, without the catalogue import). */
export const FILTER_KINDS = ["check", "adjust", "clean", "replace", "measure"] as const;

export type FilterKind = (typeof FILTER_KINDS)[number];

/** Which bike "Pour mon vélo" filters for: the visitor's guest bike, or the demo bike. */
export const FILTER_BIKES = ["local", "demo"] as const;

export type FilterBike = (typeof FILTER_BIKES)[number];

/** The guest bike's localStorage key (§1.2 `va:bike:local`). */
export const LOCAL_BIKE_KEY = "va:bike:local";

/** The preset the demo bike is built from (§6.2). */
export const DEMO_PRESET = "gravel-1x11" as const;

export interface GuideFilterState {
  kind: FilterKind | null;
  system: string | null;
  bike: FilterBike | null;
}

const oneOf = <T extends string>(values: readonly T[], value: string | null): T | null =>
  value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;

/** `?kind=&system=&bike=` → a state; unknown values are dropped. */
export function parseGuideFilter(params: Pick<URLSearchParams, "get">): GuideFilterState {
  return {
    kind: oneOf(FILTER_KINDS, params.get("kind")),
    system: oneOf(PART_SYSTEMS, params.get("system")),
    bike: oneOf(FILTER_BIKES, params.get("bike")),
  };
}

/**
 * The query string for `state`, keeping every parameter the filter does not
 * own (`?utm_…` stays). Empty string when nothing is left.
 */
export function serializeGuideFilter(state: GuideFilterState, current = ""): string {
  const params = new URLSearchParams(current);
  for (const key of ["kind", "system", "bike"] as const) {
    // eslint-disable-next-line security/detect-object-injection -- `key` iterates a literal tuple
    const value = state[key];
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** A stored answers record, or `null` when the value is not one. */
function answersFrom(value: unknown): Answers | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(
    ([key, answer]) =>
      typeof answer === "string" && answer.length <= 32 && /^[a-z0-9-]+$/.test(key),
  );
  return Object.fromEntries(entries) as Answers;
}

/** The spec of the guest bike stored under `va:bike:local`, or `null`. */
export function specFromStoredBike(raw: string | null): BikeSpec | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const answers =
      typeof parsed === "object" && parsed !== null
        ? answersFrom((parsed as { answers?: unknown }).answers)
        : null;
    return answers ? buildBikeSpec(answerWithDefaults(pruneAnswers(answers))) : null;
  } catch {
    return null;
  }
}

/** The demo bike's spec. */
export function demoSpec(): BikeSpec {
  // eslint-disable-next-line security/detect-object-injection -- a literal preset id
  return buildBikeSpec(answerWithDefaults(BIKE_PRESETS[DEMO_PRESET]));
}

export interface GuideFilter {
  kind?: string | null;
  system?: string | null;
  /** When set, only the guides whose `appliesTo` matches this spec. */
  spec?: unknown;
}

export function filterGuides<T extends Pick<GuideSummary, "kind" | "systems" | "appliesTo">>(
  guides: readonly T[],
  filter: GuideFilter,
): T[] {
  return guides.filter(
    (guide) =>
      (!filter.kind || guide.kind === filter.kind) &&
      (!filter.system || guide.systems.includes(filter.system)) &&
      (filter.spec === undefined ||
        filter.spec === null ||
        matchesSpec(guide.appliesTo, filter.spec)),
  );
}
