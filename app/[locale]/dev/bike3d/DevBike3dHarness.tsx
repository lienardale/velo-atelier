/**
 * Client harness of the dev pages: preset / mode / quality switches, a minimal
 * parts list (the real a11y mirror is W2-T3's `PartsList`) and a side panel —
 * everything the bike3d e2e and perf specs drive. Test-only UI, served only
 * when `ENABLE_TEST_PAGES=1`.
 *
 * Presets switch in place (no navigation), so the perf spec can toggle the
 * spec 20 times against ONE canvas and one WebGL context.
 */
"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { BikeViewer, BikeViewerProvider } from "@/components/bike3d/BikeViewer";
import { useViewerStore, useViewerStoreApi } from "@/components/bike3d/store";
import { Button } from "@/components/ui/button";
import type { QualityTier, ViewerMode } from "@/lib/bike3d/types";
import {
  answerWithDefaults,
  BIKE_PRESETS,
  buildBikeSpec,
  PRESET_IDS,
  type PresetId,
} from "@/lib/domain";
import { isPartId, type PartId } from "@/lib/domain/data/parts";
import { buildForSpec } from "@/lib/domain/engine/parts-for-spec";
import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";

export interface DevBike3dHarnessProps {
  locale: Locale;
  variant: "viewer" | "perf";
  initialPreset: PresetId;
  initialPartId: PartId | null;
  initialPickedIds: PartId[];
  initialMode: ViewerMode;
  initialQuality: QualityTier | null;
}

function DevPartsList({ partIds }: { partIds: readonly PartId[] }): React.JSX.Element {
  const t = useTranslations("bike3d.dev");
  const tParts = useTranslations("parts");
  const { api } = useViewerStoreApi();
  const selected = useViewerStore((state) => state.selectedPartId);
  const picked = useViewerStore((state) => state.pickedPartIds);
  const mode = useViewerStore((state) => state.mode);

  return (
    <section aria-labelledby="dev-parts-heading" className="mt-4">
      <h2 id="dev-parts-heading" className="font-display text-lg font-semibold">
        {t("partsHeading")}
      </h2>
      <ul
        className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="dev-parts-list"
      >
        {partIds.map((id) => (
          <li key={id} className="flex items-center gap-2">
            {mode === "pick" ? (
              <input
                type="checkbox"
                className="size-5"
                checked={picked.has(id)}
                onChange={() => api.getState().togglePick(id)}
                aria-label={tParts(`${id}.label` as never)}
                data-testid={`dev-pick-${id}`}
              />
            ) : null}
            <button
              type="button"
              data-part-row={id}
              aria-current={selected === id ? "true" : undefined}
              className="hover:bg-paper-2 aria-[current=true]:bg-paper-2 min-h-[var(--tap-min)] flex-1 rounded-md px-2 text-left text-sm aria-[current=true]:font-semibold"
              onClick={() => api.getState().select(id, { focus: true, source: "list" })}
            >
              {tParts(`${id}.label` as never)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DevPanel({ partId }: { partId: PartId | null }): React.JSX.Element {
  const t = useTranslations("bike3d.dev");
  const tParts = useTranslations("parts");
  const picked = useViewerStore((state) => state.pickedPartIds);
  const mode = useViewerStore((state) => state.mode);

  return (
    <div className="border-rule rounded-lg border p-4" data-testid="part-panel">
      {partId ? (
        <>
          <h2 className="font-display text-lg font-semibold" data-testid="part-panel-title">
            {tParts(`${partId}.label` as never)}
          </h2>
          <p className="text-ink-muted mt-1 text-sm">{tParts(`${partId}.description` as never)}</p>
          <Link
            href={{
              pathname: "/velo/[id]/controle",
              params: { id: "demo" },
              query: { parts: partId },
            }}
            prefetch={false}
            className="text-accent mt-3 inline-flex min-h-[var(--tap-min)] items-center underline"
            data-testid="part-panel-checkup"
          >
            {t("checkupPart")}
          </Link>
        </>
      ) : (
        <p className="text-ink-muted text-sm" data-testid="part-panel-empty">
          {t("panelEmpty")}
        </p>
      )}
      {mode === "pick" ? (
        <div className="mt-3 flex flex-col gap-1">
          <p className="text-sm" data-testid="picked-count">
            {t("picked", { count: picked.size })}
          </p>
          {picked.size > 0 ? (
            <Link
              href={{
                pathname: "/velo/[id]/controle",
                params: { id: "demo" },
                query: { parts: [...picked].join(",") },
              }}
              prefetch={false}
              className="text-accent inline-flex min-h-[var(--tap-min)] items-center underline"
              data-testid="picked-checkup"
            >
              {t("checkupPicked", { count: picked.size })}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DevBike3dHarness({
  locale,
  variant,
  initialPreset,
  initialPartId,
  initialPickedIds,
  initialMode,
  initialQuality,
}: DevBike3dHarnessProps): React.JSX.Element {
  const t = useTranslations("bike3d.dev");
  const [preset, setPreset] = useState<PresetId>(initialPreset);
  const [mode, setMode] = useState<ViewerMode>(initialMode);
  const build = useMemo(
    () => buildForSpec(buildBikeSpec(answerWithDefaults(BIKE_PRESETS[preset]))),
    [preset],
  );
  const partIds = useMemo(() => build.parts.map((part) => part.partId).filter(isPartId), [build]);

  return (
    <BikeViewerProvider
      build={build}
      initialPartId={initialPartId}
      initialPickedIds={initialPickedIds}
      mode={mode}
      initialQuality={initialQuality}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("preset")}>
        {PRESET_IDS.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={id === preset ? "default" : "outline"}
            aria-pressed={id === preset}
            data-testid={`preset-${id}`}
            onClick={() => setPreset(id)}
          >
            <code>{id}</code>
          </Button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("mode")}>
        <Button
          type="button"
          size="sm"
          variant={mode === "browse" ? "default" : "outline"}
          aria-pressed={mode === "browse"}
          data-testid="mode-browse"
          onClick={() => setMode("browse")}
        >
          {t("modeBrowse")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "pick" ? "default" : "outline"}
          aria-pressed={mode === "pick"}
          data-testid="mode-pick"
          onClick={() => setMode("pick")}
        >
          {t("modePick")}
        </Button>
      </div>
      <BikeViewer
        spec={build.spec}
        build={build}
        locale={locale}
        mode={mode}
        initialQuality={initialQuality}
        probe
        renderPanel={variant === "viewer" ? (id) => <DevPanel partId={id} /> : undefined}
      />
      {variant === "viewer" ? <DevPartsList partIds={partIds} /> : null}
    </BikeViewerProvider>
  );
}
