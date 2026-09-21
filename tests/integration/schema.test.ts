/**
 * The migrated database really has the shape the schema promises.
 *
 * Everything here is checked against `information_schema` / `pg_catalog`
 * rather than through Prisma, because the interesting failures are exactly the
 * ones Prisma's types cannot see: an extension that was never created, a
 * cascade that is `NO ACTION` in the SQL, a `citext` column that came out as
 * `text` because a migration was regenerated and the hand-written first line
 * was lost.
 *
 * Runs against the `_test` database only (§7.6 AC2). `tests/setup.integration.ts`
 * loads `.env.test` and truncates between files; the assertion below is a
 * second lock on the same door, so this file can never touch the dev database
 * even when run on its own.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabaseUrls } from "@/lib/db/env";
import { PrismaClient } from "@/lib/generated/prisma/client";

let prisma: PrismaClient;

beforeAll(() => {
  const { direct } = getDatabaseUrls();
  const database = new URL(direct).pathname.replace(/^\//, "");
  if (!database.endsWith("_test")) {
    throw new Error(`POSTGRES_URL must end with _test (got "${database}")`);
  }
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: direct, max: 1 }) });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function rows<T>(query: Promise<unknown>): Promise<T[]> {
  return (await query) as T[];
}

describe("extensions", () => {
  it("has citext installed", async () => {
    // Created by hand as the first statement of migration 0001; without it
    // `User.email` could not exist at all.
    const found = await rows<{ extname: string }>(
      prisma.$queryRaw`SELECT extname FROM pg_extension WHERE extname = 'citext'`,
    );
    expect(found).toHaveLength(1);
  });
});

describe("tables and enums", () => {
  it("has every model's table", async () => {
    const found = await rows<{ table_name: string }>(
      prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = found.map((row) => row.table_name);

    for (const table of [
      "User",
      "Account",
      "Session",
      "VerificationToken",
      "AuthAttempt",
      "Bike",
      "BikePartState",
      "Checkup",
      "CheckupItem",
      "BuildList",
      "BuildListItem",
    ]) {
      expect(names, table).toContain(table);
    }
  });

  it("has every enum with exactly its declared labels", async () => {
    const found = await rows<{ typname: string; labels: string[] }>(
      prisma.$queryRaw`
        SELECT t.typname::text AS typname,
               array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        GROUP BY t.typname
      `,
    );
    const byName = new Map(found.map((row) => [row.typname, row.labels]));

    expect(byName.get("UserLocale")).toEqual(["fr", "en"]);
    expect(byName.get("PartStatus")).toEqual(["OK", "ATTENTION", "BROKEN", "UNKNOWN"]);
    expect(byName.get("CheckupScope")).toEqual(["FULL", "PARTIAL"]);
    expect(byName.get("CheckupStatus")).toEqual(["IN_PROGRESS", "COMPLETED", "ABANDONED"]);
    expect(byName.get("CheckupResult")).toEqual(["OK", "KO", "SKIPPED"]);
    expect(byName.get("BuildListStatus")).toEqual(["OPEN", "DONE", "ARCHIVED"]);
    expect(byName.get("BuildAction")).toEqual([
      "REPLACE",
      "FIX",
      "CLEAN",
      "ADJUST",
      "INSPECT_SHOP",
    ]);
  });
});

describe("User", () => {
  it("stores email as citext", async () => {
    const found = await rows<{ udt_name: string }>(
      prisma.$queryRaw`
        SELECT udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'email'
      `,
    );
    expect(found[0]?.udt_name).toBe("citext");
  });

  it("treats email as case-insensitive for uniqueness", async () => {
    // The reason for citext in the first place: two accounts differing only in
    // case are the same person, and `getUserByEmail` must find either spelling.
    const email = `Case-Test-${Date.now()}@velo-atelier.test`;
    const created = await prisma.user.create({ data: { email } });
    try {
      const found = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      expect(found?.id).toBe(created.id);

      await expect(
        prisma.user.create({ data: { email: email.toUpperCase() } }),
      ).rejects.toMatchObject({ code: "P2002" });
    } finally {
      await prisma.user.delete({ where: { id: created.id } });
    }
  });

  it("generates a uuid primary key in the database", async () => {
    const created = await prisma.user.create({
      data: { email: `uuid-${Date.now()}@velo-atelier.test` },
    });
    try {
      expect(created.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    } finally {
      await prisma.user.delete({ where: { id: created.id } });
    }
  });

  it("caps passwordHash at bcrypt's 72 characters", async () => {
    const found = await rows<{ character_maximum_length: number }>(
      prisma.$queryRaw`
        SELECT character_maximum_length FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'passwordHash'
      `,
    );
    expect(found[0]?.character_maximum_length).toBe(72);
  });
});

describe("referential integrity", () => {
  it("cascades from User to Bike and beyond, so one delete satisfies GDPR", async () => {
    const cascades = await rows<{ constraint_name: string; delete_rule: string }>(
      prisma.$queryRaw`
        SELECT constraint_name, delete_rule
        FROM information_schema.referential_constraints
        WHERE constraint_schema = 'public'
      `,
    );
    const ruleFor = (fragment: string) =>
      cascades.find((row) => row.constraint_name.includes(fragment))?.delete_rule;

    expect(ruleFor("Bike_userId")).toBe("CASCADE");
    expect(ruleFor("Account_userId")).toBe("CASCADE");
    expect(ruleFor("Session_userId")).toBe("CASCADE");
    expect(ruleFor("BikePartState_bikeId")).toBe("CASCADE");
    expect(ruleFor("Checkup_bikeId")).toBe("CASCADE");
    expect(ruleFor("CheckupItem_checkupId")).toBe("CASCADE");
    expect(ruleFor("BuildList_bikeId")).toBe("CASCADE");
    expect(ruleFor("BuildListItem_buildListId")).toBe("CASCADE");

    // A build list outlives the checkup it was derived from, and an item
    // outlives the checkup item it came from.
    expect(ruleFor("BuildList_checkupId")).toBe("SET NULL");
    expect(ruleFor("BuildListItem_checkupItemId")).toBe("SET NULL");
  });

  it("has the unique constraints the business rules depend on", async () => {
    const indexes = await rows<{ indexname: string }>(
      prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const names = indexes.map((row) => row.indexname);

    // Guest import idempotency, one state per (bike, part), one item per step,
    // one build-list row per (part, action).
    expect(names).toContain("Bike_userId_guestLocalId_key");
    expect(names).toContain("BikePartState_bikeId_partId_key");
    expect(names).toContain("CheckupItem_checkupId_stepKey_key");
    expect(names).toContain("BuildListItem_buildListId_partId_action_key");
    expect(names).toContain("User_email_key");
  });
});

describe("migration 20260921090547_checkup_symptoms_done_reason (W4)", () => {
  it("adds the symptoms of a KO to CheckupItem, as a list defaulting to empty", async () => {
    const found = await rows<{
      data_type: string;
      udt_name: string;
      column_default: string | null;
    }>(
      prisma.$queryRaw`
        SELECT data_type, udt_name, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'CheckupItem' AND column_name = 'reasonKeys'
      `,
    );
    expect(found[0]).toMatchObject({ data_type: "ARRAY", udt_name: "_varchar" });
    // Postgres spells it `(ARRAY[]::character varying[])::character varying(80)[]`.
    expect(found[0]?.column_default).toContain("ARRAY[]");
  });

  it("adds why a line is done to BuildListItem, nullable", async () => {
    const found = await rows<{ is_nullable: string; character_maximum_length: number }>(
      prisma.$queryRaw`
        SELECT is_nullable, character_maximum_length FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'BuildListItem' AND column_name = 'doneReason'
      `,
    );
    expect(found[0]).toMatchObject({ is_nullable: "YES", character_maximum_length: 16 });
  });

  it("reads a row written without symptoms as none, and one written with them back", async () => {
    // What a row from before the migration looks like: the column's default.
    const user = await prisma.user.create({
      data: { email: `symptoms-${Date.now()}@velo-atelier.test` },
    });
    try {
      const bike = await prisma.bike.create({
        data: { userId: user.id, name: "Test", answers: {}, spec: {}, parts: [] },
      });
      const checkup = await prisma.checkup.create({ data: { bikeId: bike.id, scope: "FULL" } });
      const bare = await prisma.checkupItem.create({
        data: {
          checkupId: checkup.id,
          stepKey: "check-brakes-disc#pad-wear",
          partId: "brake-pads-front",
          guideSlug: "check-brakes-disc",
          result: "KO",
        },
      });
      const ticked = await prisma.checkupItem.create({
        data: {
          checkupId: checkup.id,
          stepKey: "check-drivetrain#chain-wear",
          partId: "chain",
          guideSlug: "check-drivetrain",
          result: "KO",
          reasonKeys: ["chain-elongation"],
        },
      });
      expect(bare.reasonKeys).toEqual([]);
      const read = await prisma.checkupItem.findUniqueOrThrow({ where: { id: ticked.id } });
      expect(read.reasonKeys).toEqual(["chain-elongation"]);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
