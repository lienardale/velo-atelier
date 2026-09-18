/**
 * The geometry of the decision tree's drawings, as data.
 *
 * **Why the shapes are separated from the drawing (`.debug/005`).** The home
 * page shows one question at a time, but the tree navigates on the client, so
 * every drawing it can ever show has to be on the client before the visitor
 * asks for it. Serialising all 54 of them into the page's RSC payload made the
 * home document 322 kB, 301 kB of which was inline `self.__next_f.push(…)`
 * script — 139 kB of shapes for the one drawing the first screen shows, parsed
 * before the page could settle (LCP 3.6 s, TBT 336 ms, performance 0.81).
 *
 * **Why data and not markup.** The obvious artifact is a string of SVG per
 * drawing, injected into the DOM with React's raw-HTML escape hatch.
 * `tests/security/xss-form-inputs.test.ts` forbids that call outside
 * `components/mdx/` as a property of the whole tree — and the rule is worth
 * more absolute than it would be with one well-argued exception in it. So the
 * artifact is a tree of `{ t, a, c }` nodes over a **closed, asserted
 * vocabulary**: `parseDrawing()` below throws on markup it does not recognise,
 * and `checkTag()` / `checkAttribute()` / `parseDrawingStyle()` reject anything
 * not on the whitelists in `tree-drawing-node.ts` — so `npm run build` fails
 * the day a drawing introduces something new. `TreeDrawing` then renders
 * ordinary React elements, and the artifact is provably inert rather than
 * merely trusted.
 *
 * `scripts/gen-tree-drawings.ts` runs this at build time and writes
 * `public/tree-drawings.json`. The drawings are still rendered from
 * `components/illustrations`, by server code, so the 72-component barrel
 * reaches no client bundle — the contract in `CLAUDE.md`.
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
import type { DrawingNode, DrawingStyle } from "./tree-drawing-node";
import { DRAWING_ATTRIBUTES, DRAWING_STYLE_PROPERTIES, DRAWING_TAGS } from "./tree-drawing-node";

/** Illustration id → the shapes inside its `<svg>`. */
export type TreeDrawingGeometry = Readonly<Record<string, DrawingNode[]>>;

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
 * `stroke:var(--color-accent);fill:var(--color-paper)` → a React style object.
 *
 * The only `style` the drawings use, and the only one allowed: a theme token
 * per property, which is how a drawing follows the dark palette without a
 * `dark:` variant. Anything else — a `url(…)`, a raw colour, a property not on
 * the list — throws, because a style attribute is the one place in this
 * vocabulary where a value could reach outside the document.
 */
export function parseDrawingStyle(value: string): DrawingStyle {
  const style: Record<string, string> = {};
  for (const declaration of value.split(";")) {
    if (declaration.trim() === "") continue;
    const [rawProperty, ...rest] = declaration.split(":");
    const property = rawProperty.trim();
    const token = rest.join(":").trim();
    if (!DRAWING_STYLE_PROPERTIES.includes(property as (typeof DRAWING_STYLE_PROPERTIES)[number])) {
      throw new Error(`illustration style property not allowed: ${property}`);
    }
    if (!/^var\(--color-[a-z0-9-]+\)$/.test(token)) {
      throw new Error(`illustration style value must be a colour token, got: ${token}`);
    }
    style[property] = token;
  }
  return style as DrawingStyle;
}

/** `&amp;` and the four others React writes. Nothing else is ever emitted. */
function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    return "'";
  });
}

/**
 * Reject a tag outside the vocabulary, loudly and at build time.
 *
 * Checked per ELEMENT, not per attribute: `<script>alert(1)</script>` carries
 * no attributes, and an attribute-driven check would have waved it through.
 * `tree-geometry.test.tsx` pins exactly that case.
 */
function checkTag(tag: string): void {
  if (!DRAWING_TAGS.includes(tag as (typeof DRAWING_TAGS)[number])) {
    throw new Error(
      `illustration element <${tag}> is not on the whitelist in tree-drawing-node.ts. ` +
        `Add it only if it is an inert shape element — no URL, no script, no foreign content.`,
    );
  }
}

