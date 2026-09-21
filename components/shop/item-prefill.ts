"use client";

/**
 * `/acheter?part=&bike=&item=` — the answers a build-list line already holds,
 * so the buying guide opens pre-filled (§5.5) instead of empty.
 *
 * Two bikes, two readers, and neither pulls the build list into `/acheter`:
 *
 *   demo / local  the guest list in `localStorage`, read through
 *                 `readGuestBuildList` (`lib/checkup/storage.ts`, the
 *                 `zod/mini`-guarded envelope reader §1.2 asks for) — never
 *                 through `components/build-list/BuildList`, which would
 *                 bring the whole list page into this route;
 *   db            `loadBuildListItemAction`, owner-scoped on the server
 *                 (another person's line, or another bike's, is NOT_FOUND and
 *                 simply prefills nothing). The PAGE hands it down as a prop
 *                 (`readItem`): a server action passed from a server component
 *                 is a reference, so this module never imports the
 *                 `"use server"` file — whose own imports (`server-only`,
 *                 Auth.js) have no business in a client module graph.
 *
 * ## The guest reader is loaded when a guest line is asked for, not before
 *
 * `lib/checkup/storage` brings `zod/mini` and the checkup's own modules with
 * it. Imported statically here it put 25 KB gzip into `/acheter`'s first load
 * (240 187 B against the route's 236 544 B pin, W4-T1 build) — paid by every
 * visit, for a panel only a build-list link opens. It is therefore a dynamic
 * `import()` inside the effect, the way the 3D viewer is kept out of the
 * workspace's first load. Both reads are asynchronous as a result, and the
 * hook says so: `pending` is true from the first render until the lookup for
 * THIS url has answered, and `PartQuestions` exposes it as `aria-busy`.
 *
 * Every input is untrusted: the item id is only ever compared, never parsed
 * into anything, and a line whose part is not the `?part=` of the page
 * prefills nothing — a cassette's answers do not belong in a chain's form.
 * Which of the returned answers are valid for this part's questions is the
 * caller's to decide (`PartQuestions` drops the rest).
 */
import { useEffect, useState } from "react";

import type { ActionResult } from "@/lib/actions/result";
import type { BikeRef } from "@/lib/bike/resolve-bike-ref";
import { buildListKey } from "@/lib/bike/storage-keys";
import type { StoredBuildList } from "@/lib/checkup/storage";

export type ItemRefinement = Readonly<Record<string, string>>;

/** `loadBuildListItemAction`'s shape — what the page hands down. */
export type ReadBuildListItem = (input: {
  bikeId: string;
  itemId: string;
}) => Promise<ActionResult<{ partId: string; refinement: Record<string, string> }>>;

/** What the panel knows about `?item=`: the stored answers, and whether it is still looking. */
export interface ItemPrefill {
  refinement: ItemRefinement | null;
  pending: boolean;
}

/** Item ids are `stepKey|partId|action` for a guest and a UUID for an account. */
const MAX_ITEM_ID = 200;

const NOTHING: ItemPrefill = { refinement: null, pending: false };
const LOOKING: ItemPrefill = { refinement: null, pending: true };

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

/** The refinement of line `itemId` of a guest list, when that line is about `partId`. */
export function lineRefinement(
  list: StoredBuildList | null,
  partId: string,
  itemId: string,
): ItemRefinement | null {
  const item = (list?.items as readonly unknown[] | undefined)?.find(
    (candidate): candidate is { refinement?: unknown } =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { id?: unknown }).id === itemId &&
      (candidate as { partId?: unknown }).partId === partId,
  );
  return asRefinement(item?.refinement);
}

/**
 * The refinement of line `itemId` of `bikeRef`'s list, when it is about
 * `partId`: `pending` until the lookup for these three values has answered,
 * `refinement: null` whenever there is nothing to prefill.
 */
export function useItemRefinement(
  partId: string | null,
  bikeRef: BikeRef | null,
  itemId: string | null,
  /** The owner-scoped read for a saved bike; without it a saved bike prefills nothing. */
  readItem: ReadBuildListItem | undefined,
): ItemPrefill {
  const usable =
    partId !== null && itemId !== null && itemId.length <= MAX_ITEM_ID && bikeRef !== null;
  const guest = usable && bikeRef.kind !== "db" ? bikeRef.kind : null;
  const bikeId = usable && bikeRef.kind === "db" && readItem !== undefined ? bikeRef.id : null;
  // One key per lookup, so an answer that arrives for a previous URL is never
  // shown for this one.
  const lookup =
    guest !== null
      ? `${guest}\0${partId}\0${itemId}`
      : bikeId !== null
        ? `${bikeId}\0${partId}\0${itemId}`
        : null;

  const [found, setFound] = useState<{ lookup: string; value: ItemRefinement | null } | null>(null);

  useEffect(() => {
    if (lookup === null || partId === null || itemId === null) return;
    let cancelled = false;
    const settle = (value: ItemRefinement | null): void => {
      if (!cancelled) setFound({ lookup, value });
    };

    if (guest !== null) {
      const read = (): void => {
        void import("@/lib/checkup/storage")
          .then(({ readGuestBuildList }) =>
            settle(lineRefinement(readGuestBuildList(guest), partId, itemId)),
          )
          // A chunk that failed to load: the guide simply opens empty.
          .catch(() => settle(null));
      };
      read();
      // Another tab that rewrites the list is read again.
      const onStorage = (event: StorageEvent): void => {
        if (event.key === null || event.key === buildListKey(guest)) read();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        cancelled = true;
        window.removeEventListener("storage", onStorage);
      };
    }

    if (bikeId === null || readItem === undefined) return;
    void readItem({ bikeId, itemId })
      .then((result) =>
        settle(result.ok && result.data.partId === partId ? result.data.refinement : null),
      )
      // Signed out, a network error, a foreign id: the guide simply opens empty.
      .catch(() => settle(null));
    return () => {
      cancelled = true;
    };
  }, [lookup, guest, bikeId, partId, itemId, readItem]);

  if (lookup === null) return NOTHING;
  if (found === null || found.lookup !== lookup) return LOOKING;
  return { refinement: found.value, pending: false };
}
