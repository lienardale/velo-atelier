/**
 * THREAT: a destructive local command reaches a remote database.
 *
 * `prisma db seed` upserts rows, `prisma migrate reset` drops the schema, and
 * both target whatever `POSTGRES_URL` happens to contain — a `vercel env pull`
 * away from being the production Neon branch. The attack does not need an
 * attacker; a stale shell is enough.
 *
 * Control: `assertLocalDatabaseUrl()` runs **before** a `PrismaClient` is
 * constructed, so a wrong target fails without a socket ever being opened, and
 * the only way past it is the deliberate `ALLOW_REMOTE_SEED=1`.
 *
 * Covered here: the guard itself (host allow-list, malformed input, the escape
 * hatch) and the *ordering* inside `prisma/seed.ts`, which is the part a
 * refactor can quietly break. §4.8 AC3 runs the real command end to end.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  InvalidDatabaseUrlError,
  RemoteDatabaseError,
  assertLocalDatabaseUrl,
  databaseHost,
  isLocalDatabaseUrl,
} from "@/lib/db/guard";

const NEON_POOLED =
  "postgresql://user:pw@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/velo_atelier";
const NEON_DIRECT =
  "postgresql://user:pw@ep-cool-name-123456.eu-central-1.aws.neon.tech/velo_atelier";

describe("assertLocalDatabaseUrl", () => {
  it("allows the docker-compose and CI service hosts", () => {
    for (const url of [
      "postgresql://velo:velo@localhost:5432/velo_atelier",
      "postgresql://velo:velo@127.0.0.1:5432/velo_atelier_test",
      "postgresql://velo:velo@db:5432/velo_atelier", // compose network
      "postgresql://velo:velo@postgres:5432/velo_atelier_test", // GitHub Actions service
    ]) {
      expect(() => assertLocalDatabaseUrl(url), url).not.toThrow();
      expect(isLocalDatabaseUrl(url), url).toBe(true);
    }
  });

  it("refuses a Neon host, pooled or direct", () => {
    for (const url of [NEON_POOLED, NEON_DIRECT]) {
      expect(() => assertLocalDatabaseUrl(url, "POSTGRES_URL", {}), url).toThrow(
        RemoteDatabaseError,
      );
      expect(isLocalDatabaseUrl(url), url).toBe(false);
    }
  });

  it("refuses any other remote host", () => {
    for (const url of [
      "postgresql://u:p@10.0.0.5:5432/db",
      "postgresql://u:p@db.internal.example.com:5432/db",
      "postgres://u:p@localhost.evil.example/db", // suffix, not the host
      "postgresql://u:p@notlocalhost:5432/db",
    ]) {
      expect(() => assertLocalDatabaseUrl(url, "POSTGRES_URL", {}), url).toThrow(
        RemoteDatabaseError,
      );
    }
  });

  it("names the offending host and the variable in the message", () => {
    expect(() => assertLocalDatabaseUrl(NEON_POOLED, "POSTGRES_URL", {})).toThrow(
      /ep-cool-name-123456-pooler\.eu-central-1\.aws\.neon\.tech/,
    );
    expect(() => assertLocalDatabaseUrl(NEON_POOLED, "POSTGRES_URL", {})).toThrow(/POSTGRES_URL/);
  });

  it("opens only for an explicit ALLOW_REMOTE_SEED=1", () => {
    expect(() =>
      assertLocalDatabaseUrl(NEON_POOLED, "POSTGRES_URL", { ALLOW_REMOTE_SEED: "1" }),
    ).not.toThrow();

    // Anything truthy-but-not-1 is a typo, not consent.
    for (const value of ["true", "yes", "0", ""]) {
      expect(() =>
        assertLocalDatabaseUrl(NEON_POOLED, "POSTGRES_URL", { ALLOW_REMOTE_SEED: value }),
      ).toThrow(RemoteDatabaseError);
    }
  });

  it("rejects anything that is not a postgres URL rather than guessing", () => {
    for (const url of ["", "not a url", "http://localhost:5432/db", "localhost:5432"]) {
      expect(() => assertLocalDatabaseUrl(url), JSON.stringify(url)).toThrow(
        InvalidDatabaseUrlError,
      );
    }
  });

  it("is case-insensitive about the host", () => {
    expect(databaseHost("postgresql://u:p@LOCALHOST:5432/db")).toBe("localhost");
    expect(() => assertLocalDatabaseUrl("postgresql://u:p@LocalHost:5432/db")).not.toThrow();
  });
});

describe("prisma/seed.ts guards before it connects", () => {
  const seed = readFileSync(join(process.cwd(), "prisma", "seed.ts"), "utf8");

  it("checks both URLs, not just the one it uses", () => {
    expect(seed).toContain('assertLocalDatabaseUrl(urls.pooled, "POSTGRES_URL")');
    expect(seed).toContain('assertLocalDatabaseUrl(urls.direct, "POSTGRES_URL_NON_POOLING")');
  });

  it("refuses a production deployment outright", () => {
    expect(seed).toMatch(/VERCEL_ENV[\s\S]{0,40}production/);
  });

  it("runs the guard before constructing the client", () => {
    // Ordering is the whole control: a guard after `new PrismaClient(...)`
    // would already have opened a connection to the wrong server.
    const guardAt = seed.indexOf("urls = resolveSafeTarget()");
    const clientAt = seed.indexOf("new PrismaClient");
    expect(guardAt).toBeGreaterThan(-1);
    expect(clientAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(clientAt);
  });

  it("exits non-zero instead of continuing", () => {
    expect(seed).toContain("process.exit(1)");
  });
});
