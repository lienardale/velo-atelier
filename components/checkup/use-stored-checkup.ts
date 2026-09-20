"use client";

import { useCallback, useSyncExternalStore } from "react";

import { checkupKey, type GuestBikeRef } from "@/lib/bike/storage-keys";
import { readStoredCheckup, type StoredCheckup } from "@/lib/checkup/storage";

/**
 * `va:checkup:<ref>` as a React value.
 *
 * `useSyncExternalStore`, not `useEffect` + `setState`, for the reason
 * `lib/bike/repo.ts` gives: the server has no `localStorage`, so reading it in
 * a state initialiser would make the first client render disagree with the
 * HTML. The server snapshot is a **sentinel**, so a caller can tell "not read
 * yet" from "read, and there is nothing" — the difference between a resume
 * banner that has not appeared yet and one that never will.
 *
 * The parse is memoised on the raw string: `getSnapshot` must return the same
 * object between renders or `useSyncExternalStore` loops forever.
 */
export const STORED_CHECKUP_PENDING = Symbol("stored-checkup-pending");

export type StoredCheckupSnapshot = StoredCheckup | null | typeof STORED_CHECKUP_PENDING;

const cache = new Map<GuestBikeRef, { raw: string | null; parsed: StoredCheckup | null }>();

function rawFor(ref: GuestBikeRef): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(checkupKey(ref));
  } catch {
    return null;
  }
}

function snapshotFor(ref: GuestBikeRef): StoredCheckup | null {
  const raw = rawFor(ref);
  const cached = cache.get(ref);
  if (cached !== undefined && cached.raw === raw) return cached.parsed;
  const parsed = raw === null ? null : readStoredCheckup(ref);
  cache.set(ref, { raw, parsed });
  return parsed;
}

function subscribe(onChange: () => void): () => void {
  // The only notification a browser gives for `localStorage`, and it fires in
  // OTHER tabs only — this tab's own writes go through the component that made
  // them.
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

const pending = (): StoredCheckupSnapshot => STORED_CHECKUP_PENDING;

/** The stored checkup of a guest bike; always `null` for a saved one. */
export function useStoredCheckup(ref: GuestBikeRef | null): StoredCheckupSnapshot {
  const getSnapshot = useCallback(() => (ref === null ? null : snapshotFor(ref)), [ref]);
  return useSyncExternalStore(subscribe, getSnapshot, ref === null ? () => null : pending);
}

/** Forget the memoised parse — for tests, which swap the storage under the hook. */
export function resetStoredCheckupCache(): void {
  cache.clear();
}
