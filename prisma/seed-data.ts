/**
 * Demo data — the single source shared by the seed and the e2e fixtures.
 *
 * Doctrine (inherited from learning/dutato's demo-seed plan):
 *   - a named persona, not "test1/test2";
 *   - **fixed** UUIDs, listed below, so a test can hard-code an id and a
 *     re-seed never invalidates a bookmark or a screenshot;
 *   - `.test` e-mail addresses (RFC 6761 — can never resolve or receive mail);
 *   - idempotent upserts: seeding twice changes no row count (§4.8 AC1);
 *   - never on production — `prisma/seed.ts` refuses a non-local host.
 *
 * The password is committed on purpose and gitleaks-allowlisted: it only ever
 * exists in a throwaway local database, and the e2e suite needs to type it.
 *
 * ## Reserved UUIDs
 *
 * | UUID                                   | Row                                  |
 * | -------------------------------------- | ------------------------------------ |
 * | `00000000-0000-4000-8000-000000000101` | `User` demo@velo-atelier.test (fr)   |
 * | `00000000-0000-4000-8000-000000000102` | `User` demo-en@velo-atelier.test (en)|
 * | `00000000-0000-4000-8000-000000000001` | `Bike.guestLocalId` "Vélo de route"  |
 * | `00000000-0000-4000-8000-000000000002` | `Bike.guestLocalId` "Gravel"         |
 * | `00000000-0000-4000-8000-000000000003` | `Bike.guestLocalId` "VTT électrique" |
 *
 * Bikes are described by their **answers** only: `prisma/seed.ts` runs them
 * through `deriveBike`, exactly as `createBikeAction` does, so the seed can
 * never write a spec the engine would not produce (§4.2 a). The checkup and the
 * build list name step keys, guide slugs, part ids and reason keys as plain
 * strings; the seed validates every one of them against `lib/domain` and
 * `lib/content/generated/*` before it writes, so a renamed step fails the seed
 * instead of leaving a dangling row.
 */

import type { PresetId } from "../lib/domain/data/presets";

/** `UserLocale` in Prisma; `Locale` in TypeScript. */
export type SeedLocale = "fr" | "en";

export interface DemoUserSeed {
  /** Fixed primary key — see the table above. */
  id: string;
  email: string;
  name: string;
  /** Plain text; hashed by the seed with the repo's own `hashPassword()`. */
  password: string;
  locale: SeedLocale;
}

export const DEMO_USER: DemoUserSeed = {
  id: "00000000-0000-4000-8000-000000000101",
  email: "demo@velo-atelier.test",
  name: "Camille Démo",
  password: "Demo-Velo-Atelier-2026!",
  locale: "fr",
};

export const DEMO_USER_EN: DemoUserSeed = {
  id: "00000000-0000-4000-8000-000000000102",
  email: "demo-en@velo-atelier.test",
  name: "Sam Demo",
  password: "Demo-Velo-Atelier-2026!",
  locale: "en",
};

export const DEMO_USERS: readonly DemoUserSeed[] = [DEMO_USER, DEMO_USER_EN];

/**
 * Reserved `Bike.guestLocalId` values. Fixed so that re-importing the same
 * guest payload is a no-op, and so a test can hard-code one.
 */
export const DEMO_BIKE_GUEST_IDS = {
  road: "00000000-0000-4000-8000-000000000001",
  gravel: "00000000-0000-4000-8000-000000000002",
  emtb: "00000000-0000-4000-8000-000000000003",
} as const;

/**
 * A fixed instant used for every seeded timestamp that is not `now()`, so two
 * seeded databases are byte-identical and screenshot diffs stay quiet.
 */
export const SEED_EPOCH = new Date("2026-01-05T09:00:00.000Z");

// ── The garage ───────────────────────────────────────────────────────────────

export type SeedPartStatus = "OK" | "ATTENTION" | "BROKEN" | "UNKNOWN";

export interface DemoBikeSeed {
  /** Which demo account owns it. */
  userId: string;
  /** Fixed `guestLocalId`; also this bike's identity across re-seeds. */
  guestLocalId: string;
  name: string;
  /** A preset of `lib/domain/data/presets.ts` — the answers, never a spec. */
  preset: PresetId;
  /** Remembered measurements (§5.6), or `null`. */
  fit: Record<string, number> | null;
}

/**
 * Four bikes: three in Camille's garage (§4.8 AC1 expects `bikes=4`) and one on
 * the English account so the EN e2e specs have a signed-in bike of their own.
 */
