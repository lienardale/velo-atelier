/**
 * Every `localStorage` key a guest's data lives under (§1.2).
 *
 * One module so the guest import (`/import`, W3-T3) can list exactly what it
 * reads and clears, and so no feature invents a key the import forgets. Every
 * value stored under these keys is parsed with a `zod/mini` schema (or a
 * hand-written guard) on read and dropped on parse failure — storage is user
 * input like any other.
 *
 * Plain TS, no React, no zod: safe to import from anywhere, the home page
 * included.
 */

/** The prefix of every key this site writes. */
export const STORAGE_PREFIX = "va:";

/** The one guest bike: `{ version: 1, id, answers, spec, parts, fit, updatedAt }` (`lib/bike/local-bike.ts`). */
export const LOCAL_BIKE_KEY = "va:bike:local";

/** The two bikes a guest can run a checkup or a build list on without an account. */
export const GUEST_BIKE_REFS = ["demo", "local"] as const;

export type GuestBikeRef = (typeof GUEST_BIKE_REFS)[number];

/** `va:checkup:<demo|local>` — the checkup in progress (W3-T1). */
export function checkupKey(ref: GuestBikeRef): string {
  return `va:checkup:${ref}`;
}

/** `va:buildlist:<demo|local>` — the to-fix list (W3-T2). */
export function buildListKey(ref: GuestBikeRef): string {
  return `va:buildlist:${ref}`;
}

/** `va:measure:<id>` — one remembered measurement (§5.6). Ids follow the domain's id pattern. */
export function measureKey(measureId: string): string {
  if (!/^[a-z0-9-]{1,64}$/.test(measureId)) {
    throw new Error(`measureKey(): invalid measure id ${JSON.stringify(measureId)}`);
  }
  return `va:measure:${measureId}`;
}

/** `va:bike3d:quality` — the viewer quality the visitor picked (W2-T1). */
export const BIKE3D_QUALITY_KEY = "va:bike3d:quality";

/**
 * The decision tree's help panel remembers whether it is open under this
 * `Disclosure` persist key (stored as `va:ui:disclosure:<key>` by
 * `components/ui-ext/Disclosure.tsx`). A UI preference, not guest data: the
 * import ignores it.
 */
export const DECISION_HELP_PERSIST_KEY = "decision-tree-help";

/**
 * Every key that holds guest DATA (what `/import` sends to the server and then
 * clears). `va:measure:*` keys are enumerated from storage by prefix.
 */
export function guestDataKeys(): string[] {
  return [LOCAL_BIKE_KEY, ...GUEST_BIKE_REFS.map(checkupKey), ...GUEST_BIKE_REFS.map(buildListKey)];
}

/** Is `key` one of the per-measurement keys? */
export function isMeasureKey(key: string): boolean {
  return /^va:measure:[a-z0-9-]{1,64}$/.test(key);
}
