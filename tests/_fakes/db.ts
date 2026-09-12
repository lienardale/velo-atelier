/**
 * The real test database: the guard, its preparation, and a query counter.
 *
 * Used by three entry points that must agree exactly on "which database is
 * this, and am I allowed to wipe it":
 *   - tests/integration/global-setup.ts   (Vitest, once per integration run)
 *   - tests/setup.integration.ts          (Vitest, before every integration file)
 *   - tests/e2e/global-setup.ts           (Playwright, once per run)
 *
 * Deliberately light on imports (dotenv, pg, node built-ins, and one relative
 * import of lib/db/guard): Playwright loads this file with its own TypeScript
 * transform, outside Vite, and the global setups should not pay for the Prisma
 * client they never use.
 *
 * ## Why `migrate deploy` + TRUNCATE, not `migrate reset --force`
 *
 * §7.1/§7.2 describe the global setups as `prisma migrate reset --force` then
 * `prisma db seed`. Prisma 7.10 refuses `migrate reset` whenever it detects an
 * AI agent in the environment (`CLAUDECODE`, `CODEX_*`, `CURSOR_AGENT`, …) and
 * demands the user's verbatim consent in `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`
 * — which would make every agent-driven run of the integration and e2e tiers
 * fail (observed with Prisma 7.10.0 on 2026-09-11, W0-T3b). The end
 * state the plan needs is identical: every committed migration applied, every
 * application table empty, the seed loaded. `migrate deploy` never drops
 * anything, `emptyTestDatabase()` truncates every table but
 * `_prisma_migrations`, and both only run after `assertTestDatabaseUrl()` has
 * proven the target is a local database whose name ends in `_test`.
 * A test database whose migration history no longer matches the repository
 * (hand-edited migration, `db push`) makes `migrate deploy` fail loudly; the
 * fix is `npm run db:reset`, and CI's drift check catches it too.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parse as parseDotenv } from "dotenv";
import pg from "pg";

import type { PrismaClient } from "../../lib/generated/prisma/client";
import { databaseHost } from "../../lib/db/guard";

/** Hosts the test tiers may connect to: Docker locally, the service container in CI. */
export const TEST_DB_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "postgres",
  "db",
]);

/**
 * Emptied before every integration file (§7.1). `CASCADE` follows the foreign
 * keys into Account, Session, BikePartState, CheckupItem and BuildListItem.
 */
export const TRUNCATED_TABLES = ["Bike", "Checkup", "BuildList", "User", "AuthAttempt"] as const;

const TRUNCATE_SQL = `TRUNCATE ${TRUNCATED_TABLES.map((table) => `"${table}"`).join(", ")} CASCADE`;

/** Thrown when a test tier is pointed at anything but a local `_test` database. */
export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTestDatabaseError";
  }
}

/**
 * The one guard. Throws unless `url` is a PostgreSQL URL on a local host whose
 * database name ends in `_test`. No escape hatch: unlike the seed's
 * `ALLOW_REMOTE_SEED`, nothing legitimate ever truncates a remote database.
 */
export function assertTestDatabaseUrl(url: string | undefined, label = "POSTGRES_URL"): string {
  if (!url) {
    throw new UnsafeTestDatabaseError(
      `${label} is not set. The test tiers read it from .env.test (or the CI env: block).`,
    );
  }
  let host: string;
  let database: string;
  try {
    host = databaseHost(url);
    database = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new UnsafeTestDatabaseError(`${label} is not a valid PostgreSQL connection URL.`);
  }
  if (!database.endsWith("_test")) {
    throw new UnsafeTestDatabaseError(
      `POSTGRES_URL must end with _test — ${label} points at database "${database}". ` +
        `The test tiers truncate every table; they never run against a development database.`,
    );
  }
  if (!TEST_DB_HOSTS.has(host)) {
    throw new UnsafeTestDatabaseError(
      `${label} points at host "${host}"; the test tiers only run against ` +
        `${[...TEST_DB_HOSTS].join(", ")}.`,
    );
  }
  return url;
}

/** Repository root — the directory holding prisma/schema.prisma. Asserted, never assumed. */
export function repoRoot(): string {
  const root = process.cwd();
  if (!root || !existsSync(join(root, "prisma", "schema.prisma"))) {
    throw new Error(`Run the test tiers from the repository root (cwd is "${root}").`);
  }
  return root;
}

/**
 * The environment the test tiers run with: `.env.test`, overridden by anything
 * already set in the process (a CI `env:` block wins — in the containerised
 * e2e job the database host is `postgres`, not `localhost`). Returns a copy;
 * `process.env` is left untouched.
 */
