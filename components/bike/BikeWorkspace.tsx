"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { updateBikePartAction } from "@/app/[locale]/velo/[id]/actions";
import { updateBikeFitAction } from "@/app/[locale]/velo/[id]/reglages/actions";
import { BikeViewer, BikeViewerProvider } from "@/components/bike3d/BikeViewer";
import { useViewerStore } from "@/components/bike3d/store";
import { Button } from "@/components/ui/button";
import { MobileSheet, type SheetSnap } from "@/components/ui-ext/MobileSheet";
import type { PartStatusValue, ResumableCheckup } from "@/lib/bike/load-bike";
import type { LocalBike } from "@/lib/bike/local-bike";
import type { GuideRef } from "@/lib/bike/queries";
import {
  bikeRepoFor,
  forkDemoToLocal,
  LOCAL_BIKE_PENDING,
  useLocalBikeSnapshot,
} from "@/lib/bike/repo";
import type { BikeRefKind } from "@/lib/bike/resolve-bike-ref";
import { encodeSpec } from "@/lib/bike/spec-codec";
import type { PartId } from "@/lib/domain/data/parts";
import type { Answers } from "@/lib/domain/schema/decision";
import type { BikeBuild } from "@/lib/domain/schema/part";
import { useIsDesktop, useIsShortViewport } from "@/lib/hooks/use-media";
import { Link, useRouter } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";
import { cn } from "@/lib/utils";

import { BikeCanvasFallback } from "./BikeCanvasFallback";
import { PartsPanel, type PanelTab } from "./PartsPanel";
import { ResumeBanner } from "./ResumeBanner";

/**
 * The 3D workspace (§6.4) — the page `/velo/demo`, `/velo/local` and
 * `/velo/<uuid>` all end up inside.
 *
 * ## One component, three bikes
 *
 * The three refs differ in exactly two places: where the build comes from
 * (props for `demo` and `db`, `localStorage` for `local`) and where an edit
 * goes (`bikeRepoFor`). Everything else — the viewer, the list, the panel, the
 * sheet, the URL sync — is the same code, which is what makes "all three render
 * inside one `BikeWorkspace`" a fact rather than an aspiration.
 *
 * ## The deep link arrives as a prop
 *
 * `?part=` / `?parts=` are read by the page with `await searchParams` and passed
 * in (§3.3), never with `useSearchParams` here. Two reasons, and the second is
 * the one that bites: a `useSearchParams` consumer needs a `<Suspense>`
 * boundary, and hydrating that boundary briefly keeps the server-rendered
 * workspace in the DOM **next to** the client one — two parts lists, two sheets,
 * two rows per part, for about half a second (`.debug/006`). Selection is set
 * once, when the store is created, so a prop is also simply the right shape.
 *
 * ## Layout
 *
 * ≥ 1024 px: the viewer renders the panel into its own `<aside>` (a
 * `minmax(0,1fr) 22rem` grid). Below that, or on a landscape phone with no
 * vertical room, the panel moves into `<MobileSheet>` — the only scrolling
 * container on the page, so the viewer box stays put while the list scrolls.
 */
export interface BikeWorkspaceProps {
  locale: Locale;
  refKind: BikeRefKind;
  /** `demo`, `local`, or the UUID — the `[id]` segment of every link out of here. */
  bikeParam: string;
  bikeId: string | null;
  /** The owner's name, or `null` to use the localized default. */
  name: string | null;
  /** `null` for a `local` bike: the client reads `va:bike:local` instead. */
  build: BikeBuild | null;
  /** The answers behind that build — what "fork the demo bike" copies. */
  answers: Answers | null;
  statuses?: Partial<Record<string, PartStatusValue>>;
  guides: readonly GuideRef[];
  resume: ResumableCheckup | null;
  /** `describe(spec, locale)`, computed on the server when the build is known. */
  description: string | null;
  /** Selected on load: `?part=`, or the `[partId]` of a `/piece/` deep link. */
  initialPartId?: PartId | null;
  /** Picked on load, from `?parts=` — a partial checkup coming back. */
  initialPickedIds?: PartId[];
}

