import { useTranslations } from "next-intl";
import { useId } from "react";

import type { GuideIllustrationId } from "@/lib/content/illustrations";

import type { IllustrationProps } from "./placeholder";

/**
 * The frame every guide illustration is drawn in (§5.3): a 320 × 240 box,
 * `currentColor` strokes of 2 px, `role="img"` named by a `<title id>` read from
 * `illustrations.<id>.alt` — the drawing can never render without its
 * accessible name.
 *
 * Callouts are drawn by each illustration file itself, as literal
 * `<circle data-callout="n">` + `<text aria-hidden="true">n</text>` pairs, and
 * never carry words: what callout `n` points at is
 * `illustrations.<id>.callouts.<n>`, shown as a legend by `<Illustration>`.
 * The content check counts the `data-callout` markers in the file and fails
 * when they disagree with the message keys, so keep them literal.
 *
 * While `status` is `"placeholder"` in `lib/content/illustrations.ts` the frame
 * also prints the id in a dashed box, so an unfinished drawing is obvious on
 * the page and in review. W2-T4a/b replace the placeholder shapes.
 */
export function GuideIllustrationFrame({
  id,
  className,
  decorative = false,
  placeholder = true,
  children,
}: IllustrationProps & {
  id: GuideIllustrationId;
  placeholder?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const t = useTranslations("illustrations");
  const titleId = useId();

  return (
    <svg
      viewBox="0 0 320 240"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-illustration={id}
      data-status={placeholder ? "placeholder" : "final"}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-labelledby": titleId })}
    >
      {decorative ? null : <title id={titleId}>{t(`${id}.alt`)}</title>}
      {placeholder ? (
        <>
          <rect
            x={4}
            y={4}
            width={312}
            height={232}
            rx={10}
            strokeOpacity={0.35}
            strokeDasharray="8 6"
          />
          <text
            x={160}
            y={226}
            textAnchor="middle"
            fill="currentColor"
            stroke="none"
            fillOpacity={0.55}
            fontSize={11}
            fontFamily="monospace"
            aria-hidden="true"
          >
            {id}
          </text>
        </>
      ) : null}
      {children}
    </svg>
  );
}

/** Shared attributes of a callout digit (the circle carries `data-callout`). */
export const calloutText = {
  textAnchor: "middle",
  dominantBaseline: "central",
  fill: "currentColor",
  stroke: "none",
  fontSize: 12,
  fontWeight: 600,
  "aria-hidden": true,
} as const;
