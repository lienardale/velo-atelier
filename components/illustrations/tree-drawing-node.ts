/**
 * The vocabulary a decision-tree drawing's shapes are allowed to use.
 *
 * `public/tree-drawings.json` is the one artifact in this repository that is
 * generated on one side of the server/client boundary and rendered on the
 * other (`.debug/007`), so it is also the one that has to prove it cannot carry
 * anything but shapes. It does that by being **data over a closed vocabulary**
 * rather than markup: `renderTreeGeometry()` asserts every tag, every attribute
 * and every `style` declaration against the lists below and throws at build
 * time otherwise, and `TreeDrawing` renders the result as ordinary React
 * elements. React's raw-HTML escape hatch appears nowhere —
 * `tests/security/xss-form-inputs.test.ts` forbids it outside
 * `components/mdx/` as a property of the whole tree (a grep over every source
 * file, prose included), and a rule like that is worth more absolute than it
 * would be with one well-argued exception in it.
 *
 * Both lists are deliberately short. Adding to either is a security decision,
 * not a formatting one: the tags must be inert (they draw, they cannot fetch,
 * script or embed) and the attributes must be unable to reference anything
 * outside the drawing. `href`, `xlink:href`, `filter`, `mask`, `clip-path`,
 * `class`, every `on*` handler, `<image>`, `<use>`, `<a>`, `<script>`,
 * `<foreignObject>` and the animation elements are all absent on purpose.
 *
 * No React here, and no `server-only`: the type is shared by the generator
 * (`scripts/gen-tree-drawings.ts`) and the client
 * (`components/decision-tree/TreeDrawing.tsx`).
 */

/** Shape elements: they draw and nothing else. */
export const DRAWING_TAGS = [
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
] as const;

/** Geometry, stroke and type: none of these can point anywhere. */
export const DRAWING_ATTRIBUTES = [
  // geometry
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "points",
  "transform",
  // stroke and fill
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "style",
  // type
  "text-anchor",
  "dominant-baseline",
  "font-size",
  "font-weight",
  "font-family",
  "letter-spacing",
  // the drawing's own hooks
  "data-callout",
  "aria-hidden",
] as const;

/**
 * The only `style` properties a drawing may set, and each only to a
 * `var(--color-…)` token — the mechanism that makes a drawing follow the dark
 * palette with no `dark:` variant (`components/illustrations/tree-frame.tsx`).
 */
export const DRAWING_STYLE_PROPERTIES = ["stroke", "fill"] as const;

/** A `style` attribute, already parsed into the object React wants. */
export type DrawingStyle = Partial<Record<(typeof DRAWING_STYLE_PROPERTIES)[number], string>>;

/** One element of a drawing: tag, attributes, children. */
export interface DrawingElement {
  t: string;
  a: Record<string, string | DrawingStyle>;
  c?: DrawingNode[];
}

/** An element, or the short literal a `<text>` prints (a callout digit, an ETRTO size). */
export type DrawingNode = string | DrawingElement;
