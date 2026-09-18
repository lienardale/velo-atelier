"use client";

import { useTranslations } from "next-intl";
import { createElement, useEffect, useId, type ReactNode } from "react";

import type { DrawingNode } from "@/components/illustrations/tree-drawing-node";
import { treeFrameAttrs } from "@/components/illustrations/tree-frame-attrs";
import type { IllustrationId } from "@/lib/domain";

import { loadTreeDrawings, useTreeDrawing } from "./tree-drawings";

export interface TreeDrawingProps {
  id: IllustrationId;
  className: string;
  /** Hide from assistive technology — an option thumbnail, which its label names. */
  decorative: boolean;
}

/**
 * One node of a drawing as a React element.
 *
 * Hyphenated SVG attributes (`stroke-width`, `text-anchor`, `data-callout`)
 * are passed through: React renders an unknown, hyphenated prop verbatim, which
 * is exactly what the generated tree holds. `style` is already an object —
 * `renderTreeGeometry()` parsed and checked it at build time.
 */
function element(node: DrawingNode, key: number): ReactNode {
  if (typeof node === "string") return node;
  return createElement(
    node.t,
    { key, ...node.a },
    node.c?.map((child, index) => element(child, index)),
  );
}

/**
 * One decision-tree drawing: the frame and the accessible name here, the shapes
 * from `/tree-drawings.json`.
 *
 * **Why the split (`.debug/005`).** The tree moves between questions on the
 * client, so every drawing it can show has to be on the client before the
 * visitor asks for it — but serialising all 54 into the home page's RSC payload
 * put 139 kB of shapes in a 322 kB document for the sake of the one drawing the
 * first screen shows, and that document is what the browser has to get through
 * before the page settles. The shapes now travel once, as a cacheable file
 * fetched after hydration, and only the drawings actually rendered are ever
 * built into DOM.
 *
 * **It is still not a client illustration.** Nothing here imports
 * `components/illustrations/index.ts`: the 72-component barrel is rendered by
 * server code (`tree-geometry.tsx`) and this component only replays what it
 * produced — as ordinary React elements over the closed vocabulary in
 * `tree-drawing-node.ts`, never by injecting HTML into the DOM.
 * `treeFrameAttrs` is the frame `TreeIllustrationFrame` draws, shared so the
 * two cannot drift, and the `<title>` is read from `illustrations.<id>.alt` in
 * the visitor's locale — so a drawing still cannot render without its
 * accessible name, geometry or no geometry.
 *
 * Before the fetch lands the `<svg>` is empty, and empty is the right thing to
 * show: the `viewBox` gives the box its size whatever is inside it, so the
 * layout is final from the first paint and nothing jumps when the shapes
 * arrive (CLS ≤ 0.1, §6.8 AC9).
 */
export function TreeDrawing({ id, className, decorative }: TreeDrawingProps): React.JSX.Element {
  const t = useTranslations("illustrations");
  const titleId = useId();
  const shapes = useTreeDrawing(id);

  useEffect(loadTreeDrawings, []);

  return (
    <svg
      {...treeFrameAttrs(id)}
      className={className}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-labelledby": titleId })}
    >
      {decorative ? null : <title id={titleId}>{t(`${id}.alt`)}</title>}
      {shapes.map((node, index) => element(node, index))}
    </svg>
  );
}
