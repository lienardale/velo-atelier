import { Bike } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * The box where the 3D bike will be, before there is a bike to draw (§6.4).
 *
 * One job above all: **hold the space**. The viewer's box is
 * `aspect-ratio: 1; max-height: 60svh; min-height: 260px` on mobile and `16/10`
 * from `lg` up, and both exports below reserve exactly that — so when the real
 * viewer replaces one of them, nothing underneath moves (CLS ≤ 0.1, §6.8 AC9).
 *
 * ## Two exports, and why the silent one exists
 *
 * `BikeCanvasSkeleton` has no text, and therefore no `useTranslations`. That is
 * not a style choice: `loading.tsx` receives no `params`, so it cannot call
 * `setRequestLocale`, and a next-intl read without it makes the whole segment
 * **dynamic** — which cost `/[locale]/velo/demo` its prerender until it was
 * found (§6.8 AC2, `.debug/005`). A route-level loading file must stay silent.
 *
 * `BikeCanvasFallback` is the speaking one, for the states a *page* renders:
 *
 *   loading  the moment before a `local` bike has been read out of
 *            `localStorage`. An `aria-busy` status region, not a decorative
 *            shimmer: a screen reader hears "chargement".
 *   empty    the visitor asked for `/velo/local` and there is no guest bike.
 *            The workspace sends them home; this is what they see for the
 *            instant before the navigation lands — with the CTA, so a blocked
 *            redirect still leaves a way forward (§6.7).
 *
 * Shared (no `"use client"`): rendered on the server by the page and, after
 * hydration, by the client workspace.
 */
const BOX_CLASSES =
  "bg-paper-2 border-rule aspect-square max-h-[60svh] min-h-[260px] w-full rounded-lg border lg:aspect-[16/10] lg:max-h-none";

/** The wordless placeholder — the only thing `loading.tsx` may render. */
export function BikeCanvasSkeleton({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      data-testid="bike-canvas-skeleton"
      className={cn(BOX_CLASSES, className)}
    />
  );
}

export interface BikeCanvasFallbackProps {
  state: "loading" | "empty";
  /** Rendered under the message — the "Décrire mon vélo" link of the empty state. */
  action?: React.ReactNode;
  className?: string;
}

export function BikeCanvasFallback({
  state,
  action,
  className,
}: BikeCanvasFallbackProps): React.JSX.Element {
  const t = useTranslations("bike");
  const loading = state === "loading";

  return (
    <div
      data-testid="bike-canvas-fallback"
      data-state={state}
      role="status"
      aria-busy={loading}
      aria-live="polite"
      className={cn(
        BOX_CLASSES,
        "flex flex-col items-center justify-center gap-3 p-6 text-center",
        className,
      )}
    >
      <Bike
        aria-hidden="true"
        className={cn("text-ink-muted size-10", loading && "motion-safe:animate-pulse")}
      />
      <p className="text-ink font-medium">{t(loading ? "canvas.loading" : "canvas.empty")}</p>
      {loading ? null : <p className="text-ink-muted text-sm">{t("canvas.emptyHelp")}</p>}
      {action}
    </div>
  );
}
