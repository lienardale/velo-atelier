/**
 * Database URL resolution.
 *
 * One module decides which connection strings the app, the migrations, the
 * seed and `prisma.config.ts` use, so those four can never disagree.
 *
 * Two URLs, always:
 *   - **pooled**   — what the running app talks to (PgBouncer on Neon).
 *   - **direct**   — what migrations and the seed talk to (Neon's unpooled
 *     endpoint; DDL and advisory locks do not survive a transaction pooler).
 * Locally both point at the same Docker Postgres.
 *
 * Names: `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` are what the Vercel
 * Postgres integration injects and what this repo documents in `.env.example`;
 * `DATABASE_URL` / `DATABASE_URL_UNPOOLED` are Neon's own names and are
 * accepted as a fallback so a stock Neon integration also boots.
 *
 * Plain Node on purpose — no `server-only`. `prisma/seed.ts`, `scripts/db/*`
 * and `prisma.config.ts` all import this
 * (see tests/unit/no-server-only-in-scripts.test.ts).
 */

import type { EnvSource } from "../env";

/** Thrown when a required connection string is missing or blank. */
export class MissingDatabaseUrlError extends Error {
  readonly variable: string;

  constructor(variable: string, alternative: string) {
    super(
      `Missing database URL: set ${variable} (or ${alternative}). ` +
        `Copy .env.example to .env.local and start the database with \`npm run db:up\`.`,
    );
    this.name = "MissingDatabaseUrlError";
    this.variable = variable;
  }
}

export interface DatabaseUrls {
  /** Pooled connection — the running application. */
  pooled: string;
  /** Direct connection — migrations, the seed, drift checks. */
  direct: string;
}

/** A `.env` value of `""` (or whitespace) means "unset", never "empty URL". */
function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * Non-throwing variant: returns whatever is configured, `undefined` for what
 * is not. Used by `prisma.config.ts`, where `prisma generate` (which runs as a
 * `postinstall` hook, with no env at all) must not explode — only the commands
 * that actually need a database fail, and they fail loudly.
 */
export function readDatabaseUrls(env: EnvSource = process.env): Partial<DatabaseUrls> {
  return {
    pooled: firstNonBlank(env.POSTGRES_URL, env.DATABASE_URL),
    direct: firstNonBlank(env.POSTGRES_URL_NON_POOLING, env.DATABASE_URL_UNPOOLED),
  };
}

/**
 * Both URLs, or a `MissingDatabaseUrlError`.
 *
 * There is deliberately **no** fallback from `direct` to `pooled`: a migration
 * silently run through a transaction pooler is the kind of failure that only
 * shows up in production.
 */
export function getDatabaseUrls(env: EnvSource = process.env): DatabaseUrls {
  const { pooled, direct } = readDatabaseUrls(env);
  if (!pooled) throw new MissingDatabaseUrlError("POSTGRES_URL", "DATABASE_URL");
  if (!direct) {
    throw new MissingDatabaseUrlError("POSTGRES_URL_NON_POOLING", "DATABASE_URL_UNPOOLED");
  }
  return { pooled, direct };
}