export function BikeWorkspace(props: BikeWorkspaceProps): React.JSX.Element {
  const local = useLocalBike(props.refKind === "local");
  const build = props.build ?? local.bike?.build ?? null;

  if (props.refKind === "local" && local.state !== "ready") {
    return (
      <BikeCanvasFallback
        state={local.state === "loading" ? "loading" : "empty"}
        action={local.state === "empty" ? <NoLocalBikeCta /> : undefined}
      />
    );
  }

  if (build === null) return <BikeCanvasFallback state="loading" />;

  return (
    // The key remounts the store when the bike itself changes (a local bike
    // regenerated from the tree): initial selection is read once, by design.
    <BikeViewerProvider
      key={`${props.bikeParam}:${local.bike?.id ?? ""}`}
      build={build}
      initialPartId={props.initialPartId ?? null}
      initialPickedIds={props.initialPickedIds ?? []}
    >
      <WorkspaceBody
        {...props}
        build={build}
        answers={props.answers ?? local.bike?.answers ?? null}
        localBike={local.bike}
      />
    </BikeViewerProvider>
  );
}

/** The way out of an empty `/velo/local`, for the instant before the redirect lands. */
function NoLocalBikeCta(): React.JSX.Element {
  const t = useTranslations("bike");
  return (
    <Button asChild className="min-h-[var(--tap-min)]">
      <Link href="/" data-testid="describe-bike-cta">
        {t("canvas.emptyCta")}
      </Link>
    </Button>
  );
}

/** What `/velo/local` reads out of `localStorage`, and whether it is there yet. */
interface LocalBikeState {
  state: "off" | "loading" | "ready" | "empty";
  bike: (LocalBike & { build: BikeBuild }) | null;
}

function useLocalBike(enabled: boolean): LocalBikeState {
  const router = useRouter();
  const t = useTranslations("bike");
  const snapshot = useLocalBikeSnapshot();
  const missing = enabled && snapshot !== LOCAL_BIKE_PENDING && snapshot === null;

  // §6.7: `/velo/local` without storage goes home, with a line saying why —
  // landing on the home page with no explanation reads as the link being
  // broken. `replace`, not `push`, so Back does not bounce the visitor straight
  // into the empty page again.
  useEffect(() => {
    if (!missing) return;
    toast(t("canvas.emptyToast"));
    router.replace({ pathname: "/" });
  }, [missing, router, t]);

  return useMemo(() => {
    if (!enabled) return { state: "off", bike: null };
    if (snapshot === LOCAL_BIKE_PENDING) return { state: "loading", bike: null };
    if (snapshot === null) return { state: "empty", bike: null };
    return {
      state: "ready",
      bike: { ...snapshot, build: { spec: snapshot.spec, parts: snapshot.parts } },
    };
  }, [enabled, snapshot]);
}

