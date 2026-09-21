"use client";

/**
 * `/acheter?part=&bike=&item=` — the answers a build-list line already holds,
 * so the buying guide opens pre-filled (§5.5) instead of empty.
 *
 * Two bikes, two readers, and neither pulls the build list into `/acheter`:
 *
 *   demo / local  the guest list in `localStorage`, read through
 *                 `readGuestBuildList` (`lib/checkup/storage.ts`, zod/mini and
 *                 no React) — never through `components/build-list/BuildList`,
 *                 which would bring the whole list page into this route;
 *   db            `loadBuildListItemAction`, owner-scoped on the server
 *                 (another person's line, or another bike's, is NOT_FOUND and
 *                 simply prefills nothing). The PAGE hands it down as a prop
 *                 (`readItem`): a server action passed from a server component
 *                 is a reference, so this module never imports the
 *                 `"use server"` file — whose own imports (`server-only`,
 *                 Auth.js) have no business in a client module graph.
 *
 * Every input is untrusted: the item id is only ever compared, never parsed
 * into anything, and a line whose part is not the `?part=` of the page
 * prefills nothing — a cassette's answers do not belong in a chain's form.
 * Which of the returned answers are valid for this part's questions is the
 * caller's to decide (`PartQuestions` drops the rest).
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import type { ActionResult } from "@/lib/actions/result";
import type { BikeRef } from "@/lib/bike/resolve-bike-ref";
import { buildListKey, type GuestBikeRef } from "@/lib/bike/storage-keys";
import { readGuestBuildList } from "@/lib/checkup/storage";

export type ItemRefinement = Readonly<Record<string, string>>;

/** `loadBuildListItemAction`'s shape — what the page hands down. */
export type ReadBuildListItem = (input: {
  bikeId: string;
  itemId: string;
}) => Promise<ActionResult<{ partId: string; refinement: Record<string, string> }>>;

/** Item ids are `stepKey|partId|action` for a guest and a UUID for an account. */
const MAX_ITEM_ID = 200;

// ── guest ────────────────────────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

let memo: { key: string; raw: string | null; value: ItemRefinement | null } | null = null;

function rawList(ref: GuestBikeRef): string | null {
  try {
    return window.localStorage.getItem(buildListKey(ref));
  } catch {
    return null;
  }
}

/**
 * `readGuestBuildList` checks the ENVELOPE, not the items (the list page
 * re-validates those), so a line's refinement is still storage here: only
 * short string answers under short keys survive.
 */
function asRefinement(value: unknown): ItemRefinement | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(
    ([key, entry]) => typeof entry === "string" && key.length <= 64 && entry.length <= 64,
  );
  return entries.length === 0 ? null : (Object.fromEntries(entries) as ItemRefinement);
}

/** Memoised on the raw string: `useSyncExternalStore` must see a stable value. */
function guestSnapshot(ref: GuestBikeRef, partId: string, itemId: string): ItemRefinement | null {
  const key = `${ref}\0${partId}\0${itemId}`;
  const raw = rawList(ref);
  if (memo !== null && memo.key === key && memo.raw === raw) return memo.value;
  const item = (readGuestBuildList(ref)?.items as readonly unknown[] | undefined)?.find(
    (candidate): candidate is { refinement?: unknown } =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { id?: unknown }).id === itemId &&
      (candidate as { partId?: unknown }).partId === partId,
  );
  memo = { key, raw, value: asRefinement(item?.refinement) };
  return memo.value;
}

/** Test seam: forget the memo between cases that rewrite storage. */
export function resetItemPrefillCache(): void {
  memo = null;
}

const noSnapshot = (): null => null;

// ── the hook ─────────────────────────────────────────────────────────────────

/**
 * The refinement of line `itemId` of `bikeRef`'s list, when it is about
 * `partId`; `null` until known, and whenever there is nothing to prefill.
 */
export function useItemRefinement(
  partId: string | null,
  bikeRef: BikeRef | null,
  itemId: string | null,
  /** The owner-scoped read for a saved bike; without it a saved bike prefills nothing. */
  readItem: ReadBuildListItem | undefined,
): ItemRefinement | null {
  const usable = partId !== null && itemId !== null && itemId.length <= MAX_ITEM_ID;
  const guest = usable && bikeRef !== null && bikeRef.kind !== "db" ? bikeRef.kind : null;
  const bikeId = usable && readItem !== undefined && bikeRef?.kind === "db" ? bikeRef.id : null;

  const fromGuest = useSyncExternalStore(
    subscribe,
    () => (guest === null ? null : guestSnapshot(guest, partId as string, itemId as string)),
    noSnapshot,
  );

  const [fromServer, setFromServer] = useState<{ key: string; value: ItemRefinement } | null>(null);
  const serverKey = bikeId === null ? null : `${bikeId}\0${partId}\0${itemId}`;
  useEffect(() => {
    if (bikeId === null || serverKey === null || readItem === undefined) return;
    let cancelled = false;
    void readItem({ bikeId, itemId: itemId as string })
      .then((result) => {
        if (cancelled || !result.ok || result.data.partId !== partId) return;
        setFromServer({ key: serverKey, value: result.data.refinement });
      })
      // Signed out, a network error, a foreign id: the guide simply opens empty.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bikeId, itemId, partId, serverKey, readItem]);

  if (guest !== null) return fromGuest;
  return fromServer !== null && fromServer.key === serverKey ? fromServer.value : null;
}
