/**
 * `BikeViewer` — the client shell of the 3D bike (§3.3).
 *
 *   first paint     BikeSilhouetteSvg (server-rendered, interactive, the LCP element)
 *   capabilities    useSyncExternalStore (server snapshot: unknown → SVG)
 *   3D              next/dynamic(BikeScene, ssr: false), mounted only once
 *                   hydrated + WebGL 2 + visible (IntersectionObserver) + idle
 *                   (requestIdleCallback, 200 ms fallback)
 *   fallbacks       no WebGL → SVG + `bike3d.noWebgl`; context lost → SVG +
 *                   "reload 3D" (twice at most); scene error → SVG + `bike3d.error`
 *   url             `?part=` / `?parts=` via history.replaceState (url-sync.ts)
 *
 * Three.js never reaches this module's import graph: `lib/bike3d/scene.ts`
 * and `silhouette.ts` are pure, and everything that imports `three` sits
 * behind the dynamic import. The test hooks are compiled in only when
 * `NEXT_PUBLIC_TEST_HOOKS=1` at build time.
 */
"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { initialQuality as chooseQuality, readPersistedQuality } from "@/lib/bike3d/quality";
import { planScene } from "@/lib/bike3d/scene";
import { silhouetteFor } from "@/lib/bike3d/silhouette";
import { isPartId, type PartId } from "@/lib/domain/data/parts";
import { cn } from "@/lib/utils";

import { BikeSilhouetteSvg } from "./BikeSilhouetteSvg";
import { createCapsSource } from "./caps";
import { SceneErrorBoundary } from "./SceneErrorBoundary";
import {
  MAX_CONTEXT_LOSSES,
  useCreateViewerStore,
  useMaybeViewerStoreApi,
  useViewerStore,
  useViewerStoreApi,
  ViewerStoreProvider,
} from "./store";
import type { BikeViewerProps } from "./types";
import { bindUrlSync } from "./url-sync";

export type { BikeViewerProps } from "./types";

const BikeScene = dynamic(() => import("./BikeScene"), { ssr: false, loading: () => null });

// Build-time gate: without NEXT_PUBLIC_TEST_HOOKS=1 this is `null` and the
// probe chunk is never referenced.
const PerfProbe =
  process.env.NEXT_PUBLIC_TEST_HOOKS === "1"
    ? dynamic(() => import("./perf/PerfProbe"), { ssr: false, loading: () => null })
    : null;

/** Fallback delay when `requestIdleCallback` is unavailable (Safari). */
export const IDLE_FALLBACK_MS = 200;

function partIdsOf(build: BikeViewerProps["build"]): PartId[] {
  return build.parts.map((part) => part.partId).filter(isPartId);
}

export interface BikeViewerProviderProps {
  build: BikeViewerProps["build"];
  initialPartId?: BikeViewerProps["initialPartId"];
  initialPickedIds?: BikeViewerProps["initialPickedIds"];
  mode?: BikeViewerProps["mode"];
  status?: BikeViewerProps["status"];
  initialQuality?: BikeViewerProps["initialQuality"];
  children: ReactNode;
}

/**
 * Shares ONE viewer store between a `BikeViewer` and the host's own UI (the
 * parts list of `BikeWorkspace`), so selection is bidirectional: the host reads
 * and writes it with `useViewerStore` / `useViewerStoreApi`. Without a provider,
 * `BikeViewer` creates its own store.
 */
export function BikeViewerProvider({
  children,
  ...props
}: BikeViewerProviderProps): React.JSX.Element {
  const store = useCreateViewerStore(() => ({
    selectedPartId: props.initialPartId ?? null,
    pickedPartIds: props.initialPickedIds ?? [],
    mode: props.mode ?? "browse",
    status: props.status,
    quality: props.initialQuality ?? undefined,
    availablePartIds: partIdsOf(props.build),
  }));
  return <ViewerStoreProvider store={store}>{children}</ViewerStoreProvider>;
}

export function BikeViewer(props: BikeViewerProps): React.JSX.Element {
  const existing = useMaybeViewerStoreApi();
  if (existing) return <ViewerShell {...props} />;
  return (
    <BikeViewerProvider {...props}>
      <ViewerShell {...props} />
    </BikeViewerProvider>
  );
}

