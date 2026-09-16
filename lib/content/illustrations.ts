/**
 * The single illustration registry the content pipeline validates against
 * (§5.3): the decision-tree drawings owned by the domain
 * (`lib/domain/data/illustrations.ts`, W1-T1) plus the drawings the guides use.
 *
 * The domain ids are a subset of this registry, not a copy: they are spread in
 * from the domain manifest, so a drawing added there is immediately valid in a
 * guide too.
 *
 * Guide ids have no `ill-` prefix (`pad-wear-disc`, not `ill-pad-wear-disc`):
 * the prefix marks the decision-tree aids and thumbnails, whose ids are derived
 * from question and option ids. Components follow the same `Ill<Pascal>`
 * naming, live in `components/illustrations/`, and are exported by its
 * generated barrel; alt text and numbered callouts are
 * `illustrations.<id>.{alt,callouts.<n>}` in `messages/{fr,en}/illustrations.json`.
 *
 * Guide drawings are laid out in a 320 × 240 box (4/3). W1-T4 ships them as
 * labelled placeholders with their callouts in place; W2-T4a/b draw them and
 * flip `status` to `"final"`.
 *
 * Zod-free, React-free: imported by the check script, tests and components.
 */
import { ILLUSTRATIONS } from "@/lib/domain/data/illustrations";
import type { IllustrationDef } from "@/lib/domain/schema/illustration";

export const GUIDE_ILLUSTRATION_IDS = [
  "pad-wear-disc",
  "pad-wear-rim",
  "rotor-true-check",
  "chain-wear-checker",
  "derailleur-limit-screws-h-l-b",
  "barrel-adjuster",
  "saddle-height-heel-method",
  "cleat-ball-of-foot",
  "sag-measure-oring",
  "axle-qr-vs-thru",
  "headset-threaded-vs-threadless",
  "ebike-battery-connector",
  "tire-lever-technique",
  "presta-valve-core",
] as const;

export type GuideIllustrationId = (typeof GUIDE_ILLUSTRATION_IDS)[number];

/** `pad-wear-disc` → `IllPadWearDisc`; `derailleur-limit-screws-h-l-b` → `IllDerailleurLimitScrewsHLB`. */
export function componentNameFor(id: string): string {
  return `Ill${id
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("")}`;
}

const guideEntry = (id: GuideIllustrationId): IllustrationDef => ({
  component: componentNameFor(id),
  altKey: `illustrations.${id}.alt`,
  aspect: "4/3",
  status: "placeholder",
});

export const GUIDE_ILLUSTRATIONS: Readonly<Record<GuideIllustrationId, IllustrationDef>> =
  Object.fromEntries(GUIDE_ILLUSTRATION_IDS.map((id) => [id, guideEntry(id)])) as Record<
    GuideIllustrationId,
    IllustrationDef
  >;

/** Every drawing a page may render: decision tree first, then guides. */
export const CONTENT_ILLUSTRATIONS: Readonly<Record<string, IllustrationDef>> = {
  ...ILLUSTRATIONS,
  ...GUIDE_ILLUSTRATIONS,
};

/** The registered definition of `id`, or `undefined` (prototype keys included). */
export function illustrationDefinition(id: string): IllustrationDef | undefined {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(CONTENT_ILLUSTRATIONS, id) ? CONTENT_ILLUSTRATIONS[id] : undefined;
}

export function isContentIllustrationId(value: unknown): value is string {
  return typeof value === "string" && illustrationDefinition(value) !== undefined;
}