function WorkspaceBody({
  locale,
  refKind,
  bikeParam,
  bikeId,
  name,
  build,
  answers,
  statuses,
  guides,
  resume,
  description,
  localBike,
}: BikeWorkspaceProps & {
  build: BikeBuild;
  answers: Answers | null;
  localBike: (LocalBike & { build: BikeBuild }) | null;
}): React.JSX.Element {
  const t = useTranslations("bike");
  const tParts = useTranslations("parts");
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const isShort = useIsShortViewport();
  const docked = isDesktop || isShort;

  const [tab, setTab] = useState<PanelTab>("parts");
  const [snap, setSnap] = useState<SheetSnap>(1);
  const [liveBuild, setLiveBuild] = useState<BikeBuild>(build);
  const [seenBuild, setSeenBuild] = useState<BikeBuild>(build);
  const [srDescription, setSrDescription] = useState(description);

  // The build the server (or the local store) hands down wins whenever it
  // changes; between two of those, a local edit updates the copy this component
  // renders. Adjusted during render rather than in an effect — React's own
  // "resetting state when a prop changes" pattern, and one render instead of two.
  if (seenBuild !== build) {
    setSeenBuild(build);
    setLiveBuild(build);
  }

  const repo = useMemo(
    () =>
      bikeRepoFor(refKind, {
        bikeId,
        actions: {
          updatePart: (input) => updateBikePartAction(input),
          updateFit: (input) => updateBikeFitAction(input),
        },
      }),
    [refKind, bikeId],
  );

  /** `?spec=` for links out of a guest bike to a server-planned route (§5.4). */
  const specCode = useMemo(
    () => (refKind === "local" && localBike ? encodeSpec(localBike.answers) : null),
    [refKind, localBike],
  );

  // The sr-only sentence for a `local` bike can only be built on the client.
  // Loaded lazily so the two decision-tree message files it needs are not in the
  // first-load JS of `/velo/demo`, which does not need them.
  useEffect(() => {
    if (srDescription !== null || localBike === null) return;
    let cancelled = false;
    void import("@/lib/bike/describe").then(({ describe }) => {
      if (!cancelled) setSrDescription(describe(localBike.spec, locale));
    });
    return () => {
      cancelled = true;
    };
  }, [srDescription, localBike, locale]);

  // A tap on a mesh opens the sheet to its half position (§6.4) without
  // changing the tab, so `PartsList` can scroll the selected row into view.
  const lastCanvasSelection = useRef<PartId | null>(null);
  const selectedPartId = useViewerStore((state) => state.selectedPartId);
  const lastSource = useViewerStore((state) => state.lastSource);
  useEffect(() => {
    if (docked || selectedPartId === null) return;
    if (lastSource !== "canvas" && lastSource !== "svg") return;
    if (lastCanvasSelection.current === selectedPartId) return;
    lastCanvasSelection.current = selectedPartId;
    setSnap((current) => (current === 0 ? 1 : current));
  }, [docked, selectedPartId, lastSource]);

  const onFork = useCallback(() => {
    if (answers === null) return;
    const forked = forkDemoToLocal({ answers });
    if (forked) router.push({ pathname: "/velo/[id]", params: { id: "local" } });
  }, [answers, router]);

  const panel = (
    <PartsPanel
      build={liveBuild}
      repo={repo}
      guides={guides}
      statuses={statuses}
      bikeParam={bikeParam}
      specCode={specCode}
      tab={tab}
      onTabChange={setTab}
      onInspect={() => setSnap((current) => (current === 0 ? 1 : current))}
      onSaved={setLiveBuild}
      onFork={onFork}
      className={docked ? "h-full" : undefined}
    />
  );

  const title = name ?? t(refKind === "demo" ? "demoName" : "localName");

  return (
    <div
      data-testid="bike-workspace"
      data-ref={refKind}
      data-docked={docked ? "true" : "false"}
      className={cn(
        "flex w-full flex-col gap-4",
        // Mobile: the page itself never scrolls — the sheet does (§6.4).
        !docked && "h-[calc(100svh-var(--header-h))] overflow-hidden",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-ink truncate text-xl font-semibold">{title}</h1>
        {refKind === "demo" ? (
          <span className="text-ink-muted text-sm" data-testid="demo-badge">
            {t("demoBadge")}
          </span>
        ) : null}
      </div>

      {srDescription ? (
        <p className="sr-only" data-testid="bike-description">
          {srDescription}
        </p>
      ) : null}

      {resume ? (
        <ResumeBanner
          bikeParam={bikeParam}
          startedAt={resume.startedAt}
          scope={resume.scope}
          answered={resume.answered}
          specCode={specCode}
        />
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" data-testid="selection-live">
        {selectedPartId
          ? t("workspace.selected", { part: tParts(`${selectedPartId}.label` as never) })
          : ""}
      </p>

      <BikeViewer
        spec={liveBuild.spec}
        build={liveBuild}
        locale={locale}
        fit={null}
        // The e2e hooks (`window.__va`) belong on the real workspace, not only on
        // the dev pages: §3.6 AC7 states them for `/fr/velo/demo`. A literal, so
        // a build without the variable folds this to `false` and the probe chunk
        // is never referenced (`scripts/bundle-guard.ts` checks the output).
        probe={process.env.NEXT_PUBLIC_TEST_HOOKS === "1"}
        renderPanel={docked ? () => panel : undefined}
        className={cn("min-h-0", !docked && "flex-1")}
      />

      {docked ? null : (
        <MobileSheet
          id="parts-sheet"
          data-testid="parts-sheet"
          title={title}
          expandLabel={t("workspace.expandSheet")}
          collapseLabel={t("workspace.collapseSheet")}
          snap={snap}
          onSnapChange={setSnap}
        >
          {panel}
        </MobileSheet>
      )}
    </div>
  );
}
