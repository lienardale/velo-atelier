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
 * The three bike ids are **reserved, not yet used**: bikes, part states,
 * checkups and build lists are seeded by W2-T3, once `lib/domain` can derive a
 * `BikeSpec` from `Answers`. This file currently seeds users only.
 */

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
 * Reserved `Bike.guestLocalId` values (W2-T3 attaches the actual bikes).
 * Declared here so nothing else ever claims them.
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
