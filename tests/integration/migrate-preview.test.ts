/**
 * `scripts/ci/migrate-preview.sh`, with the real Prisma and a real database.
 *
 * The unit tier (`tests/unit/deploy/migrate-on-deploy.test.ts`) executes every
 * refusal of that script and its success path — but the success there is a
 * stand-in `npx` answering 0, because the only real `prisma migrate deploy` it
 * can afford ends in a P1001 against a host that does not exist. Its header
 * used to say why there was no more: "the happy path is still absent — it
 * needs a Neon branch". It does not. It needs a PostgreSQL, and this tier has
 * one.
 *
 * So this is the one place where the script's whole chain is real: the
 * endpoint assertion on an actual connection string, `POSTGRES_URL_NON_POOLING`
 * read by `prisma.config.ts`, Prisma's schema engine reaching a server, its
 * own words through the `sed | tee` pipe with `pipefail`, the exit status, and
 * the job summary. What it cannot show is the redaction: on `localhost` (or
 * the CI service's `postgres`) the host is shorter than the 14 characters the
 * log is allowed, so nothing is cut. That half is the unit tier's.
 *
 * Two cases, and they treat the server differently:
 *
 * - **The green run** uses the tier's own database, by the tier's own guard:
 *   the URL goes through `assertTestDatabaseUrl` (a local host, a name ending
 *   in `_test`) before the script sees it, and `migrate deploy` is the same
 *   command `tests/integration/global-setup.ts` has already run against it —
 *   which is why the verdict asserted is "nothing pending". It creates, drops
 *   and truncates nothing.
 * - **The stray database** is the one case here that creates something, and
 *   has to: what it holds is Prisma's own wording for "I created the database",
 *   which is all the script has to go on, and only the real Prisma creating a
 *   real database prints it. The name is this tier's database name with a
 *   suffix, still ending in `_test`, still through the same guard; the case
 *   drops it again whatever happened, and checks that it is gone.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertTestDatabaseUrl, repoRoot } from "../_fakes/db";

const SCRIPT = "scripts/ci/migrate-preview.sh";

/**
 * `spawnSync` cannot be interrupted by Vitest, so it carries its own cap. One
 * run is ~1.5 s here; the cap, and the test's, are far above that because the
 * tier runs after a build on a busy runner.
 */
const SPAWN_TIMEOUT_MS = 120_000;

let sandbox: string;

/* eslint-disable security/detect-non-literal-fs-filename -- every path below is built from mkdtemp */
beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "velo-migrate-preview-it-"));
  mkdirSync(join(sandbox, "home"));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

interface Run {
  readonly status: number | null;
  /** stdout then stderr: both are the public log. */
  readonly output: string;
  /** The job summary the run wrote, or `null` when it wrote none. */
  readonly summary: string | null;
}

