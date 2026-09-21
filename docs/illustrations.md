# Illustrations — authoring guide

Illustrations are **React SVG components**, not image files: they inherit the
palette through `currentColor` and the colour tokens, work in both colour
schemes with no `dark:` variant, and their text is translated like every other
string. There are 68, in two families.

|                 | Guide drawings                                                                                         | Decision-tree drawings                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ids             | no prefix: `pad-wear-disc`                                                                             | `ill-<question>` (the aid in a question's help) and `ill-<question>-<option>` (an option thumbnail)                                                            |
| Registry        | `GUIDE_ILLUSTRATION_IDS` in `lib/content/illustrations.ts`                                             | `ILLUSTRATION_IDS` / `ILLUSTRATIONS` in `lib/domain/data/illustrations.ts`                                                                                     |
| Count           | 14                                                                                                     | 54: 16 help drawings (aspect `4/3`) and 38 thumbnails (`1/1`)                                                                                                  |
| Frame           | `GuideIllustrationFrame` (`guide-frame.tsx`): 320 × 240, 2 px strokes                                  | `TreeIllustrationFrame` (`tree-frame.tsx`): help drawings 320 × 240 with 2-unit strokes, thumbnails 120 × 120 with 3-unit strokes                              |
| Shared shapes   | `guide-shapes.ts`: `tint`, `solid`, `leader`, `fine`                                                   | `tree-parts.tsx` (parts placed with `Place`), and in `tree-frame.tsx`: `ACCENT`, `MASK`, `ACCENT_MASK`, `FAINT`, `calloutCircle`, `calloutDigit`, `partNumber` |
| Rendered by     | the server, through `components/mdx/Illustration.tsx`                                                  | the build: shapes pre-rendered into `public/tree-drawings.json`, framed in the browser by `components/decision-tree/TreeDrawing.tsx`                           |
| "Not drawn yet" | the frame's `placeholder` prop (default `true`): a dashed box with the id, `data-status="placeholder"` | `status: "placeholder"` in the registry, and a generated placeholder component                                                                                 |

## Where things live

| What                        | Where                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------ |
| The single registry         | `CONTENT_ILLUSTRATIONS` (`lib/content/illustrations.ts`) = both families, 68 entries |
| Components                  | `components/illustrations/Ill<PascalId>.tsx` (`pad-wear-disc` → `IllPadWearDisc`)    |
| Barrel (generated)          | `components/illustrations/index.ts`, with the name → component map                   |
| Alt text and callouts       | `messages/{fr,en}/illustrations.json` → `illustrations.<id>.alt`, `.callouts.<n>`    |
| The tree's drawing artifact | `public/tree-drawings.json` — generated **and committed** (`npm run drawings`)       |
| What that artifact may hold | `components/illustrations/tree-drawing-node.ts`                                      |

The barrel is rewritten by a script — never by hand:

```bash
npx tsx scripts/gen-illustration-placeholders.ts           # create missing tree placeholders + rewrite the barrel
npx tsx scripts/gen-illustration-placeholders.ts --check   # fail if anything is missing
```

It exports every `Ill*.tsx` file it finds, creates a labelled placeholder for a
decision-tree id that has no component yet, and never touches or deletes an
existing drawing.

## Rules for every drawing

- **Accessible name.** `role="img"`, named by a `<title id>` that reads
  `illustrations.<id>.alt` — both frames do it, so a drawing can never render
  without it. `decorative` hides the drawing from assistive technology instead.
- **Alt text** describes what the picture shows, in one sentence, without
  "Image de…".
- **No words inside the SVG.** Only callout digits and, in tree drawings, the
  numbers a part really carries (ETRTO sizes, sprocket counts), all
  `aria-hidden`. What a callout points at is a message, so it is translated.
- **Line-icon style.** Strokes in `currentColor`. Guide drawings add the
  secondary styles of `guide-shapes.ts` — `tint` and `solid` are `currentColor`
  fills at low opacity. Tree drawings fill nothing except the page ground
  (`MASK`, `var(--color-paper)`, to hide lines behind a part or a callout) and
  mark the one feature the question hinges on with `ACCENT`
  (`var(--color-accent)`); a help drawing and its matching thumbnail use the
  same primitive from `tree-parts.tsx`, so the picture in the help panel and the
  card the visitor clicks agree.

## Numbered callouts

Written literally in the component file, a circle and its digit:

```tsx
<circle data-callout="1" cx={60} cy={40} r={11} />
<text x={60} y={40} {...calloutText}>1</text>
```

(`calloutText` in guide drawings; `calloutCircle` / `calloutDigit` in tree
drawings.) The legend under the drawing reads `illustrations.<id>.callouts.<n>`,
and **a drawing with numbered callouts always ships with its legend** — in the
guide renderer (`components/mdx/Illustration.tsx`) and in the tree's
`HelpFigure` (`components/decision-tree/tree-illustrations.tsx`) alike. Keep the
markers literal: `npm run content:check` counts the distinct `data-callout`
numbers in the source of every drawing a guide uses and fails when the count
differs from the message keys in either locale. Tree help drawings carry at
least one callout; thumbnails carry none — the option label names them.

## Adding a guide drawing

1. Add the id to `GUIDE_ILLUSTRATION_IDS` in `lib/content/illustrations.ts`. Its
   registry entry — component name, alt key, `4/3` — is derived from the id, and
   every guide id is registered `final`; what says "not drawn yet" is the frame.
2. Write `components/illustrations/Ill<PascalId>.tsx` inside
   `GuideIllustrationFrame`. Until the drawing is real, leave the frame's
   `placeholder` prop at its default: it prints the id in a dashed box, so an
   unfinished drawing is obvious on the page and in review. Pass
   `placeholder={false}` when it is done.
3. Add `illustrations.<id>.alt` and one `illustrations.<id>.callouts.<n>` per
   numbered callout to **both** `messages/fr/illustrations.json` and
   `messages/en/illustrations.json`.
4. Rewrite the barrel: `npx tsx scripts/gen-illustration-placeholders.ts`.
5. Use it from a guide (below) and run `npm run content:check`.

## Adding a decision-tree drawing

1. Add the entry to `lib/domain/data/illustrations.ts` — the id in
   `ILLUSTRATION_IDS`, the definition in `ILLUSTRATIONS` with aspect `4/3` for a
   help drawing or `1/1` for a thumbnail and `status: "placeholder"` — and point
   the question (`help.illustrationId`) or the option (`illustrationId`) of the
   decision tree at it. A question with four options or more needs a thumbnail
   per option, unless its option ids are plain numbers (the speeds grid).
2. `npx tsx scripts/gen-illustration-placeholders.ts` creates the placeholder
   component and rewrites the barrel.
3. Draw it inside `TreeIllustrationFrame`, from the parts in `tree-parts.tsx`.
4. Add its alt text — and, for a help drawing, its callouts — in both locales.
5. Flip `status` to `"final"`.
6. `npm run drawings` regenerates `public/tree-drawings.json` (`npm run dev` and
   `npm run build` also do). Commit it: `npm run drawings:check`, run by
   `scripts/ci/content.sh`, fails when it is stale.

## The tree's drawings are data over a closed vocabulary

The home page must be able to show any drawing of the tree without shipping all
of them in its HTML (`.debug/007`), so their shapes travel as
`public/tree-drawings.json`, fetched once after hydration. That file is data,
never markup: `renderTreeGeometry()` (`tree-geometry.tsx`) parses its own
renderer's output and asserts every tag, attribute and `style` declaration
against the lists in `tree-drawing-node.ts`, and the build fails on anything
else.

- Tags: `g`, `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`,
  `text`, `tspan`.
- `style` may set only `stroke` and `fill`, and each only to a `var(--color-…)`
  token.
- Absent on purpose: `href`, `xlink:href`, `filter`, `mask`, `clip-path`,
  `class`, every `on*` handler, `<image>`, `<use>`, `<a>`, `<script>`,
  `<foreignObject>` and the animation elements.

A drawing that needs something new fails the build. Adding to either list is a
**security decision**, not a formatting one (`CLAUDE.md`): the tag must be inert
and the attribute must not be able to reference anything outside the drawing.

## Using a drawing

- In a guide's frontmatter: `steps[].illustration: pad-wear-disc`, rendered
  under the step heading.
- In a guide body: `<Illustration id="barrel-adjuster" caption="…" />` — never
  the same id as the step's own illustration (the content check refuses it).
- In the tree: the question's `help.illustrationId` and each option's
  `illustrationId`.
- **Only server files import the barrel**: guides through
  `components/mdx/Illustration.tsx`, the tree through
  `components/decision-tree/tree-illustrations.tsx`. A `"use client"` file that
  imports `components/illustrations/index.ts` puts every drawing in the route's
  first-load JavaScript.

## Checks

- `tests/ui/illustrations.test.tsx` renders every registered drawing in FR and
  EN: `role="img"`, the `<title>` equals the alt text, the `data-callout` circles
  equal the message keys, the box is the family's, and the text is
  `aria-hidden`.
- `tests/unit/content/illustrations.test.ts` validates the registry: the tree
  entries unchanged, the 14 guide entries with derived component names, unique
  components, safe lookups.
- `tests/unit/domain/schema.test.ts` requires every drawing the tree shows to be
  `final` — one of the W5 launch gates.
- `components/illustrations/tree-geometry.test.tsx` holds the closed vocabulary,
  the parser and the frame the browser draws (`treeFrameAttrs()`).
- `npm run content:check`: every id a guide uses is registered and has a
  component file, and its callouts match.

## Status

Nothing is left to draw (2026-09-21).

- **Decision tree, 54**: every entry of `lib/domain/data/illustrations.ts` is
  `status: "final"` since W2-T4c.
- **Guides, 14** (W2-T4a): `pad-wear-disc`, `pad-wear-rim`, `rotor-true-check`,
  `chain-wear-checker`, `derailleur-limit-screws-h-l-b`, `barrel-adjuster`,
  `saddle-height-heel-method`, `cleat-ball-of-foot`, `sag-measure-oring`,
  `axle-qr-vs-thru`, `headset-threaded-vs-threadless`, `ebike-battery-connector`,
  `tire-lever-technique`, `presta-valve-core`. Part outlines use the frame's
  2 px stroke; `leader` lines run from each numbered callout to what it names.
