# Illustrations — authoring guide

> Draft (W1-T4). W4-T4 finalises this page once the real drawings land.

Illustrations are **React SVG components**, not image files: they inherit the
palette through `currentColor`, work in both colour schemes, and their text is
translated like every other string.

## Where things live

| What                        | Where                                                     |
| --------------------------- | --------------------------------------------------------- |
| Decision-tree ids (`ill-*`) | `lib/domain/data/illustrations.ts` (W1-T1)                |
| Guide ids (no prefix)       | `lib/content/illustrations.ts` (`GUIDE_ILLUSTRATION_IDS`) |
| The single registry         | `CONTENT_ILLUSTRATIONS` = both of the above               |
| Components                  | `components/illustrations/Ill<PascalId>.tsx`              |
| Barrel (generated)          | `components/illustrations/index.ts`                       |
| Alt text and callouts       | `messages/{fr,en}/illustrations.json`                     |

After adding a component file, regenerate the barrel:

```bash
npx tsx scripts/gen-illustration-placeholders.ts
```

## Guide drawings

- Wrap the drawing in `GuideIllustrationFrame` (`components/illustrations/guide-frame.tsx`):
  `viewBox="0 0 320 240"`, `stroke="currentColor"`, `strokeWidth={2}`,
  `role="img"` named by `<title id>` = `illustrations.<id>.alt`.
- **No words inside the SVG.** Point at things with numbered callouts, written
  literally in the file:

  ```tsx
  <circle data-callout="1" cx={60} cy={40} r={11} />
  <text x={60} y={40} {...calloutText}>1</text>
  ```

  The legend under the drawing reads `illustrations.<id>.callouts.<n>`.
  `npm run content:check` counts the `data-callout` markers and fails when the
  number differs from the message keys in either locale.

- Pass `placeholder={false}` to the frame and set `status: "final"` in the
  registry once the drawing is real.
- Alt text describes what the picture shows, in one sentence, without "Image
  de…".

## Using a drawing

- In a guide's frontmatter: `steps[].illustration: pad-wear-disc` (rendered
  under the step heading).
- In a body: `<Illustration id="barrel-adjuster" caption="…" />` — not the same
  id as the step's own illustration.

## Checks

- `tests/ui/illustrations.test.tsx` renders every registered drawing in FR and
  EN: `role="img"`, `<title>` equals the alt text, callouts equal the keys.
- `tests/unit/content/illustrations.test.ts` validates the registry.

## Status

The 14 guide drawings are final (W2-T4a): `pad-wear-disc`, `pad-wear-rim`,
`rotor-true-check`, `chain-wear-checker`, `derailleur-limit-screws-h-l-b`,
`barrel-adjuster`, `saddle-height-heel-method`, `cleat-ball-of-foot`,
`sag-measure-oring`, `axle-qr-vs-thru`, `headset-threaded-vs-threadless`,
`ebike-battery-connector`, `tire-lever-technique`, `presta-valve-core`. They
share the secondary styles in `components/illustrations/guide-shapes.ts`
(`tint`, `solid`, `leader`, `fine`): part outlines use the frame's 2 px stroke,
leader lines run from each numbered callout to what it names.
