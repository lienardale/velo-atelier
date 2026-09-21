import { ILLUSTRATIONS, type IllustrationId } from "@/lib/domain";

/**
 * The `<svg>` attributes of a decision-tree drawing, minus its accessible name.
 *
 * Two renderers need exactly these, which is why they live here rather than
 * inline in the frame:
 *
 *   - `TreeIllustrationFrame` (server), which draws the whole thing — guides,
 *     tests, and any drawing still on its placeholder;
 *   - `TreeDrawing` (client), which draws the same frame around geometry
 *     fetched from `public/tree-drawings.json` instead of around the drawing's own
 *     elements, so the home page's RSC payload carries no shapes at all
 *     (`.debug/007`).
 *
 * The two must agree exactly — `tree-geometry.test.tsx` renders
 * `TreeIllustrationFrame` and compares its `<svg>` against this object, so a
 * change to one that is not made to the other fails the suite.
 *
 * No React here on purpose: `TreeDrawing` is a `"use client"` module and must
 * never reach `components/illustrations/index.ts`, the 72-component barrel.
 */
export function treeFrameAttrs(id: IllustrationId): {
  viewBox: string;
  preserveAspectRatio: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: "round";
  strokeLinejoin: "round";
  "data-illustration": IllustrationId;
  "data-status": string;
} {
  // eslint-disable-next-line security/detect-object-injection -- total lookup keyed by a literal union
  const thumbnail = ILLUSTRATIONS[id].aspect === "1/1";
  return {
    viewBox: thumbnail ? "0 0 120 120" : "0 0 320 240",
    preserveAspectRatio: "xMidYMid meet",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: thumbnail ? 3 : 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "data-illustration": id,
    "data-status": "final",
  };
}
