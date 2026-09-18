/**
 * The geometry of the decision tree's drawings, rendered to markup.
 *
 * **Why the shapes are separated from the drawing (`.debug/005`).** The home
 * page shows one question at a time, but the tree navigates on the client, so
 * every drawing it can ever show has to be on the client before the visitor
 * asks for it. Serialising all 54 of them into the page's RSC payload made the
 * home document 322 kB, 301 kB of which was inline `self.__next_f.push(…)`
 * script — 139 kB of shapes for the one drawing the first screen shows, parsed
 * before the page could settle (LCP 3.6 s, TBT 336 ms, performance 0.81).
 *
 * `scripts/gen-tree-drawings.ts` runs this at build time and writes
 * `public/tree-drawings.json`; `components/decision-tree/TreeDrawing.tsx` draws
 * the frame and the accessible name around it on the client, fetching the map
 * once, after hydration. The drawings themselves are still rendered by server
 * code from the 72-component barrel, which therefore still reaches no client
 * bundle — the contract in `CLAUDE.md`.
 *
 * Plain Node, no `server-only` in its import graph: it is reached from
 * `scripts/**` (`tests/unit/no-server-only-in-scripts.test.ts`). That is also
 * why it takes its catalogue as an argument instead of calling
 * `lib/i18n/request.ts` — and why it cannot live under `app/**`, where
 * Turbopack refuses `react-dom/server` outright.
 */
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DECISION_TREE, ILLUSTRATIONS, type IllustrationId } from "@/lib/domain";

import { illustrationComponent } from "./index";

/** Illustration id → the markup between its `<svg …>` and `</svg>`. */
export type TreeDrawingGeometry = Readonly<Record<string, string>>;

/**
 * Every illustration the decision tree can show: each question's help drawing,
 * then the thumbnails of the options that have one.
 *
 * The single source of that list, shared by the renderer of the drawings
 * (`renderTreeIllustrations`) and the renderer of their shapes, so a drawing
 * can never be shown without its geometry having been built.
 */
export function treeIllustrationIds(): IllustrationId[] {
  const ids: IllustrationId[] = [];
  for (const node of DECISION_TREE) {
    ids.push(node.help.illustrationId);
    for (const option of node.options) {
      if (option.illustrationId !== undefined) ids.push(option.illustrationId);
    }
  }
  return ids;
}

/**
 * The body of a one-root-element markup string: everything between the opening
 * and the closing tag of the `<svg>` `renderToStaticMarkup` just produced.
 *
 * A string operation on our own renderer's output, not a general-purpose HTML
 * parser, and it must stay one — `tree-geometry.test.tsx` pins that.
 */
export function svgBody(markup: string): string {
  const open = markup.indexOf(">");
  const close = markup.lastIndexOf("</svg>");
  if (!markup.startsWith("<svg") || open < 0 || close < open) {
    throw new Error(`not a single <svg> element: ${markup.slice(0, 80)}`);
  }
  return markup.slice(open + 1, close);
}

/**
 * Render every drawing the tree can show and keep only its shapes.
 *
 * `decorative` is deliberately `true`: it drops the `<title>`, the one part of
 * a drawing that is language-dependent. `TreeDrawing` renders the title itself
 * from `illustrations.<id>.alt` in the visitor's locale, so what this returns
 * is a locale-free, build-time constant — one file for both locales. The
 * catalogue is still needed to render at all (the frame reads the alt text even
 * when it does not print it), and any locale's will do.
 *
 * A drawing still on its placeholder is skipped: a placeholder has its own
 * frame, and `renderTreeIllustrations()` keeps rendering those server-side.
 */
export function renderTreeGeometry(messages: Record<string, unknown>): TreeDrawingGeometry {
  const geometry: Record<string, string> = {};

  /* eslint-disable security/detect-object-injection -- `id` is an IllustrationId, a key of the manifest */
  for (const id of treeIllustrationIds()) {
    if (geometry[id] !== undefined) continue;
    const definition = ILLUSTRATIONS[id];
    if (definition.status !== "final") continue;
    const Drawing = illustrationComponent(definition.component);
    if (Drawing === undefined) continue;

    const markup = renderToStaticMarkup(
      <NextIntlClientProvider locale="fr" messages={messages} timeZone="Europe/Paris">
        {/* createElement: the component comes from a static registry. */}
        {createElement(Drawing, { className: "", decorative: true })}
      </NextIntlClientProvider>,
    );
    geometry[id] = svgBody(markup);
  }
  /* eslint-enable security/detect-object-injection */

  return geometry;
}
