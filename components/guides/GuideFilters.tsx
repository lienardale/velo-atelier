"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useSyncExternalStore } from "react";

import {
  demoSpec,
  FILTER_KINDS,
  filterGuides,
  LOCAL_BIKE_KEY,
  parseGuideFilter,
  serializeGuideFilter,
  specFromStoredBike,
  type GuideFilterState,
} from "@/lib/content/filter";
import type { GuideSummary } from "@/lib/content/types";
import { PART_SYSTEMS } from "@/lib/domain/data/conventions";

import { GuideGrid } from "./GuideCard";

function readLocalBike(): string | null {
  try {
    return window.localStorage.getItem(LOCAL_BIKE_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

const selectClass =
  "tap-target w-full justify-start rounded-md border border-rule bg-paper px-3 text-base text-ink sm:w-auto";

/**
 * The `/guides` filter (§6.2): what to do, which part of the bike, and "Pour
 * mon vélo" (only the guides whose `appliesTo` matches the visitor's guest bike
 * — or the demo bike with `?bike=demo`).
 *
 * The URL is the state (`?kind=&system=&bike=`, unknown values ignored). It is
 * written with `history.replaceState` — the App Router has no shallow routing,
 * and a filter change must not cost a server round trip — and read back through
 * `useSearchParams`, which Next keeps in sync with `replaceState`. The page
 * wraps this component in `<Suspense>` with the unfiltered server-rendered list
 * as fallback, so the route stays static and crawlers see every guide.
 */
export function GuideFilters({ guides }: { guides: readonly GuideSummary[] }): React.JSX.Element {
  const t = useTranslations("guides");
  const tp = useTranslations("parts");
  const searchParams = useSearchParams();
  const state = parseGuideFilter(searchParams);
  const storedBike = useSyncExternalStore(subscribe, readLocalBike, () => null);

  const localSpec = useMemo(() => specFromStoredBike(storedBike), [storedBike]);
  const spec = state.bike === "demo" ? demoSpec() : state.bike === "local" ? localSpec : null;
  const canFilterForBike = localSpec !== null || state.bike === "demo";

  const visible = filterGuides(guides, { kind: state.kind, system: state.system, spec });

  const update = (patch: Partial<GuideFilterState>) => {
    const query = serializeGuideFilter({ ...state, ...patch }, window.location.search);
    // `null`, NOT `window.history.state`: Next's patched `replaceState` skips the
    // router sync (and `useSearchParams` never updates) when the data already
    // carries its internal `__NA` marker; given `null` it copies that marker in
    // itself (next/dist/client/components/app-router.js, 16.3.4).
    window.history.replaceState(null, "", `${window.location.pathname}${query}`);
  };

  const filtered = state.kind !== null || state.system !== null || state.bike !== null;

  return (
    <div className="flex flex-col gap-6">
      <form
        aria-label={t("filters.label")}
        data-testid="guide-filters"
        onSubmit={(event) => event.preventDefault()}
        className="flex flex-col gap-4 rounded-lg border border-rule bg-paper-2/60 p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("filters.kind")}
          <select
            name="kind"
            value={state.kind ?? ""}
            onChange={(event) =>
              update({
                kind: parseGuideFilter(new URLSearchParams({ kind: event.target.value })).kind,
              })
            }
            className={selectClass}
          >
            <option value="">{t("filters.allKinds")}</option>
            {FILTER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("filters.system")}
          <select
            name="system"
            value={state.system ?? ""}
            onChange={(event) =>
              update({
                system: parseGuideFilter(new URLSearchParams({ system: event.target.value }))
                  .system,
              })
            }
            className={selectClass}
          >
            <option value="">{t("filters.allSystems")}</option>
            {PART_SYSTEMS.map((system) => (
              <option key={system} value={system}>
                {tp(`systems.${system}`)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <label className="flex min-h-[var(--tap-min)] items-center gap-3 font-medium">
            <input
              type="checkbox"
              name="bike"
              checked={state.bike !== null && canFilterForBike}
              disabled={!canFilterForBike}
              aria-describedby="for-my-bike-hint"
              onChange={(event) =>
                update({ bike: event.target.checked ? (state.bike ?? "local") : null })
              }
              className="size-5 accent-[var(--color-accent)]"
            />
            {t("filters.forMyBike")}
          </label>
          <p id="for-my-bike-hint" className="max-w-xs text-ink-muted">
            {canFilterForBike ? t("filters.forMyBikeHint") : t("filters.noBike")}
          </p>
        </div>

        {filtered ? (
          <button
            type="button"
            onClick={() => update({ kind: null, system: null, bike: null })}
            className="tap-target rounded-md border border-rule px-4 text-sm font-medium hover:bg-paper"
          >
            {t("list.reset")}
          </button>
        ) : null}
      </form>

      <p aria-live="polite" data-testid="guide-count" className="text-sm text-ink-muted">
        {t("filters.results", { count: visible.length })}
      </p>

      {visible.length === 0 ? (
        <div
          data-testid="guides-empty"
          className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-rule p-6"
        >
          <p className="font-medium">{t("list.empty")}</p>
          <button
            type="button"
            onClick={() => update({ kind: null, system: null, bike: null })}
            className="tap-target rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            {t("list.reset")}
          </button>
        </div>
      ) : (
        <GuideGrid guides={visible} />
      )}
    </div>
  );
}
