"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId } from "react";

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
 * One decision-tree drawing: the frame and the accessible name here, the shapes
 * from `/api/tree-drawings`.
 *
 * **Why the split (`.debug/005`).** The tree moves between questions on the
 * client, so every drawing it can show has to be on the client before the
 * visitor asks for it — but serialising all 54 into the home page's RSC payload
 * put 139 kB of shapes in a 322 kB document for the sake of the one drawing the
 * first screen shows, and that document is what the browser has to get through
 * before the page settles. The shapes now travel once, as a cacheable file
 * fetched after hydration, and only the drawings actually rendered are ever
 * parsed into DOM.
 *
 * **It is still not a client illustration.** Nothing here imports
 * `components/illustrations/index.ts`: the 72-component barrel is rendered by
 * server code (`tree-geometry.ts`) and this component only carries what it
 * produced. `treeFrameAttrs` is the frame `TreeIllustrationFrame` draws, shared
 * so the two cannot drift, and the `<title>` is read from
 * `illustrations.<id>.alt` in the visitor's locale — so a drawing still cannot
 * render without its accessible name, geometry or no geometry.
 *
 * Before the fetch lands the `<svg>` is empty, and empty is the right thing to
 * show: the `viewBox` gives the box its size whatever is inside it, so the
 * layout is final from the first paint and nothing jumps when the shapes
 * arrive (CLS ≤ 0.1, §6.8 AC9).
 */
export function TreeDrawing({ id, className, decorative }: TreeDrawingProps): React.JSX.Element {
  const t = useTranslations("illustrations");
  const titleId = useId();
  const body = useTreeDrawing(id);

  useEffect(loadTreeDrawings, []);

  return (
    <svg
      {...treeFrameAttrs(id)}
      className={className}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-labelledby": titleId })}
    >
      {decorative ? null : <title id={titleId}>{t(`${id}.alt`)}</title>}
      {/*
       * The shapes of a drawing this repository drew, rendered to markup by
       * `components/illustrations/tree-geometry.ts` at build time and served
       * from our own origin. No value here ever comes from a request, a user or
       * a third party; `<g>` gives React a node it owns to write into, and
       * keeps `<title>` a direct child of `<svg>` where the frame's
       * `aria-labelledby` expects it.
       */}
      <g dangerouslySetInnerHTML={{ __html: body }} />
    </svg>
  );
}