/** Run the unmodified script as the workflow's migrate step would, against `direct`. */
function migrate(direct: string, summaryName: string): Run {
  const root = repoRoot();
  const summaryFile = join(sandbox, summaryName);
  const result = spawnSync("bash", [join(root, SCRIPT)], {
    cwd: root,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
    // Built from nothing, like the unit tier's: what GitHub hands the step,
    // and no more. `HOME` is an empty directory so `_lib.sh` finds no nvm to
    // put its own `npx` first, and the node running this test — with its
    // `npx` — leads `PATH`.
    env: {
      PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(":"),
      HOME: join(sandbox, "home"),
      NODE_ENV: process.env.NODE_ENV ?? "test",
      CHECKPOINT_DISABLE: "1",
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/heads/main",
      GITHUB_STEP_SUMMARY: summaryFile,
      NEON_PREVIEW_DIRECT_URL: direct,
      PREVIEW_MIGRATIONS_ENABLED: "1",
      // The script refuses a secret whose host is not the endpoint this
      // names. Here the "preview endpoint" is the test database's own host.
      NEON_PREVIEW_ENDPOINT: new URL(direct).hostname,
    },
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    summary: existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : null,
  };
}
/* eslint-enable security/detect-non-literal-fs-filename */

/**
 * Neither text holds the connection string, nor the credentials out of it.
 * (The password alone cannot be searched for: this database's is a word that
 * also appears in its name.)
 */
function publishesNoCredentials(direct: string, ...texts: string[]): void {
  const { username, password } = new URL(direct);
  for (const text of texts) {
    expect(text).not.toContain(direct);
    expect(text).not.toContain("postgresql://");
    expect(text).not.toContain(`${username}:${password}@`);
  }
}

describe("migrate-preview.sh against a real database", () => {
  it("migrates the test database and reports Prisma's own verdict", { timeout: 180_000 }, () => {
    // The guard, then the URL — never the other way round.
    const direct = assertTestDatabaseUrl(
      process.env.POSTGRES_URL_NON_POOLING,
      "POSTGRES_URL_NON_POOLING",
    );
    const { hostname, pathname } = new URL(direct);

    const { status, output, summary } = migrate(direct, "summary.md");

    // Named first, so a failure prints the log rather than "expected 1 to be 0".
    expect(output).toContain(`prisma migrate deploy → ${hostname}${pathname}`);
    // The real Prisma, reading this repository's config and schema.
    expect(output).toContain("Loaded Prisma config from prisma.config.ts.");
    expect(output).toContain('Datasource "db": PostgreSQL database');
    // Its verdict on a database the global setup has already migrated.
    expect(output).toContain("No pending migrations to apply.");
    expect(status).toBe(0);
    expect(output).toContain(`prisma migrate deploy exited 0 on ${hostname}${pathname}`);
    // The real datasource line begins `PostgreSQL database "<name>", …` too.
    // It is not a creation, and the script must not take it for one.
    expect(output).not.toContain("Prisma CREATED the database");

    // The summary carries the endpoint and Prisma's words — and, since nothing
    // was pending, no claim that anything was applied.
    expect(summary).not.toBeNull();
    expect(summary).toContain(`exited 0 on \`${hostname}${pathname}\``);
    expect(summary).toContain("No pending migrations to apply.");
    expect(summary).not.toMatch(/applied/i);

    publishesNoCredentials(direct, output, summary ?? "");
  });

  it(
    "fails the run in which the real Prisma creates the database it was pointed at",
    { timeout: 240_000 },
    async () => {
      // The script asserts the endpoint and cannot assert the database's name,
      // and `migrate deploy` creates a database that is missing: one wrong
      // character in the secret's path was a green run that migrated a brand
      // new database and left the one the previews read untouched (measured,
      // 2026-10-06 — the script's own comment has the output). The script now
      // fails that run on the one thing that gives it away, a line of
      // Prisma's. The unit tier holds the script's half with a canned copy of
      // that line; this holds PRISMA's half — that 7.10.0, and whatever
      // version follows it, still says it in the words the script looks for.
      const direct = assertTestDatabaseUrl(
        process.env.POSTGRES_URL_NON_POOLING,
        "POSTGRES_URL_NON_POOLING",
      );

      // A name nothing has created: the tier's own, a suffix unique to this
      // process and this moment, and `_test` last so the guard still passes.
      const own = decodeURIComponent(new URL(direct).pathname.slice(1));
      const stray = `${own.replace(/_test$/, "")}_stray_${process.pid}_${Date.now()}_test`;
      // It is about to be interpolated into DDL, so it is held to an
      // identifier's alphabet first. (PostgreSQL would cut a longer name short
      // and the `DROP` below would then name a different database.)
      expect(stray).toMatch(/^[A-Za-z0-9_]{1,63}$/);
      const strayUrl = new URL(direct);
      strayUrl.pathname = `/${stray}`;
      const strayDirect = assertTestDatabaseUrl(strayUrl.toString(), "the stray database's URL");

      // One connection, to the tier's own database: the before and after of
      // `pg_database`, and the `DROP`, which cannot run from inside the
      // database it drops.
      const client = new pg.Client({ connectionString: direct });
      await client.connect();
      const exists = async (): Promise<boolean> => {
        const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
          stray,
        ]);
        return rowCount === 1;
      };

      try {
        expect(await exists(), `${stray} exists before the run`).toBe(false);

        const { status, output, summary } = migrate(strayDirect, "stray-summary.md");

        // Prisma's wording, off the real thing. If this line changes, the
        // script's match has to change with it — that is what this case is for.
        expect(output).toContain(`PostgreSQL database ${stray} created at `);
        // …and it did what it said: this is a database now.
        expect(await exists(), `${stray} exists after the run`).toBe(true);
        // Prisma itself was satisfied, which is the whole problem.
        expect(output).toContain("All migrations have been successfully applied.");

        // The script was not.
        expect(output).toContain(`Prisma CREATED the database '${stray}'`);
        expect(output).toContain("the database the previews read was NOT migrated");
        expect(status).toBe(1);
        expect(output).not.toContain("prisma migrate deploy exited 0");
        expect(summary).toBeNull();

        publishesNoCredentials(strayDirect, output);
      } finally {
        // Whatever happened above. Nothing is connected to it: Prisma has
        // exited, and this client is on the tier's own database.
        await client.query(`DROP DATABASE IF EXISTS "${stray}"`);
        const gone = !(await exists());
        await client.end();
        expect(gone, `${stray} was dropped`).toBe(true);
      }
    },
  );
});