/** Reject an attribute outside the vocabulary, or a value that could point out of it. */
function checkAttribute(tag: string, attribute: string, value: string): void {
  if (!DRAWING_ATTRIBUTES.includes(attribute as (typeof DRAWING_ATTRIBUTES)[number])) {
    throw new Error(
      `illustration attribute "${attribute}" on <${tag}> is not on the whitelist in ` +
        `tree-drawing-node.ts. Add it only if it cannot reference anything outside the drawing.`,
    );
  }
  if (/url\(|javascript:|[<>]/i.test(value)) {
    throw new Error(`illustration attribute ${attribute}="${value}" may not reference or escape`);
  }
}

/**
 * Parse the markup `renderToStaticMarkup` just wrote into drawing nodes.
 *
 * Deliberately **not** a general HTML parser and deliberately not jsdom: this
 * reads one renderer's output over one closed vocabulary, and a grammar that
 * narrow can be strict — anything it does not recognise throws rather than
 * being skipped or guessed at, which is what makes the artifact safe to replay
 * as React elements. React's SVG output is regular: `<tag a="v"/>`,
 * `<tag a="v">…</tag>`, `</tag>`, and text with the five entities escaped. No
 * comments, no CDATA, no doctype, no unquoted or valueless attributes.
 */
export function parseDrawing(markup: string, at = 0): { nodes: DrawingNode[]; end: number } {
  const nodes: DrawingNode[] = [];
  let index = at;

  while (index < markup.length) {
    if (markup.startsWith("</", index)) break;

    if (markup[index] !== "<") {
      const next = markup.indexOf("<", index);
      const stop = next === -1 ? markup.length : next;
      const text = decodeEntities(markup.slice(index, stop));
      if (text.trim() !== "") nodes.push(text);
      index = stop;
      continue;
    }

    const open =
      /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?::[a-zA-Z-]+)?="[^"]*")*)\s*(\/?)>/.exec(
        markup.slice(index),
      );
    if (open === null) {
      throw new Error(`illustration markup not understood at: ${markup.slice(index, index + 60)}`);
    }
    const [matched, tag, rawAttributes, selfClosing] = open;
    checkTag(tag);

    const attributes: Record<string, string | DrawingStyle> = {};
    for (const attribute of rawAttributes.matchAll(/([a-zA-Z-]+(?::[a-zA-Z-]+)?)="([^"]*)"/g)) {
      const name = attribute[1];
      const value = decodeEntities(attribute[2]);
      checkAttribute(tag, name, value);
      attributes[name] = name === "style" ? parseDrawingStyle(value) : value;
    }

    index += matched.length;
    if (selfClosing === "/") {
      nodes.push({ t: tag, a: attributes });
      continue;
    }

    const inner = parseDrawing(markup, index);
    const close = `</${tag}>`;
    if (!markup.startsWith(close, inner.end)) {
      throw new Error(`illustration markup: <${tag}> is not closed where expected`);
    }
    index = inner.end + close.length;
    nodes.push(
      inner.nodes.length === 0
        ? { t: tag, a: attributes }
        : { t: tag, a: attributes, c: inner.nodes },
    );
  }

  return { nodes, end: index };
}

/**
 * Render every drawing the tree can show and keep only its shapes, as data.
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
  const geometry: Record<string, DrawingNode[]> = {};

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

    // Strip the frame: `TreeDrawing` draws it, and its attributes are
    // `treeFrameAttrs()`. What is kept is everything between the tags.
    const open = markup.indexOf(">");
    const close = markup.lastIndexOf("</svg>");
    if (!markup.startsWith("<svg") || open < 0 || close < open) {
      throw new Error(`${id}: expected a single <svg>, got ${markup.slice(0, 80)}`);
    }
    const body = markup.slice(open + 1, close);
    const parsed = parseDrawing(body);
    if (parsed.end !== body.length) {
      throw new Error(`${id}: markup did not parse to the end`);
    }
    geometry[id] = parsed.nodes;
  }
  /* eslint-enable security/detect-object-injection */

  return geometry;
}
