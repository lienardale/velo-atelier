import { useTranslations } from "next-intl";

import { ILLUSTRATIONS, type IllustrationAspect, type IllustrationId } from "@/lib/domain";

/**
 * What every illustration accepts, placeholder or finished drawing.
 *
 * The alt text is never a prop: it lives in `messages/<locale>/illustrations.json`
 * under `illustrations.<id>.alt` and is read by the component itself, so a
 * drawing can never be rendered without its accessible name (§6.8 AC3 asserts
 * exactly that on the decision-tree help panels).
 */
export interface IllustrationProps {
  className?: string;
  /**
   * Hide the drawing from assistive technology — only when the surrounding text
   * already says everything the picture says.
   */
  decorative?: boolean;
}

/** The drawing area for each aspect, in user units (width, height). */
const VIEW_BOXES: Record<IllustrationAspect, readonly [number, number]> = {
  "4/3": [120, 90],
  "1/1": [120, 120],
  "16/9": [160, 90],
};

/**
 * The stand-in every illustration starts life as: a labelled, theme-aware box
 * carrying the real alt text and the real aspect ratio, so layout, contrast and
 * accessibility are already correct before anyone draws anything (W2-T4c
 * replaces them one by one and flips `status` to `"final"` in the manifest).
 */
export function IllustrationPlaceholder({
  id,
  className,
  decorative = false,
}: IllustrationProps & { id: IllustrationId }) {
  const t = useTranslations("illustrations");
  /* eslint-disable security/detect-object-injection -- both are total lookups keyed by a literal union */
  const { aspect } = ILLUSTRATIONS[id];
  const [width, height] = VIEW_BOXES[aspect];
  /* eslint-enable security/detect-object-injection */
  const label = t(`${id}.alt`);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      data-illustration={id}
      data-status="placeholder"
      {...(decorative ? { "aria-hidden": true } : { role: "img" })}
    >
      {decorative ? null : <title>{label}</title>}
      <rect
        x={2}
        y={2}
        width={width - 4}
        height={height - 4}
        rx="6"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="2"
        strokeDasharray="6 4"
      />
      <text
        x={width / 2}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fillOpacity="0.55"
        fontSize="7"
        fontFamily="monospace"
      >
        {id}
      </text>
    </svg>
  );
}
