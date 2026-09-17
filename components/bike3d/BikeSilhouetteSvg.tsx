/**
 * `BikeSilhouetteSvg` — the bike as an interactive side view (§3.3).
 *
 * It is the server-rendered first paint (and LCP element) of every bike page,
 * the no-WebGL fallback and the context-lost fallback. Hook-free, so it renders
 * on the server; the silhouette data comes from `lib/bike3d/silhouette.ts`,
 * projected from the same recipes as the 3D meshes.
 *
 * One `<g data-part-id role="button" tabIndex={0}>` per rendered part with a
 * translated `<title>`. While the canvas is ready the SVG stays mounted but
 * `aria-hidden`, invisible and out of the tab order (`inert`), so nothing
 * shifts when the 3D fades in or out.
 */
import type { KeyboardEvent } from "react";

import { highlightTarget, meshStatus, isPickedMesh } from "@/lib/bike3d/highlight";
import type { Silhouette, SilhouetteShape } from "@/lib/bike3d/silhouette";
import type { PartStatus } from "@/lib/bike3d/types";
import type { PartId } from "@/lib/domain/data/parts";
import { cn } from "@/lib/utils";

export interface BikeSilhouetteSvgProps {
  silhouette: Silhouette;
  labels: Readonly<Record<string, string>>;
  title: string;
  selectedPartId?: PartId | null;
  pickedPartIds?: ReadonlySet<PartId>;
  status?: Partial<Record<PartId, PartStatus>>;
  /** Visually hidden and removed from the accessibility tree (3D canvas ready). */
  concealed?: boolean;
  onActivate?(id: PartId): void;
  className?: string;
}

function Shape({ shape }: { shape: SilhouetteShape }): React.JSX.Element {
  switch (shape.type) {
    case "line":
      return (
        <line
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          strokeWidth={shape.width}
          strokeLinecap="round"
        />
      );
    case "circle":
      return (
        <circle
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          strokeWidth={shape.filled ? 0 : shape.width}
          fill={shape.filled ? "currentColor" : "none"}
        />
      );
    case "polyline":
      return shape.closed ? (
        <polygon
          points={shape.points}
          strokeWidth={shape.width}
          fill="none"
          strokeLinejoin="round"
        />
      ) : (
        <polyline
          points={shape.points}
          strokeWidth={shape.width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "polygon":
      return (
        <polygon points={shape.points} fill="currentColor" strokeWidth={4} strokeLinejoin="round" />
      );
  }
}

export function BikeSilhouetteSvg({
  silhouette,
  labels,
  title,
  selectedPartId = null,
  pickedPartIds,
  status,
  concealed = false,
  onActivate,
  className,
}: BikeSilhouetteSvgProps): React.JSX.Element {
  const selected = highlightTarget(selectedPartId);
  const onKeyDown = (id: PartId) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onActivate?.(id);
  };

  return (
    <svg
      viewBox={silhouette.viewBox}
      role="group"
      aria-label={title}
      aria-hidden={concealed || undefined}
      data-testid="bike3d-svg"
      data-concealed={concealed ? "true" : "false"}
      className={cn(
        "h-full w-full touch-manipulation transition-opacity duration-300 motion-reduce:transition-none",
        concealed ? "pointer-events-none opacity-0" : "opacity-100",
        className,
      )}
      {...(concealed ? { inert: true } : {})}
    >
      <title>{title}</title>
      {silhouette.parts.map(({ partId, shapes }) => {
        const tone = meshStatus(partId, status);
        const isSelected = selected === partId;
        const isPicked = pickedPartIds ? isPickedMesh(partId, pickedPartIds) : false;
        return (
          <g
            key={partId}
            data-part-id={partId}
            role="button"
            tabIndex={concealed ? -1 : 0}
            aria-label={labels[partId] ?? partId}
            aria-pressed={isSelected}
            onClick={() => onActivate?.(partId)}
            onKeyDown={onKeyDown(partId)}
            stroke="currentColor"
            className={cn(
              "cursor-pointer outline-none focus-visible:text-accent",
              isSelected
                ? "text-accent"
                : tone === "ko"
                  ? "text-danger"
                  : tone === "ok"
                    ? "text-success"
                    : isPicked
                      ? "text-warn"
                      : "text-ink-muted hover:text-ink",
            )}
          >
            <title>{labels[partId] ?? partId}</title>
            {shapes.map((shape, index) => (
              <Shape key={index} shape={shape} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
