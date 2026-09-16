/**
 * The guide slug contract (§5.7) — what the content authors (W2-T4a/b) must
 * ship, and what the domain is allowed to point at.
 *
 *   `EXPECTED_SLUGS`  every guide of the MVP, 47 slugs in five kinds
 *   `FULL_SLUGS`      the 26 (★) written in full, FR and EN, before launch —
 *                     every `check` and every `measure` guide among them
 *
 * Tests derive every count from these arrays and never restate a number; the
 * two `satisfies` lines below are the only place the sizes are written, and they
 * fail `tsc`, not a test, if the lists drift from §5.7.
 *
 * Slugs are English in both locales and start with their kind
 * (`/fr/guides/check-brakes-disc`), so `kindOfSlug` needs no lookup table.
 */

export const GUIDE_KINDS = ["check", "replace", "clean", "adjust", "measure"] as const;

export type GuideKind = (typeof GUIDE_KINDS)[number];

export const CHECK_SLUGS = [
  "check-brakes-rim",
  "check-brakes-disc",
  "check-drivetrain",
  "check-hub-gear",
  "check-wheels-tires",
  "check-headset",
  "check-bottom-bracket",
  "check-pedals",
  "check-cables-hoses",
  "check-e-system",
  "check-suspension",
  "check-frame-bolts",
  "check-lights-safety",
] as const;

export const REPLACE_SLUGS = [
  "replace-brake-pads-disc",
  "replace-brake-pads-rim",
  "replace-tube-tire",
  "replace-tire-tubeless",
  "replace-chain",
  "replace-cassette",
  "replace-brake-cable",
  "replace-shift-cable",
  "replace-bar-tape",
  "replace-grips",
  "replace-saddle",
  "replace-pedals",
  "replace-rotor",
] as const;

export const CLEAN_SLUGS = [
  "clean-chain",
  "clean-drivetrain",
  "clean-disc-rotors-pads",
  "clean-rim-braking-surface",
  "clean-frame",
  "clean-ebike-dos-donts",
] as const;

export const ADJUST_SLUGS = [
  "adjust-rear-derailleur",
  "adjust-front-derailleur",
  "adjust-electronic-indexing",
  "adjust-disc-caliper-alignment",
  "adjust-rim-brake-centering",
  "adjust-brake-lever-reach",
  "adjust-headset-preload",
  "adjust-hub-bearing-preload",
  "adjust-suspension-sag",
  "adjust-cleats",
] as const;

export const MEASURE_SLUGS = [
  "measure-saddle-height",
  "measure-saddle-setback",
  "measure-reach-and-drop",
  "measure-tire-pressure",
  "measure-chain-wear",
] as const;

export const EXPECTED_SLUGS = [
  ...CHECK_SLUGS,
  ...REPLACE_SLUGS,
  ...CLEAN_SLUGS,
  ...ADJUST_SLUGS,
  ...MEASURE_SLUGS,
] as const;

export type GuideSlug = (typeof EXPECTED_SLUGS)[number];

/** ★ in §5.7: full FR + EN before launch. Check and measure guides are never stubs. */
export const FULL_SLUGS = [
  ...CHECK_SLUGS,
  "replace-brake-pads-disc",
  "replace-brake-pads-rim",
  "replace-tube-tire",
  "replace-chain",
  "clean-chain",
  "adjust-rear-derailleur",
  "adjust-disc-caliper-alignment",
  "adjust-suspension-sag",
  ...MEASURE_SLUGS,
] as const satisfies readonly GuideSlug[];

// The sizes §5.7 fixes. A wrong count is a type error on one of these lines.
EXPECTED_SLUGS.length satisfies 47;
FULL_SLUGS.length satisfies 26;

/** The kind a slug belongs to — its first segment. */
export function kindOfSlug(slug: GuideSlug): GuideKind {
  return slug.slice(0, slug.indexOf("-")) as GuideKind;
}

const EXPECTED: ReadonlySet<string> = new Set(EXPECTED_SLUGS);

export function isExpectedSlug(value: string): value is GuideSlug {
  return EXPECTED.has(value);
}
