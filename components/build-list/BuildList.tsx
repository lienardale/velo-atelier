"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import * as z from "zod/mini";

import {
  clearDoneBuildListItemsAction,
  setBuildListItemDoneAction,
  setBuildListItemRefinementAction,
} from "@/app/[locale]/velo/[id]/liste/actions";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui-ext/Callout";
import { translateMessageKey } from "@/lib/actions/result";
import { buildListKey, type GuestBikeRef } from "@/lib/bike/storage-keys";
import type { BikeRef } from "@/lib/bike/resolve-bike-ref";
import type { BuildAction, BuildListItem } from "@/lib/checkup/types";
import { isPartId } from "@/lib/domain/data/parts";
import type { BikeBuild } from "@/lib/domain/schema/part";
import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";
import { cn } from "@/lib/utils";

import { BuildItemCard } from "./BuildItemCard";
import { CopyButton } from "./CopyButton";
import { PrintButton } from "./PrintButton";

/**
 * "Ma liste" — everything this bike needs, grouped by what has to be done to it
 * (§6.5, §6.8 AC7).
 *
 * The list is DERIVED from a checkup (`deriveBuildList`, W3-T1) and then
 * OWNED by the visitor: they refine a part, tick a line off, clear what is
 * done. This component is that second half — it renders persisted items and
 * writes the visitor's edits back — and it never derives anything itself.
 *
 * ## Two places a list can live, one component
 *
 * A guest's list is in `localStorage` under `va:buildlist:demo` /
 * `va:buildlist:local` (§1.2), which the server cannot read; a saved bike's is
 * in `BuildList` + `BuildListItem` rows, which arrive as `initialItems`. The
 * difference is confined to {@link BuildListProps.onChange} and to where the
 * first render gets its items — everything below this component is identical.
 *
 * ## Storage is untrusted input
 *
 * What comes back from `localStorage` is parsed with `zod/mini` (classic zod is
 * banned in bundled code) and **dropped** on a parse failure rather than
 * half-used, exactly like `lib/bike/local-bike.ts`. Two envelopes are accepted:
 * the `{ version, items, updatedAt }` this release writes, and a bare
 * `BuildListItem[]`, so a list written by a different part of the app (or by an
 * earlier build) still opens.
 */

/** The envelope version this release writes. */
export const BUILD_LIST_VERSION = 1;

export interface StoredBuildList {
  version: typeof BUILD_LIST_VERSION;
  items: BuildListItem[];
  /** ISO 8601. */
  updatedAt: string;
}

const BUILD_ACTIONS = ["replace", "fix", "clean", "adjust", "inspect-shop"] as const;

/** Display order of the sections: what stops you riding first. */
export const BUILD_ACTION_ORDER: readonly BuildAction[] = BUILD_ACTIONS;

const Id = z.string().check(z.maxLength(200));

const StoredItemSchema = z.object({
  id: Id,
  stepKey: Id,
  sourceKeys: z.array(Id),
  partId: z.string().check(z.maxLength(64)),
  action: z.enum(BUILD_ACTIONS),
  reasonKey: z.string().check(z.maxLength(80)),
  guideSlug: z.optional(z.string().check(z.maxLength(160))),
  done: z.boolean(),
  doneReason: z.optional(z.enum(["manual", "recheck-ok"])),
  refinement: z.optional(
    z.record(z.string().check(z.maxLength(64)), z.string().check(z.maxLength(64))),
  ),
  chosenProduct: z.optional(
    z.object({
      brand: z.string().check(z.maxLength(80)),
      model: z.string().check(z.maxLength(80)),
      size: z.string().check(z.maxLength(40)),
      vendor: z.string().check(z.maxLength(40)),
      url: z.string().check(z.maxLength(2048)),
    }),
  ),
  sortOrder: z.number().check(z.refine(Number.isFinite)),
});

const StoredBuildListSchema = z.union([
  z.object({
    version: z.literal(BUILD_LIST_VERSION),
    items: z.array(StoredItemSchema),
    updatedAt: z.string().check(z.maxLength(40)),
  }),
  z.array(StoredItemSchema),
]);

/** At most this many lines are kept — a list is a shopping trip, not a log. */
export const MAX_BUILD_LIST_ITEMS = 80;

/** The items a raw storage value holds, or `null` when it holds none we can use. */
export function parseBuildList(raw: string | null): BuildListItem[] | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = StoredBuildListSchema.safeParse(json);
  if (!parsed.success) return null;
  const items = Array.isArray(parsed.data) ? parsed.data : parsed.data.items;
  return items
    .filter((item) => isPartId(item.partId))
    .slice(0, MAX_BUILD_LIST_ITEMS) as BuildListItem[];
}

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Safari private mode, blocked site data: behave as if nothing is stored.
    return null;
  }
}