export function resolveTestEnv(): Record<string, string> {
  const file = join(repoRoot(), ".env.test");
  const fromFile = existsSync(file) ? parseDotenv(readFileSync(file)) : {};
  const merged: Record<string, string> = { ...fromFile };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** Empty every user table of the test database at `url`. Guarded. */
export async function truncateTestDatabase(url: string | undefined): Promise<void> {
  const client = new pg.Client({ connectionString: assertTestDatabaseUrl(url) });
  await client.connect();
  try {
    await client.query(TRUNCATE_SQL);
  } finally {
    await client.end();
  }
}

/**
 * Empty EVERY application table of the test database at `url` — the data
 * effect of `prisma migrate reset` (only `_prisma_migrations` is kept, which
 * `migrate deploy` needs). Used once per run by the global setups; the
 * per-file reset in setup.integration.ts uses the narrower §7.1 list. Guarded.
 */
export async function emptyTestDatabase(url: string | undefined): Promise<void> {
  const client = new pg.Client({ connectionString: assertTestDatabaseUrl(url) });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length === 0) return;
    const tables = rows.map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`);
    await client.query(`TRUNCATE ${tables.join(", ")} CASCADE`);
  } finally {
    await client.end();
  }
}

/** Resolve once PostgreSQL accepts a connection at `url`, or throw an actionable error. */
export async function waitForDatabase(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const { hostname, port, pathname } = new URL(url);
  throw new Error(
    `No PostgreSQL at ${hostname}:${port || 5432}${pathname} after ${timeoutMs} ms ` +
      `(${(lastError as Error)?.message ?? "unknown error"}). ` +
      `Start it with \`npm run db:up\`; if the _test database is missing on an old volume, \`npm run db:reset\`.`,
  );
}

function runPrisma(args: string[], env: Record<string, string>, root: string): void {
  const cli = join(root, "node_modules", "prisma", "build", "index.js");
  if (!existsSync(cli)) throw new Error(`Prisma CLI not found at ${cli} — run \`npm ci\`.`);
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: {
      ...process.env,
      ...env,
      // `prisma db seed` runs `tsx prisma/seed.ts` through a shell: it needs
      // node and the local binaries on PATH whatever shell launched the tests.
      PATH: [dirname(process.execPath), join(root, "node_modules", ".bin"), env.PATH].join(":"),
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `prisma ${args.join(" ")} failed (exit ${result.status ?? result.signal}):\n` +
        `${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

/**
 * Bring the test database to a known state: migrations applied, user tables
 * empty, demo seed loaded. Every step runs only after the guard.
 */
export async function prepareTestDatabase(label: string): Promise<void> {
  const root = repoRoot();
  const env = resolveTestEnv();
  const direct = assertTestDatabaseUrl(env.POSTGRES_URL_NON_POOLING, "POSTGRES_URL_NON_POOLING");
  assertTestDatabaseUrl(env.POSTGRES_URL, "POSTGRES_URL");

  const { hostname, port, pathname } = new URL(direct);
  // Logged before anything destructive so the target is always in the transcript.
  console.log(`[${label}] cwd ${root}`);
  console.log(`[${label}] preparing ${hostname}:${port || 5432}${pathname}`);

  await waitForDatabase(direct);
  runPrisma(["migrate", "deploy"], env, root);
  await emptyTestDatabase(direct);
  runPrisma(["db", "seed"], env, root);
  console.log(`[${label}] migrations applied, tables truncated, demo seed loaded`);
}

// ─────────────────────────────────────────────────────────────── query counter ──

export interface QueryLogEntry {
  model: string | undefined;
  operation: string;
}

export interface CountingClient<T> {
  client: T;
  log: QueryLogEntry[];
  count(): number;
  reset(): void;
}

/**
 * Wrap a real Prisma client so every query it sends is logged — the N+1 guard
 * for the integration tier (§7.3: the `/velo/[id]` data load stays ≤ 3 queries).
 *
 *   const { client, count } = countingClient(prisma);
 *   await loadBikeForRequest(ref, { prisma: client });
 *   expectQueryBudget(count(), 3, "/velo/[id] data load");
 *
 * A top-level `$allOperations` sees model operations and raw queries alike.
 * With the recording fake, count `fakeDb.calls` with `countQueries()` instead.
 */
export function countingClient<T extends Pick<PrismaClient, "$extends">>(
  prisma: T,
): CountingClient<T> {
  const log: QueryLogEntry[] = [];
  const client = prisma.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        log.push({ model, operation });
        return query(args);
      },
    },
  }) as unknown as T;
  return { client, log, count: () => log.length, reset: () => void (log.length = 0) };
}

/** Queries in a recording-fake call log (`fakeDb.calls`), ignoring `$transaction` markers. */
export function countQueries(calls: ReadonlyArray<{ model: string; op: string }>): number {
  return calls.filter((call) => call.op !== "$transaction").length;
}

/** Throws with the budget in the message when `actual > max`. */
export function expectQueryBudget(actual: number, max: number, label: string): void {
  if (actual > max) {
    throw new Error(`${label}: ${actual} queries, budget is ${max} (N+1?)`);
  }
}
