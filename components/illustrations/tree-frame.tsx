import { useTranslations } from "next-intl";
import { useId } from "react";

import type { IllustrationId } from "@/lib/domain";

import type { IllustrationProps } from "./placeholder";
import { treeFrameAttrs } from "./tree-frame-attrs";

/**
 * The frame every decision-tree drawing is drawn in (W2-T4c) — the tree's
 * counterpart of `GuideIllustrationFrame`.
 *
 * - Help drawings (`ill-<question>`, aspect 4/3) use a 320 × 240 box with 2-unit
 *   strokes, like the guide drawings, and carry numbered callouts whose legend
 *   is `illustrations.<id>.callouts.<n>`.
 * - Option thumbnails (`ill-<question>-<option>`, aspect 1/1) use a 120 × 120 box
 *   with 3-unit strokes, so the line weight survives being shown at card size.
 *   They carry no callouts: the option label under the card names them.
 *
 * Line-icon style (`docs/illustrations.md`): strokes in `currentColor`, no
 * fills except the page ground (`--color-paper`, used to mask lines behind a
 * part or a callout) and the accent token that marks the distinguishing
 * feature (`ACCENT`). Both are CSS custom properties, so the drawing follows
 * the dark palette with no `dark:` variant. No words inside the SVG — only
 * callout digits and the numbers a bike part really carries (ETRTO sizes,
 * sprocket counts), all `aria-hidden`.
 *
 * `role="img"` is named by a `<title id>` read from `illustrations.<id>.alt`, so
 * a drawing can never render without its accessible name.
 */
export function TreeIllustrationFrame({
  id,
  className,
  decorative = false,
  children,
}: IllustrationProps & {
  id: IllustrationId;
  children: React.ReactNode;
}): React.JSX.Element {
  const t = useTranslations("illustrations");
  const titleId = useId();

  return (
    <svg
      {...treeFrameAttrs(id)}
      className={className}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-labelledby": titleId })}
    >
      {decorative ? null : <title id={titleId}>{t(`${id}.alt`)}</title>}
      {children}
    </svg>
  );
}

/** The distinguishing feature: accent-coloured stroke (theme token). */
export const ACCENT = { style: { stroke: "var(--color-accent)" } } as const;

/** A shape that hides the lines behind it (filled with the page ground). */
export const MASK = { style: { fill: "var(--color-paper)" } } as const;

/** An accent shape that also masks what is behind it. */
export const ACCENT_MASK = {
  style: { stroke: "var(--color-accent)", fill: "var(--color-paper)" },
} as const;

/** A secondary line (leader, context part the eye should skip). */
export const FAINT = { strokeOpacity: 0.45 } as const;

/** The circle of a callout: masks what is behind it; carries `data-callout` at the call site. */
export const calloutCircle = { r: 10, strokeWidth: 1.5, ...MASK } as const;

/** Shared attributes of a callout digit (the circle carries `data-callout`). */
export const calloutDigit = {
  textAnchor: "middle",
  dominantBaseline: "central",
  fill: "currentColor",
  stroke: "none",
  fontSize: 11,
  fontWeight: 600,
  "aria-hidden": true,
} as const;

/** A number printed on a part (ETRTO size, sprocket count): never a word. */
export const partNumber = {
  textAnchor: "middle",
  dominantBaseline: "central",
  fill: "currentColor",
  stroke: "none",
  fontFamily: "ui-monospace, monospace",
  "aria-hidden": true,
} as const;
