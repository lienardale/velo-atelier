/**
 * The `citext` extension must be created by migration 0001.
 *
 * `User.email` is `@db.Citext`, so the very first `CREATE TABLE "User"` fails
 * with `type "citext" does not exist` unless the extension is created first.
 * Prisma cannot do that for us any more: `postgresqlExtensions` is deprecated
 * and no longer emits DDL, so the statement is prepended **by hand** to the
 * generated SQL (§4.2), which means it is exactly the kind of thing a
 * regenerated migration would quietly drop.
 *
 * Hence this test: it reads the committed SQL rather than the database, so it
 * fails in `unit` (no Docker, milliseconds) instead of during a deploy.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const CITEXT = "CREATE EXTENSION IF NOT EXISTS citext;";

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function initMigrationDir(): string {
  const dirs = migrationDirs().filter((name) => name.endsWith("_init"));
  expect(dirs, "exactly one `<timestamp>_init` migration").toHaveLength(1);
  return dirs[0];
}

/** Statements with comments and blank lines stripped. */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("migration 0001 (init)", () => {
  const dir = initMigrationDir();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path built from a repo constant and a directory listing
  const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");

  it("is named `<timestamp>_init`", () => {
    expect(dir).toMatch(/^\d{14}_init$/);
  });

  it("creates the citext extension", () => {
    expect(sql).toContain(CITEXT);
  });

  it("creates it before anything that could need it", () => {
    // First statement, not merely "present": a CREATE TABLE using the citext
    // type above this line would fail.
    expect(statements(sql)[0]).toBe(CITEXT.replace(/;$/, ""));
  });

  it("uses IF NOT EXISTS so re-applying is safe", () => {
    // `migrate deploy` on a database where a previous attempt half-applied,
    // and `migrate reset` on a template database that already has it.
    expect(sql).not.toMatch(/CREATE EXTENSION(?! IF NOT EXISTS)/);
  });

  it("declares the email column as citext", () => {
    expect(sql).toMatch(/"email"\s+CITEXT\s+NOT NULL/i);
  });

  it("creates every table the schema declares", () => {
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
      expect(sql, `CREATE TABLE "${table}"`).toContain(`CREATE TABLE "${table}"`);
    }
  });
});