/** The guest list under `va:buildlist:<ref>`; an unreadable value is removed. */
export function readBuildList(
  ref: GuestBikeRef,
  storage: KeyValueStorage | null = defaultStorage(),
): BuildListItem[] | null {
  if (storage === null) return null;
  const key = buildListKey(ref);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const items = parseBuildList(raw);
  if (items === null) {
    try {
      storage.removeItem(key);
    } catch {
      /* nothing to do: the value is already unusable */
    }
  }
  return items;
}

/** Write the guest list back. Returns `false` when storage refused. */
export function writeBuildList(
  ref: GuestBikeRef,
  items: readonly BuildListItem[],
  storage: KeyValueStorage | null = defaultStorage(),
): boolean {
  if (storage === null) return false;
  const payload: StoredBuildList = {
    version: BUILD_LIST_VERSION,
    items: items.slice(0, MAX_BUILD_LIST_ITEMS),
    updatedAt: new Date().toISOString(),
  };
  try {
    storage.setItem(buildListKey(ref), JSON.stringify(payload));
    notifyBuildListChanged();
    return true;
  } catch {
    return false;
  }
}

// ── Reading the guest list from React ────────────────────────────────────────
//
// Same shape as `useLocalBikeSnapshot` (`lib/bike/repo.ts`): the server has no
// `localStorage`, so the server snapshot is a SENTINEL rather than `null` —
// "not read yet" (show the skeleton) and "read, and there is nothing" (show the
// empty state and the CTA) are different screens.

export const BUILD_LIST_PENDING = Symbol("build-list-pending");

export type BuildListSnapshot = BuildListItem[] | null | typeof BUILD_LIST_PENDING;

const listeners = new Set<() => void>();

