/**
 * Integration tier — the real Prisma client against the real `_test` database.
 *
 * Runs before every integration file (after tests/setup.ts):
 *
 * 1. Loads `.env.test` with `override: false`, so a CI `env:` block wins (in
 *    the containerised e2e job the host is `postgres`, not `localhost`).
 * 2. Refuses, before any import can connect, any URL whose database name does
 *    not end in `_test` or whose host is not local — `npx vitest run --project
 *    integration` pointed at the dev database fails fast with
 *    "POSTGRES_URL must end with _test" (§7.6 AC2).
 * 3. Empties the user tables before the file's tests run, so files are
 *    independent (they also run one at a time: `fileParallelism: false`).
 * 4. Closes the `@/lib/db/prisma` pool afterwards so the fork exits cleanly.
 *
 * Migrations and the demo seed are applied once per run by
 * tests/integration/global-setup.ts.
 */
import { config } from "dotenv";
import { afterAll, beforeAll } from "vitest";

import { assertTestDatabaseUrl, truncateTestDatabase } from "./_fakes/db";

config({ path: ".env.test", override: false, quiet: true });

assertTestDatabaseUrl(process.env.POSTGRES_URL, "POSTGRES_URL");
const direct = assertTestDatabaseUrl(
  process.env.POSTGRES_URL_NON_POOLING,
  "POSTGRES_URL_NON_POOLING",
);

beforeAll(async () => {
  await truncateTestDatabase(direct);
});

afterAll(async () => {
  // Imported lazily: the env above must be in place before the client module
  // is evaluated, and a file that never touched `prisma` has nothing to close.
  const { disconnectPrisma } = await import("@/lib/db/prisma");
  await disconnectPrisma();
});
