"use client";

import { useSyncExternalStore } from "react";

/** What `scripts/gen-tree-drawings.ts` writes, served straight out of `public/`. */
export const TREE_DRAWINGS_URL = "/tree-drawings.json";

/** Illustration id → the markup that goes inside its `<svg>`. */
export type TreeDrawingGeometry = Readonly<Record<string, string>>;

/**
 * The decision tree's drawings, fetched once and shared by every `TreeDrawing`
 * on the page.
 *
 * One request for all 54, made when the first drawing mounts — after
 * hydration, in parallel, off the document. That is the point of the whole
 * arrangement (`.debug/005`): the shapes used to travel inside the home page's
 * RSC payload, 139 kB of them, parsed by the browser before the page could
 * settle, for the one drawing the first screen shows.
 *
 * A module-level store rather than a context: the drawings are a build-time
 * constant, identical for every consumer and every locale, and a context would
 * mean threading a provider through the server/client boundary the tree is
 * carefully built around.
 *
 * Failure is silent by design. A drawing is an aid, never the answer: the help
 * panel's paragraph and the option's label both say what the picture says, so a
 * blocked or failed request costs decoration, not meaning. The empty frame
 * keeps its box, so nothing moves either way.
 */
let geometry: TreeDrawingGeometry = {};
let started = false;
const listeners = new Set<() => void>();

const EMPTY = "";

function emit(): void {
  for (const listener of listeners) listener();
}

/** Kick off the one fetch, if it has not been made yet. */
export function loadTreeDrawings(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void fetch(TREE_DRAWINGS_URL, { credentials: "omit" })
    .then((response) => (response.ok ? (response.json() as Promise<TreeDrawingGeometry>) : null))
    .then((loaded) => {
      if (loaded === null) return;
      geometry = loaded;
      emit();
    })
    .catch(() => {
      // Decoration, not meaning: see the note above.
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The shapes of one drawing: `""` until the fetch lands, then the markup.
 *
 * The server snapshot is always `""` — the prerendered HTML carries an empty,
 * correctly sized frame and the client fills it in, so there is no hydration
 * mismatch and no layout shift (the `viewBox` sizes the box, not its contents).
 */
export function useTreeDrawing(id: string): string {
  return useSyncExternalStore(
    subscribe,
    // eslint-disable-next-line security/detect-object-injection -- a lookup into a plain map by an illustration id
    () => geometry[id] ?? EMPTY,
    () => EMPTY,
  );
}

/**
 * Hand the store its map instead of fetching one.
 *
 * `tests/setup.dom.ts` calls this with `{}` for every jsdom tier, so no
 * component test reaches the network: a drawing's frame, its `<title>` and its
 * legend are what those tests assert, and all three are rendered here — the
 * shapes are the one thing that comes over the wire.
 */
export function primeTreeDrawings(next: TreeDrawingGeometry = {}): void {
  geometry = next;
  started = true;
  emit();
}

/** Forget the map and allow the next mount to fetch again (the store's own test). */
export function resetTreeDrawings(): void {
  geometry = {};
  started = false;
  emit();
}