/** A write in THIS tab fires no `storage` event; components say so themselves. */
function notifyBuildListChanged(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

let cache: { raw: string | null; items: BuildListItem[] | null } | null = null;

/** Memoised on the raw string: `useSyncExternalStore` must see a stable value. */
function snapshotFor(ref: GuestBikeRef): BuildListSnapshot {
  const storage = defaultStorage();
  let raw: string | null = null;
  try {
    raw = storage === null ? null : storage.getItem(buildListKey(ref));
  } catch {
    raw = null;
  }
  if (cache === null || cache.raw !== raw) cache = { raw, items: parseBuildList(raw) };
  return cache.items;
}

/** Test seam: drop the memo so a suite can rewrite storage between cases. */
export function resetBuildListSnapshotCache(): void {
  cache = null;
}

const pendingSnapshot = (): BuildListSnapshot => BUILD_LIST_PENDING;

export function useBuildListSnapshot(ref: GuestBikeRef): BuildListSnapshot {
  return useSyncExternalStore(subscribe, () => snapshotFor(ref), pendingSnapshot);
}

// ── The list ─────────────────────────────────────────────────────────────────

export interface BuildListProps {
  /** Which bike's list this is — decides where a change is written. */
  bikeRef: BikeRef;
  /** The `[id]` segment, for the links back to the bike. */
  bikeParam: string;
  /** The bike itself, for the refinement questions. `null` when unknown. */
  build: BikeBuild | null;
  locale: Locale;
  /**
   * Items the server already knows (a saved bike). `null` means "this list
   * lives in the browser": read `va:buildlist:<ref>` instead.
   */
  initialItems: readonly BuildListItem[] | null;
  /** The `BuildList` row, for "Retirer ce qui est fait". `null` for a guest list. */
  buildListId: string | null;
  className?: string;
}

export function BuildList({
  bikeRef,
  bikeParam,
  build,
  locale,
  initialItems,
  buildListId,
  className,
}: BuildListProps): React.JSX.Element {
  const t = useTranslations("shop");
  const tRoot = useTranslations();
  const guestRef: GuestBikeRef | null = bikeRef.kind === "db" ? null : bikeRef.kind;

  const stored = useBuildListSnapshot(guestRef ?? "demo");
  const [serverItems, setServerItems] = useState<readonly BuildListItem[]>(initialItems ?? []);
  const [hideDone, setHideDone] = useState(false);
  const [failed, setFailed] = useState(false);

  const pending = guestRef !== null && stored === BUILD_LIST_PENDING;
  const items = useMemo<readonly BuildListItem[]>(() => {
    if (guestRef === null) return serverItems;
    return stored === BUILD_LIST_PENDING || stored === null ? [] : stored;
  }, [guestRef, serverItems, stored]);

  /**
   * Server writes run one after another, never at the same time.
   *
   * "Retirer ce qui est fait" deletes by LIST — it asks the server which lines
   * are done rather than trusting the ids a stale tab is holding — so it has to
   * run AFTER the tick that made one of them done. Without this queue, ticking
   * a line and clearing straight away raced: the delete reached the database
   * before the update did, found nothing done, and removed nothing, while the
   * screen had already dropped the line. A build list is exactly the page where
   * someone does both in one gesture.
   */
  const pendingWrites = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((write: () => Promise<boolean>): Promise<void> => {
    const next = pendingWrites.current.then(async () => {
      if (!(await write())) setFailed(true);
    });
    pendingWrites.current = next.catch(() => undefined);
    return next;
  }, []);

  /**
   * One changed item, persisted where this list lives.
   *
   * The optimistic update comes first and the write follows, because the
   * visitor is standing in a shop ticking things off: a checkbox that waits for
   * a round trip reads as broken. A refusal is surfaced by the banner rather
   * than by silently reverting — the value they chose stays on screen, and they
   * are told it did not reach the server.
   */
  const save = useCallback(
    async (next: BuildListItem) => {
      setFailed(false);
      const previous = items.find((item) => item.id === next.id);
      if (guestRef !== null) {
        const merged = items.map((item) => (item.id === next.id ? next : item));
        if (!writeBuildList(guestRef, merged)) setFailed(true);
        return;
      }
      setServerItems((current) => current.map((item) => (item.id === next.id ? next : item)));

      await enqueue(async () => {
        const writes: Promise<{ ok: boolean }>[] = [];
        if (previous === undefined || previous.done !== next.done) {
          writes.push(setBuildListItemDoneAction({ itemId: next.id, done: next.done }));
        }
        if (previous === undefined || previous.refinement !== next.refinement) {
          writes.push(
            setBuildListItemRefinementAction({
              itemId: next.id,
              refinement: next.refinement ?? {},
            }),
          );
        }
        const results = await Promise.all(writes);
        return results.every((result) => result.ok);
      });
    },
    [enqueue, guestRef, items],
  );

  const clearDone = useCallback(async () => {
    setFailed(false);
    if (!items.some((item) => item.done)) return;
    const kept = items.filter((item) => !item.done);
    if (guestRef !== null) {
      if (!writeBuildList(guestRef, kept)) setFailed(true);
      return;
    }
    setServerItems(kept);
    if (buildListId === null) return;
    await enqueue(async () => (await clearDoneBuildListItemsAction({ buildListId })).ok);
  }, [enqueue, guestRef, items, buildListId]);

  const doneCount = items.filter((item) => item.done).length;
  const visible = hideDone ? items.filter((item) => !item.done) : items;

  if (pending) {
    return (
      <p className="text-ink-muted" data-testid="build-list-pending">
        {t("list.loading")}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <section
        className={cn("flex flex-col items-start gap-4", className)}
        data-testid="build-list-empty"
      >
        <h2 className="font-display text-ink text-xl font-semibold">{t("list.empty.title")}</h2>
        <p className="text-ink-muted">{t("list.empty.body")}</p>
        <Button asChild className="min-h-[var(--tap-min)]">
          <Link
            href={{ pathname: "/velo/[id]/controle", params: { id: bikeParam } }}
            data-testid="build-list-start-checkup"
          >
            {t("list.empty.cta")}
          </Link>
        </Button>
      </section>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} data-testid="build-list">
      <div className="flex flex-wrap items-center gap-3" data-print="hide">
        <p className="text-ink-muted text-sm" data-testid="build-list-state">
          {t("list.done.state", { done: doneCount, total: items.length })}
        </p>
        <label className="tap-target text-ink flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={hideDone}
            onChange={(event) => setHideDone(event.currentTarget.checked)}
            data-testid="build-list-hide-done"
          />
          {t("list.done.hide")}
        </label>
        <Button
          type="button"
          variant="outline"
          className="min-h-[var(--tap-min)]"
          disabled={doneCount === 0}
          onClick={() => void clearDone()}
          data-testid="build-list-clear-done"
        >
          {t("list.done.clear")}
        </Button>
        <PrintButton label={t("list.print")} />
        <CopyButton
          items={items}
          locale={locale}
          label={t("list.copy")}
          doneLabel={t("list.copied")}
          failedLabel={t("list.copyFailed")}
          reasonText={(key) => translateMessageKey(tRoot, `guides.reasons.${key}`)}
        />
      </div>

      {failed ? (
        <Callout tone="danger" role="alert" data-testid="build-list-save-failed">
          <p>{t("list.saveFailed")}</p>
        </Callout>
      ) : null}

      {BUILD_ACTION_ORDER.map((action) => {
        const section = visible
          .filter((item) => item.action === action)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        if (section.length === 0) return null;
        return (
          <section key={action} aria-labelledby={`build-list-${action}`} data-section={action}>
            <h2
              id={`build-list-${action}`}
              className="font-display text-ink mb-3 text-lg font-semibold"
            >
              {t(`list.sections.${action}`)}{" "}
              <span className="text-ink-muted text-sm font-normal">
                ({t("list.count", { count: section.length })})
              </span>
            </h2>
            <ul className="flex flex-col gap-4">
              {section.map((item) => (
                <li key={item.id}>
                  <BuildItemCard
                    item={item}
                    build={build}
                    locale={locale}
                    bikeParam={bikeParam}
                    onChange={(next) => void save(next)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
