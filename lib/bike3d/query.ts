/**
 * Query parameters the viewer reads and writes (§3.3 URL sync, dev pages).
 *
 *   ?part=<PartId>            the selected part
 *   ?parts=<PartId>,<PartId>  the picked parts (pick mode)
 *   ?preset= ?quality= ?mode= dev pages only
 *
 * Everything that arrives from a URL is untrusted: a value is either exactly
 * a known id or it is dropped. Hand-written guards (no zod) because this module
 * ships in the eager client bundle. `tests/security/bike3d-query-params.test.ts`
 * holds the hostile inputs.
 */
import { isPartId, PART_IDS, type PartId } from "@/lib/domain/data/parts";
import { isPresetId, type PresetId } from "@/lib/domain";

import { isQualityTier } from "./quality";
import type { QualityTier, ViewerMode } from "./types";

/** Longest `?parts=` we even look at: every id once, plus separators. */
export const MAX_PARTS_PARAM_LENGTH = PART_IDS.reduce((n, id) => n + id.length + 1, 0);

type RawParam = string | readonly string[] | undefined | null;

/** Next's `searchParams` values are `string | string[] | undefined`: take the first string. */
export function firstValue(value: RawParam | unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export function parsePartId(value: RawParam | unknown): PartId | null {
  const raw = firstValue(value);
  return raw !== undefined && raw.length <= 32 && isPartId(raw) ? raw : null;
}

/** Comma-separated part ids → unique valid ids in order; anything else is dropped. */
export function parsePartIds(value: RawParam | unknown): PartId[] {
  const raw = firstValue(value);
  if (raw === undefined || raw.length === 0 || raw.length > MAX_PARTS_PARAM_LENGTH) return [];
  const ids: PartId[] = [];
  for (const token of raw.split(",")) {
    if (isPartId(token) && !ids.includes(token)) ids.push(token);
  }
  return ids;
}

export function serializePartIds(ids: Iterable<PartId>): string {
  return [...ids].join(",");
}

export function parsePresetId(value: RawParam | unknown): PresetId | null {
  const raw = firstValue(value);
  return raw !== undefined && raw.length <= 32 && isPresetId(raw) ? raw : null;
}

export function parseQuality(value: RawParam | unknown): QualityTier | null {
  const raw = firstValue(value);
  return isQualityTier(raw) ? raw : null;
}

export function parseViewerMode(value: RawParam | unknown): ViewerMode {
  return firstValue(value) === "pick" ? "pick" : "browse";
}

export interface ViewerQuery {
  part: PartId | null;
  parts: PartId[];
  preset: PresetId | null;
  quality: QualityTier | null;
  mode: ViewerMode;
}

/** Whitelist the viewer's parameters out of a Next `searchParams` object. */
export function parseViewerQuery(searchParams: unknown): ViewerQuery {
  const get = (key: string): unknown =>
    searchParams !== null && typeof searchParams === "object" && Object.hasOwn(searchParams, key)
      ? (searchParams as Record<string, unknown>)[key]
      : undefined;
  return {
    part: parsePartId(get("part")),
    parts: parsePartIds(get("parts")),
    preset: parsePresetId(get("preset")),
    quality: parseQuality(get("quality")),
    mode: parseViewerMode(get("mode")),
  };
}

/**
 * The URL with `?part=` / `?parts=` set (or removed) and every other parameter
 * and the hash preserved. Returns a path + search + hash string for
 * `history.replaceState`.
 */
export function withViewerParams(
  href: string,
  selected: PartId | null,
  picked: readonly PartId[],
): string {
  const url = new URL(href, "http://localhost");
  if (selected) url.searchParams.set("part", selected);
  else url.searchParams.delete("part");
  if (picked.length > 0) url.searchParams.set("parts", serializePartIds(picked));
  else url.searchParams.delete("parts");
  // Always a single-slash path on this origin: never `//host` (scheme-relative)
  // and never an opaque path such as `alert(1)` from a `javascript:` href.
  const pathname = `/${url.pathname.replace(/^\/+/, "")}`;
  return `${pathname}${url.search}${url.hash}`;
}