export const DEMO_BIKES: readonly DemoBikeSeed[] = [
  {
    userId: DEMO_USER.id,
    guestLocalId: DEMO_BIKE_GUEST_IDS.road,
    name: "Vélo de route",
    preset: "road-rim-2x11",
    fit: { inseamCm: 84, saddleHeightMm: 742, riderKg: 72, bikeKg: 9 },
  },
  {
    userId: DEMO_USER.id,
    guestLocalId: DEMO_BIKE_GUEST_IDS.gravel,
    name: "Gravel",
    preset: "gravel-1x11",
    fit: { riderKg: 72, bikeKg: 11 },
  },
  {
    userId: DEMO_USER.id,
    guestLocalId: DEMO_BIKE_GUEST_IDS.emtb,
    name: "VTT électrique",
    preset: "emtb-mid-1x12",
    fit: null,
  },
  {
    userId: DEMO_USER_EN.id,
    guestLocalId: DEMO_BIKE_GUEST_IDS.gravel,
    name: "Gravel bike",
    preset: "gravel-1x11",
    fit: null,
  },
];

// ── The completed checkup on the gravel bike ─────────────────────────────────

export interface DemoCheckupItemSeed {
  /** `${guideSlug}#${stepId}` — validated against `lib/content/generated/slugs.ts`. */
  stepKey: string;
  partId: string;
  result: "OK" | "KO" | "SKIPPED";
}

export interface DemoCheckupSeed {
  /** The bike it was run on. */
  guestLocalId: string;
  scope: "FULL" | "PARTIAL";
  items: readonly DemoCheckupItemSeed[];
}

/**
 * One finished full checkup, with exactly **two** KO items (§4.8 AC1). The step
 * keys are the fixed contract of §4.5 with the content authors: `check-drivetrain`
 * is `chain-wear, cassette-teeth, chainring-teeth, derailleur-hanger, shifting-index`
 * and `check-brakes-disc` is `pad-wear, rotor-true, lever-feel, caliper-alignment,
 * hose-leak`.
 */
export const DEMO_CHECKUP: DemoCheckupSeed = {
  guestLocalId: DEMO_BIKE_GUEST_IDS.gravel,
  scope: "FULL",
  items: [
    { stepKey: "check-drivetrain#chain-wear", partId: "chain", result: "KO" },
    { stepKey: "check-drivetrain#cassette-teeth", partId: "cassette", result: "OK" },
    { stepKey: "check-drivetrain#chainring-teeth", partId: "chainring", result: "OK" },
    { stepKey: "check-drivetrain#derailleur-hanger", partId: "rear-derailleur", result: "OK" },
    { stepKey: "check-drivetrain#shifting-index", partId: "rear-derailleur", result: "OK" },
    { stepKey: "check-brakes-disc#pad-wear", partId: "brake-pads-rear", result: "KO" },
    { stepKey: "check-brakes-disc#rotor-true", partId: "rotor-rear", result: "OK" },
    { stepKey: "check-brakes-disc#lever-feel", partId: "brake-lever-rear", result: "OK" },
    { stepKey: "check-brakes-disc#caliper-alignment", partId: "brake-caliper-rear", result: "OK" },
    { stepKey: "check-brakes-disc#hose-leak", partId: "brake-line-rear", result: "SKIPPED" },
  ],
};

// ── The build list it produced ───────────────────────────────────────────────

export interface DemoBuildListItemSeed {
  partId: string;
  action: "REPLACE" | "FIX" | "CLEAN" | "ADJUST" | "INSPECT_SHOP";
  /** A `guides.reasons.*` key, validated against `lib/content/generated/reason-keys.ts`. */
  reasonKey: string;
  guideSlug: string;
  /** The `stepKey` of the checkup item this came from, so the rows are linked. */
  fromStepKey: string;
  chosenProduct?: {
    brand: string;
    model: string;
    size?: string;
    vendor: string;
    url: string;
  };
}

export interface DemoBuildListSeed {
  guestLocalId: string;
  name: string;
  items: readonly DemoBuildListItemSeed[];
}

/** The two KO items of {@link DEMO_CHECKUP}, as work to do. */
export const DEMO_BUILD_LIST: DemoBuildListSeed = {
  guestLocalId: DEMO_BIKE_GUEST_IDS.gravel,
  name: "Révision printemps",
  items: [
    {
      partId: "chain",
      action: "REPLACE",
      reasonKey: "chain-elongation",
      guideSlug: "replace-chain",
      fromStepKey: "check-drivetrain#chain-wear",
      chosenProduct: {
        brand: "Shimano",
        model: "CN-HG601",
        size: "11v",
        vendor: "alltricks",
        url: "https://www.alltricks.fr/Acheter/chaine-shimano-cn-hg601",
      },
    },
    {
      partId: "brake-pads-rear",
      action: "REPLACE",
      reasonKey: "pad-worn",
      guideSlug: "replace-brake-pads-disc",
      fromStepKey: "check-brakes-disc#pad-wear",
    },
  ],
};

/** Part statuses `completeCheckupAction` would write for {@link DEMO_CHECKUP} (§4.2 b). */
export const DEMO_PART_STATUSES: Readonly<Record<string, SeedPartStatus>> = {
  chain: "BROKEN",
  "brake-pads-rear": "BROKEN",
  cassette: "OK",
  chainring: "OK",
  "rear-derailleur": "OK",
  "rotor-rear": "OK",
  "brake-lever-rear": "OK",
  "brake-caliper-rear": "OK",
};