function useVisibleThenIdle(ref: React.RefObject<HTMLElement | null>): boolean {
  // Without IntersectionObserver (old engines) the viewer counts as visible.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, visible]);

  useEffect(() => {
    if (!visible || idle) return;
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => setIdle(true), { timeout: 1000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(() => setIdle(true), IDLE_FALLBACK_MS);
    return () => window.clearTimeout(handle);
  }, [visible, idle]);

  return visible && idle;
}

function ViewerShell({
  build,
  mode,
  onSelect,
  onPickedChange,
  status,
  renderPanel,
  probe = false,
  fit = null,
  initialQuality = null,
  className,
}: BikeViewerProps): React.JSX.Element {
  const t = useTranslations("bike3d");
  const tParts = useTranslations("parts");
  const { api } = useViewerStoreApi();
  const boxRef = useRef<HTMLDivElement>(null);

  const [capsSource] = useState(createCapsSource);
  const caps = useSyncExternalStore(
    capsSource.subscribe,
    capsSource.getSnapshot,
    capsSource.getServerSnapshot,
  );

  const plan = useMemo(() => planScene(build, fit), [build, fit]);
  const silhouette = useMemo(() => silhouetteFor(plan), [plan]);
  const partIds = useMemo(() => partIdsOf(build), [build]);
  const labels = useMemo(
    () =>
      Object.fromEntries(partIds.map((id) => [id, tParts(`${id}.label` as never)])) as Record<
        string,
        string
      >,
    [partIds, tParts],
  );

  const selectedPartId = useViewerStore((state) => state.selectedPartId);
  const pickedPartIds = useViewerStore((state) => state.pickedPartIds);
  const ready = useViewerStore((state) => state.ready);
  const quality = useViewerStore((state) => state.quality);
  const contextLost = useViewerStore((state) => state.contextLost);
  const contextLossCount = useViewerStore((state) => state.contextLossCount);
  const sceneError = useViewerStore((state) => state.sceneError);
  const rotateMode = useViewerStore((state) => state.rotateMode);
  const currentMode = useViewerStore((state) => state.mode);

  // Props → store.
  useEffect(() => api.getState().setAvailable(partIds), [api, partIds]);
  useEffect(() => api.getState().setStatus(status), [api, status]);
  useEffect(() => {
    if (mode) api.getState().setMode(mode);
  }, [api, mode]);

  // Capabilities → starting tier (once) and hover policy.
  const tierChosen = useRef(false);
  useEffect(() => {
    if (!caps) return;
    api.getState().setHoverEnabled(!caps.coarsePointer);
    if (tierChosen.current) return;
    tierChosen.current = true;
    let persisted: unknown = null;
    try {
      persisted = readPersistedQuality(window.localStorage);
    } catch {
      persisted = null;
    }
    api.getState().setQuality(initialQuality ?? chooseQuality(caps, persisted));
  }, [api, caps, initialQuality]);

  // Store → host callbacks.
  const callbacks = useRef({ onSelect, onPickedChange });
  useEffect(() => {
    callbacks.current = { onSelect, onPickedChange };
  });
  useEffect(
    () =>
      api.subscribe((state, previous) => {
        if (state.selectedPartId !== previous.selectedPartId) {
          callbacks.current.onSelect?.(state.selectedPartId, state.lastSource ?? "canvas");
        }
        if (state.pickedPartIds !== previous.pickedPartIds) {
          callbacks.current.onPickedChange?.(state.pickedPartIds);
        }
      }),
    [api],
  );

  useEffect(() => bindUrlSync(api), [api]);

  const visibleAndIdle = useVisibleThenIdle(boxRef);
  const webgl = caps?.webgl2 === true;
  const mount3d = webgl && visibleAndIdle && !contextLost && !sceneError;
  const canvasReady = mount3d && ready;

  let notice = "";
  // The loading notice is ANNOUNCED, never painted. It appears seconds after
  // the first paint — when the 3D chunk starts mounting — so a visible line
  // becomes the page's LCP element whenever its text outgrows the `<h1>`, and
  // the LCP moves to whenever the 3D happened to start. "Loading the 3D view…"
  // and "Demo bike" measure 2489 and 2589 px² on macOS — 4 % apart — and on
  // CI (perf.yml run 35600024232, five runs each) /en/bike/demo's LCP was
  // 4520 ms against 2302 ms for /fr/velo/demo, the same page with a
  // 5675 px² `<h1>`. A bike named "VTT" would do the same in any locale. While
  // it loads, the silhouette above is the whole, working viewer; the fallback
  // notices stay visible because they explain a state that lasts.
  let transient = false;
  if (caps && !webgl) notice = t("noWebgl");
  else if (contextLost)
    notice = contextLossCount >= MAX_CONTEXT_LOSSES ? t("contextLostFinal") : t("contextLost");
  else if (sceneError) notice = t("error");
  else if (mount3d && !ready) {
    notice = t("loading");
    transient = true;
  }

  const state3d = !caps
    ? "pending"
    : !webgl
      ? "no-webgl"
      : contextLost
        ? "context-lost"
        : sceneError
          ? "error"
          : canvasReady
            ? "ready"
            : "loading";

  return (
    <div
      data-testid="bike3d-viewer"
      data-state={state3d}
      data-ready={canvasReady ? "true" : "false"}
      data-quality={quality}
      data-mode={currentMode}
      data-selected={selectedPartId ?? ""}
      className={cn("grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]", className)}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div
          ref={boxRef}
          className="bg-paper-2 border-rule relative aspect-square max-h-[60svh] min-h-[260px] w-full overflow-hidden rounded-lg border lg:aspect-[16/10] lg:max-h-none"
        >
          <div className="absolute inset-0 p-2">
            <BikeSilhouetteSvg
              silhouette={silhouette}
              labels={labels}
              title={t("svgTitle")}
              selectedPartId={selectedPartId}
              pickedPartIds={pickedPartIds}
              status={status}
              concealed={canvasReady}
              onActivate={(id) => api.getState().activate(id, "svg")}
            />
          </div>
          {mount3d ? (
            <div
              className={cn(
                "absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none",
                canvasReady ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              role="img"
              aria-label={t("canvasLabel")}
            >
              <SceneErrorBoundary onError={() => api.getState().setSceneError(true)}>
                <BikeScene
                  plan={plan}
                  labels={labels}
                  coarsePointer={caps?.coarsePointer ?? false}
                  reducedMotion={caps?.reducedMotion ?? false}
                  initialTier={quality}
                  devicePixelRatio={caps?.devicePixelRatio ?? 1}
                />
              </SceneErrorBoundary>
            </div>
          ) : null}
        </div>

        <div className="flex min-h-[var(--tap-min)] flex-wrap items-center gap-2">
          {canvasReady ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[var(--tap-min)]"
              data-testid="bike3d-reset"
              onClick={() => api.getState().requestReset()}
            >
              {t("reset")}
            </Button>
          ) : null}
          {canvasReady && caps?.coarsePointer ? (
            <Button
              type="button"
              variant={rotateMode ? "default" : "outline"}
              size="sm"
              className="min-h-[var(--tap-min)]"
              aria-pressed={rotateMode}
              data-testid="bike3d-rotate"
              onClick={() => api.getState().setRotateMode(!rotateMode)}
            >
              {t("rotate")}
            </Button>
          ) : null}
          {contextLost && contextLossCount < MAX_CONTEXT_LOSSES ? (
            <Button
              type="button"
              size="sm"
              className="min-h-[var(--tap-min)]"
              data-testid="bike3d-reload"
              onClick={() => api.getState().retry3d()}
            >
              {t("reload3d")}
            </Button>
          ) : null}
          <p
            role="status"
            aria-live="polite"
            className={cn("text-ink-muted text-sm", transient && "sr-only")}
            data-testid="bike3d-notice"
          >
            {notice}
          </p>
        </div>
      </div>

      {renderPanel ? <aside className="min-w-0">{renderPanel(selectedPartId)}</aside> : null}
      {probe && PerfProbe ? <PerfProbe plan={plan} /> : null}
    </div>
  );
}
