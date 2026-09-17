/**
 * Shared presentation attributes for the guide drawings (§5.3), so the 14
 * pictures read as one set: the part outlines use the frame's 2 px
 * `currentColor` stroke, and these add the three secondary styles.
 *
 *   `tint`    a light fill for a surface worth noticing (a lining, a track)
 *   `leader`  the thin dashed line from a numbered callout to what it names
 *   `fine`    thin detail lines (threads, knurling, grooves)
 *
 * Callouts themselves stay literal in each file (`<circle data-callout="n">`),
 * because the content check counts them in the source.
 */
export const tint = { fill: "currentColor", fillOpacity: 0.14 } as const;

export const solid = { fill: "currentColor", fillOpacity: 0.35 } as const;

export const leader = { strokeWidth: 1.25, strokeOpacity: 0.75, strokeDasharray: "3 3" } as const;

export const fine = { strokeWidth: 1.25 } as const;
