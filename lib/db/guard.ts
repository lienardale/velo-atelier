/**
 * "Is this a database I am allowed to rewrite?"
 *
 * The seed truncates and re-creates rows, and `prisma migrate reset` drops the
 * whole schema. Both are catastrophic against production, and the only thing
 * standing between the two is an environment variable that is easy to get
 * wrong (`vercel env pull`, a stale shell, a copy-pasted Neon URL).
 *
 * So every destructive entry point asserts, before opening a connection, that
 * the host is a local one. The escape hatch is explicit and loud:
 * `ALLOW_REMOTE_SEED=1`.
 *
 * Plain Node on purpose — no `server-only`: `prisma/seed.ts` and
 * `scripts/db/*` import this.
 */

import type { EnvSource } from "../env";

/**
 * Hosts considered local:
 *   - `localhost` / `127.0.0.1` — the developer's Docker Postgres;
 *   - `db` — the docker-compose service name (compose network);
 *   - `postgres` — the GitHub Actions service container hostname.
 */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "db", "postgres"]);

export class RemoteDatabaseError extends Error {
  readonly host: string;

  constructor(host: string, label: string) {
    super(
      `Refusing to run against a non-local database: ${label} points at host "${host}". ` +
        `Allowed hosts: ${[...LOCAL_HOSTS].join(", ")}. ` +
        `Set ALLOW_REMOTE_SEED=1 only if you really mean it.`,
    );
    this.name = "RemoteDatabaseError";
    this.host = host;
  }
}

export class InvalidDatabaseUrlError extends Error {
  constructor(label: string) {
    super(`${label} is not a valid PostgreSQL connection URL.`);
    this.name = "InvalidDatabaseUrlError";
  }
}

/** Host of a connection string, lowercased and without brackets. */
export function databaseHost(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidDatabaseUrlError("The database URL");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new InvalidDatabaseUrlError("The database URL");
  }
  return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

/** `true` when the URL points at one of the local hosts above. */
export function isLocalDatabaseUrl(url: string): boolean {
  return LOCAL_HOSTS.has(databaseHost(url));
}

/**
 * Throws unless `url` is local (or `ALLOW_REMOTE_SEED=1` is set).
 *
 * Call this **before** constructing a `PrismaClient`: the point is to fail
 * without ever opening a socket to the wrong server.
 */
export function assertLocalDatabaseUrl(
  url: string,
  label = "database URL",
  env: EnvSource = process.env,
): void {
  const host = databaseHost(url);
  if (LOCAL_HOSTS.has(host)) return;
  if (env.ALLOW_REMOTE_SEED === "1") return;
  throw new RemoteDatabaseError(host, label);
}
