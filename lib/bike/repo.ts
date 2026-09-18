/**
 * Where a bike edit goes (§6.4) — one interface over three destinations, so no
 * component ever branches on `ref.kind`.
 *
 *   demo    nowhere. The demo bike is read-only; the panel offers
 *           "Modifier ce vélo → copie locale" instead of a form, and the copy
 *           is a `writeLocalBike` away ({@link forkDemoToLocal}).
 *   local   `localStorage`, through `lib/bike/local-bike.ts`.
 *   db      a server action, injected rather than imported: this module stays
 *           React-free and plain, and the unit tests pass fakes instead of
 *           standing a server up.
 *
 * Every method returns an `ActionResult`, including the local one, because a
 * browser's storage fails in exactly the ways a server does — full, disabled,
 * refusing to write — and a component that has to tell the visitor "not saved"
 * should not care which of the two happened.
 *
 * The domain does the actual editing (`setAttribute` from
 * `engine/validate-build.ts`); a repo only decides where the result is written.
 */
import { useSyncExternalStore } from "react";

import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { setAttribute } from "@/lib/domain/engine/validate-build";
import type { AttributeValue, BikeBuild } from "@/lib/domain/schema/part";

import {
  parseLocalBike,
  readLocalBike,
  writeLocalBike,
  type KeyValueStorage,
  type LocalBike,
} from "./local-bike";
import { LOCAL_BIKE_KEY } from "./storage-keys";
import type { BikeRefKind } from "./resolve-bike-ref";
import { coerceFit, mergeFit, type BikeFit } from "./rules";

export interface AttributeEdit {
  partId: string;
  key: string;
  /** `null` clears the attribute back to its default. */
  value: AttributeValue | null;
}

export interface BikeRepo {
  readonly kind: BikeRefKind;
  /** `false` for the demo bike: the UI shows the fork CTA instead of a form. */
  readonly canEdit: boolean;
  /** Apply one attribute edit and persist the whole build. */
  setAttribute(build: BikeBuild, edit: AttributeEdit): Promise<ActionResult<BikeBuild>>;
  /** Merge `patch` into the stored fit. */
  setFit(patch: BikeFit): Promise<ActionResult<BikeFit>>;
}

/** Map a domain edit refusal onto the action vocabulary. */
function applyEdit(build: BikeBuild, edit: AttributeEdit): ActionResult<BikeBuild> {
  const change = setAttribute(build, edit.partId, edit.key, edit.value);
  if (change.ok) return ok(change.build);
  return change.code === "unknown-part" || change.code === "part-not-fitted"
    ? fail("NOT_FOUND")
    : fail("VALIDATION", { fieldErrors: { [edit.key]: `bike.errors.${change.code}` } });
}

// ── demo ─────────────────────────────────────────────────────────────────────

/** The demo bike: every write is refused, in the same shape a real one answers. */
export function demoBikeRepo(): BikeRepo {
  const refuse = async (): Promise<ActionResult<never>> => fail("FORBIDDEN");
  return {
    kind: "demo",
    canEdit: false,
    setAttribute: refuse,
    setFit: refuse,
  };
}

/**
 * "Modifier ce vélo → copie locale": the demo bike's answers become the
 * visitor's own guest bike, which they can then edit. Returns the new local
 * bike, or `null` when storage is unavailable.
 */
export function forkDemoToLocal(
  demo: Pick<LocalBike, "answers">,
  storage?: KeyValueStorage | null,
): LocalBike | null {
  return writeLocalBike({ answers: demo.answers }, storage === undefined ? {} : { storage });
}

// ── local ────────────────────────────────────────────────────────────────────

export interface LocalRepoOptions {
  storage?: KeyValueStorage | null;
}

/**
 * The guest bike. Reads the current payload before every write, so two tabs
 * editing the same bike cannot overwrite each other with a stale snapshot held
 * in a closure.
 */
export function localBikeRepo(options: LocalRepoOptions = {}): BikeRepo {
  const read = (): LocalBike | null =>
    options.storage === undefined ? readLocalBike() : readLocalBike(options.storage);
  const write = (input: Parameters<typeof writeLocalBike>[0]): LocalBike | null =>
    options.storage === undefined
      ? writeLocalBike(input)
      : writeLocalBike(input, { storage: options.storage });

  return {
    kind: "local",
    canEdit: true,

    async setAttribute(build, edit) {
      const stored = read();
      if (stored === null) return fail("NOT_FOUND");
      const applied = applyEdit({ spec: stored.spec, parts: stored.parts }, edit);
      if (!applied.ok) return applied;
      const saved = write({
        id: stored.id,
        answers: stored.answers,
        parts: applied.data.parts,
        fit: stored.fit,
      });
      if (saved === null)
        return fail("CONFLICT", { fieldErrors: { form: "bike.errors.storageFull" } });
      return ok({ spec: saved.spec, parts: saved.parts });
    },

    async setFit(patch) {
      const stored = read();
      if (stored === null) return fail("NOT_FOUND");
      const fit = mergeFit(coerceFit(stored.fit), patch);
      const saved = write({
        id: stored.id,
        answers: stored.answers,
        parts: stored.parts,
        fit,
      });
      if (saved === null)
        return fail("CONFLICT", { fieldErrors: { form: "bike.errors.storageFull" } });
      return ok(coerceFit(saved.fit));
    },
  };
}

// ── db ───────────────────────────────────────────────────────────────────────

/**
 * The server actions a saved bike is written through. Injected so this module
 * never imports `app/**` (which would drag `server-only` into the client
 * bundle) and so the tests can record the calls.
 */
export interface RemoteBikeActions {
  /**
   * `attributes` is a map, not a `(key, value)` pair, because that is the shape
   * `updateBikePartAction` accepts (§4.4) and its input schema is `.strict()`:
   * a payload with an extra `key` field is a REJECTED submission, not an
   * ignored one. One entry is what a single edit sends.
   */
  updatePart(input: {
    bikeId: string;
    partId: string;
    attributes: Record<string, AttributeValue | null>;
  }): Promise<ActionResult<BikeBuild>>;
  updateFit(input: { bikeId: string; fit: BikeFit }): Promise<ActionResult<BikeFit>>;
}

export function remoteBikeRepo(bikeId: string, actions: RemoteBikeActions): BikeRepo {
  return {
    kind: "db",
    canEdit: true,
    setAttribute: (_build, edit) =>
      actions.updatePart({ bikeId, partId: edit.partId, attributes: { [edit.key]: edit.value } }),
    setFit: (patch) => actions.updateFit({ bikeId, fit: patch }),
  };
}

/** The repo for a ref, given what only the caller knows (the bike id, the actions). */
export function bikeRepoFor(
  kind: BikeRefKind,
  options: {
    bikeId?: string | null;
    actions?: RemoteBikeActions;
    storage?: KeyValueStorage | null;
  },
): BikeRepo {
  if (kind === "demo") return demoBikeRepo();
  if (kind === "local") {
    return localBikeRepo(options.storage === undefined ? {} : { storage: options.storage });
  }
  if (!options.bikeId || !options.actions) {
    throw new Error("bikeRepoFor('db') needs a bikeId and the server actions");
  }
  return remoteBikeRepo(options.bikeId, options.actions);
}

// ── Reading the guest bike from React ────────────────────────────────────────

/**
 * The stored guest bike as a React value, or `LOCAL_BIKE_PENDING` until the
 * browser has been asked.
 *
 * `useSyncExternalStore`, not `useEffect` + `setState`, for the reason
 * `lib/hooks/use-media.ts` gives and one more: the server has no
 * `localStorage`, so a state initialiser would make the first client render
 * disagree with the HTML. The server snapshot is a **sentinel**, which is what
 * lets a caller tell "not read yet" (render the skeleton) from "read, and there
 * is nothing" (send the visitor home, §6.7) — two states a plain `null` cannot
 * distinguish, and the difference between a loading box and a wrong redirect.
 *
 * The parsed bike is memoised on the raw string so repeated `getSnapshot` calls
 * return the same object; without that, `useSyncExternalStore` would see a new
 * value every render and loop forever.
 *
 * Other tabs are followed through the `storage` event, which is the only
 * notification a browser gives for `localStorage`. A write in THIS tab does not
 * fire it — components that write call `readLocalBike()` themselves, and the
 * repo re-reads before every write anyway.
 */
export const LOCAL_BIKE_PENDING = Symbol("local-bike-pending");

export type LocalBikeSnapshot = LocalBike | null | typeof LOCAL_BIKE_PENDING;

let cachedRaw: string | null | undefined;
let cachedBike: LocalBike | null = null;

function localBikeSnapshot(): LocalBike | null {
  let raw: string | null = null;
  try {
    raw = typeof window === "undefined" ? null : window.localStorage.getItem(LOCAL_BIKE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedBike = parseLocalBike(raw);
  }
  return cachedBike;
}

function subscribeToLocalBike(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

const pendingSnapshot = (): LocalBikeSnapshot => LOCAL_BIKE_PENDING;

export function useLocalBikeSnapshot(): LocalBikeSnapshot {
  return useSyncExternalStore(subscribeToLocalBike, localBikeSnapshot, pendingSnapshot);
}

/** Forget the memoised parse — for tests, which swap the storage under the hook. */
export function resetLocalBikeSnapshotCache(): void {
  cachedRaw = undefined;
  cachedBike = null;
}
