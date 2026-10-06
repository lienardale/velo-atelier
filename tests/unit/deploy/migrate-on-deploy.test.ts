/**
 * Migrations must run on every **production** deploy, and on no other one.
 *
 * Adapted from bd-platform, where this exact wiring was missing and the site
 * went down: the dashboard build command was `prisma generate && next build`,
 * so migrations never reached production, and the deployed client selected
 * columns that did not exist (P2022). The fix was a `vercel-build` script;
 * this test is what stops the fix from being reverted by a tidy-up.
 *
 * The other half matters just as much here: preview deployments share a single
 * Neon `preview` branch, so a preview that migrated would rewrite the schema
 * under every other open PR. Which left nobody migrating it at all
 * (`.debug/016` §3) — so the second half of this file is about the one writer
 * that now does, `scripts/ci/migrate-preview.sh`.
 *
 * Everything is read off disk, or run against a fake environment — no Vercel,
 * no Neon, no network. The migrate script is EXECUTED rather than grepped: its
 * job is to refuse, and only running it proves it refuses — provided the test
 * can tell a refusal from a warning followed by the migration, which the first
 * version of the second half could not (its header says how).
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- every call site passes a literal repo path
  return readFileSync(join(root, relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

const pkg = readJson<{ scripts: Record<string, string> }>("package.json");
const vercel = readJson<{ buildCommand?: string; regions?: string[] }>("vercel.json");
const vercelBuild = read("scripts/vercel-build.sh");

/**
 * Where each step of `scripts/vercel-build.sh` sits, anchored on the line that
 * IS the command — never on a string that merely mentions it.
 *
 * The script explains itself at length, and its comments and `echo`s name
 * every command it runs: `npm run build` appears in a comment near the top,
 * long before the build, and `prisma migrate deploy` in the `echo` above the
 * migration. An
 * `indexOf` of the name therefore finds the PROSE first, and an ordering test
 * built on it either goes red for a comment or — worse — stays green with the
 * command itself gone. (That is how the hooks-guard test below once passed
 * with its guard replaced; found in review, 2026-09-30.) Leading whitespace is
 * loose because shfmt owns it; -1 when the command is not there at all.
 */
const at = {
  /** `production | preview | development)` — the VERCEL_ENV guard's accepting arm. */
  vercelEnvGuard: vercelBuild.search(/^\s*production\s*\|\s*preview\s*\|\s*development\)/m),
  /** `1 | true | yes)` — the hooks guard's refusing arm. */
  hooksGuard: vercelBuild.search(/^\s*1\s*\|\s*true\s*\|\s*yes\)/m),
  preflight: vercelBuild.search(/^[ \t]*npx tsx scripts\/check-env\.ts$/m),
  migrate: vercelBuild.search(/^[ \t]*npx prisma migrate deploy$/m),
  build: vercelBuild.search(/^[ \t]*npm run build$/m),
  /** The whole line, to its end: `… || true` after it is not this command. */
  bundleGuard: vercelBuild.search(/^[ \t]*npx tsx scripts\/bundle-guard\.ts$/m),
};

describe("deploy: migrations on production deploys only", () => {
  it("vercel.json routes the build through the vercel-build script", () => {
    // vercel.json overrides the dashboard Build Command, so the migrate-enabled
    // script cannot be silently bypassed from the UI.
    expect(vercel.buildCommand).toBe("npm run vercel-build");
  });

  it("the vercel-build script exists and calls scripts/vercel-build.sh", () => {
    expect(pkg.scripts["vercel-build"]).toContain("scripts/vercel-build.sh");
  });

  it("applies migrations before building", () => {
    expect(at.migrate).toBeGreaterThan(-1);
    expect(at.build).toBeGreaterThan(-1);
    expect(at.migrate).toBeLessThan(at.build);
  });

  it("gates migrate on VERCEL_ENV=production", () => {
    // The `if` that OWNS the command — the block whose body runs it — and not
    // any line that happens to hold both words: the `echo` just above the
    // migration says "(VERCEL_ENV=production)" too, and would satisfy a looser
    // pattern with the condition itself gone. The behaviour (production
    // migrates; preview and development never do) is executed in
    // `vercel-build-guard.test.ts`; this keeps the wiring legible on disk.
    const above = vercelBuild.slice(0, at.migrate).split("\n");
    const owner = above.findLast((line) => line.startsWith("if "));
    expect(owner).toMatch(/^if \[ "\$\{VERCEL_ENV(?::-)?\}" = "production" \]; then$/);
    // …and the command is still inside that `if`: no branch closes or turns
    // between the two. (The last element is dropped: it is the indentation in
    // front of the command itself.)
    const inside = above.slice(above.lastIndexOf(owner ?? "") + 1, -1);
    expect(inside.filter((line) => /^(?:else|elif|fi)\b/.test(line))).toEqual([]);
  });

  it("refuses to run without a known VERCEL_ENV, before every other step", () => {
    // Every guard below keys off VERCEL_ENV, and the migrate gate with them:
    // without the variable the flag refusals fail OPEN and production stops
    // migrating, all at once and without an error. So the check for it is
    // the first thing the script does.
    expect(at.vercelEnvGuard).toBeGreaterThan(-1);
    expect(at.vercelEnvGuard).toBeLessThan(at.hooksGuard);
  });

  it("refuses the test hooks before it migrates anything", () => {
    // W5: the hooks flag is inlined at build time and `register()` does not run
    // during a build, so nothing after the compile can take `window.__va` back
    // out — and the refusal has to fire before `migrate deploy` touches the
    // shared preview branch. `tests/unit/deploy/vercel-build-guard.test.ts`
    // executes the script and proves the behaviour; this only keeps the ORDER
    // from drifting.
    expect(at.hooksGuard).toBeGreaterThan(-1);
    expect(at.hooksGuard).toBeLessThan(at.migrate);
  });

  it("checks the environment contract after the hooks guard and before it migrates", () => {
    // `scripts/check-env.ts` is what makes a wrong Production scope a failed
    // BUILD rather than a live deployment answering 500. After the migration
    // it would be too late for the first half of that sentence; before the
    // hooks guard it would take over that guard's message (and
    // `vercel-build-guard.test.ts`'s empty-log assertions would stop meaning
    // "nothing ran").
    expect(at.preflight).toBeGreaterThan(-1);
    expect(at.hooksGuard).toBeLessThan(at.preflight);
    expect(at.preflight).toBeLessThan(at.migrate);
  });

  it("keeps the contract preflight out of every build that is not Vercel's", () => {
    // `lib/env.ts`'s header promises that a build needs no database and no
    // production secret, and CI builds exactly that way. Only the Vercel entry
    // point has a scope to check: `npm run build` and `scripts/ci/build.sh`
    // must never grow the preflight.
    expect(pkg.scripts.build).not.toContain("check-env");
    expect(read("scripts/ci/build.sh")).not.toMatch(/^[^#\n]*check-env/m);
  });

  it("runs the bundle guard after the build, and lets it fail the deployment", () => {
    // The guard reads the build's OUTPUT (no `window.__va`, no runtime
    // evaluator in what ships), so it can only run after `npm run build`, and
    // under `set -e` its exit code is the deployment's. Nothing held that
    // second half: `bundle-guard-deployment.test.ts` proves the script exits
    // 1, and `vercel-build-guard.test.ts` stubs `npx` to answer 0 for it and
    // only checks it was invoked — so `npx tsx scripts/bundle-guard.ts || true`
    // left every test in this folder green (measured in review, 2026-10-06),
    // where the same edit on the migrate and build lines was caught. Anchored
    // to the END of the line, like those two.
    expect(at.bundleGuard).toBeGreaterThan(-1);
    expect(at.bundleGuard).toBeGreaterThan(at.build);
  });

  it("aborts the build if the migration fails", () => {
    // Without `set -e`, a failed `migrate deploy` would be followed by a
    // successful build — which is precisely the outage being guarded against.
    expect(vercelBuild).toMatch(/set -euo pipefail/);
  });

  it("deploys to the Paris region", () => {
    expect(vercel.regions).toEqual(["cdg1"]);
  });
});

describe("deploy: the generated client is always in step with the schema", () => {
  it("regenerates the client on install", () => {
    // `lib/generated/**` is gitignored, so a fresh `npm ci` (Vercel, CI, a new
    // clone) has no client at all until this hook runs.
    expect(pkg.scripts.postinstall).toContain("prisma generate");
  });

  it("regenerates the client before typechecking", () => {
    // `tsc` against a stale or absent client reports hundreds of phantom
    // errors that have nothing to do with the change under review.
    expect(pkg.scripts.typecheck).toMatch(/^prisma generate\s*&&/);
  });

  it("seeds through tsx, not a compiled artefact", () => {
    expect(pkg.scripts["db:seed"]).toBe("prisma db seed");
    expect(read("prisma.config.ts")).toContain("tsx prisma/seed.ts");
  });
});

/**
 * The other writer: `scripts/ci/migrate-preview.sh`, run by
 * `.github/workflows/migrate-preview.yml`.
 *
 * `spawnSync` with an explicit `env` is the point: the script's whole job is
 * to read the environment GitHub hands it, and a grep for
 * `PREVIEW_MIGRATIONS_ENABLED` would pass against a script that never branched
 * on it.
 *
 * **Every case but one runs with a stand-in `npx` first on `PATH`.** It
 * records its arguments, prints a marker and a canned copy of Prisma's output,
 * and exits with a status the case chooses. Three things follow, and each was
 * missing before (found in review, 2026-10-06):
 *
 * 1. *A refusal can be told from a warning.* The ref guard and the pooled
 *    guard were asserted by `status === 1` plus a substring of their own log
 *    line, on a fixture a LATER step also failed: with either guard's `exit 1`
 *    deleted the script went on to `prisma migrate deploy` — from
 *    `refs/heads/w5/some-feature`, watched — and both tests stayed green,
 *    because the pooled guard, or Prisma's P1001, supplied the exit code. Here
 *    nothing downstream fails: the stand-in answers 0, so a guard that only
 *    warns ends in a green "migration", and `nothingMigrated()` also reads the
 *    stand-in's own log, which a refusal leaves empty.
 * 2. *The success path runs.* The comment this replaces said "the happy path
 *    is still absent — it needs a Neon branch". It needs an `npx` that exits 0.
 *    What the job writes to `$GITHUB_STEP_SUMMARY` — the most public thing it
 *    writes — ran under no test, and a summary holding the whole connection
 *    string passed all of them. (The real Prisma's green run, against the real
 *    test database, is `tests/integration/migrate-preview.test.ts`.)
 * 3. *A broken guard dials nobody.* One fixture sat on `aws.neon.tech` under
 *    the real preview endpoint's first two words; the day the pooled guard
 *    regressed, every `npm test` would have had Prisma look it up. Every host
 *    below is under `.invalid` (RFC 2606 reserves the TLD: it cannot resolve).
 *
 * The one case that runs the REAL `npx prisma migrate deploy` is there for the
 * opposite reason: what Prisma prints is Prisma's, and a canned copy cannot
 * show that the redaction still matches it.
 *
 * The stand-in has to be seen to run. `_lib.sh` calls `nvm use` when
 * `$HOME/.nvm/nvm.sh` exists, and nvm then PREPENDS its own `bin` — measured
 * with the real `HOME` and a stub-only `PATH`: `npx` resolved to nvm's. So
 * `HOME` is an empty directory, the directory of the node running this test
 * follows the stand-in on `PATH`, and every case that expects it to have run
 * asserts its marker.
 */
describe(
  "deploy: the shared Neon preview branch has exactly one writer",
  // A spawn costs between 15 ms and 0.4 s here and each real Prisma run about
  // 0.6 s, on an idle machine. The unit tier does not run on one: the cap is
  // per test, the largest loop below is eight spawns, and a spawn that hangs
  // is cut off — and reported — by SPAWN_TIMEOUT_MS, which a `spawnSync` needs
  // because Vitest cannot interrupt a synchronous call.
  { timeout: 180_000 },
  () => {
    const SCRIPT = "scripts/ci/migrate-preview.sh";
    const SPAWN_TIMEOUT_MS = 60_000;
    const DISPATCH = "gh workflow run migrate-preview.yml --ref main";

    /** What `NEON_PREVIEW_ENDPOINT` holds: the preview endpoint's name, without its id. */
    const ENDPOINT = "ep-plain-block";

    /**
     * The preview branch's DIRECT URL, on a host that cannot exist, with a
     * password no log may ever contain. Shaped like the real endpoint on
     * purpose: the cut under test is 14 characters, which is `ep-plain-block`.
     */
    const DIRECT_HOST = "ep-plain-block-a1b2c3d4.eu-central-1.aws.neon.invalid";
    const DIRECT_URL = `postgresql://neondb_owner:PASSWORD-MUST-NOT-LEAK@${DIRECT_HOST}/neondb?sslmode=require`;
    /** The same endpoint through Neon's pooler: `-pooler` after the id. */
    const POOLED_URL =
      "postgresql://neondb_owner:PASSWORD-MUST-NOT-LEAK@ep-plain-block-a1b2c3d4-pooler.eu-central-1.aws.neon.invalid/neondb";
    /**
     * A DIRECT URL shaped like production's (`.debug/016` §3 publishes both
     * names): same project, same role, same database — another endpoint.
     */
    const PRODUCTION_SHAPED_URL =
      "postgresql://neondb_owner:PASSWORD-MUST-NOT-LEAK@ep-quiet-river-z9y8x7w6.eu-central-1.aws.neon.invalid/neondb?sslmode=require";
    /** …and the same endpoint through the pooler: both mistakes in one string. */
    const PRODUCTION_SHAPED_POOLED_URL =
      "postgresql://neondb_owner:PASSWORD-MUST-NOT-LEAK@ep-quiet-river-z9y8x7w6-pooler.eu-central-1.aws.neon.invalid/neondb";

    /** The bootstrap, done: the switch on and the endpoint named. */
    const ARMED = { PREVIEW_MIGRATIONS_ENABLED: "1", NEON_PREVIEW_ENDPOINT: ENDPOINT };
    const ON_MAIN = { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main" };

    const STUB_RAN = "STAND-IN-NPX-RAN";
    const STUB_GOT_THE_URL = "STAND-IN-READ-THE-SECRET-FROM-POSTGRES_URL_NON_POOLING";

    /**
     * What `prisma migrate deploy` prints, canned. The first four lines are
     * the real 7.10.0's, copied from the run the redaction case below makes,
     * with the whole host where Prisma prints it. What follows them is a
     * fixture: it is SHAPED like the report of an applied migration the review
     * recorded on a throwaway local database ("N migrations found…",
     * "Applying migration …", "All migrations have been successfully
     * applied."), and "No pending migrations to apply." is the line the
     * integration tier reads off the real thing.
     */
    const prismaOutput = (...tail: string[]): string =>
      [
        "Loaded Prisma config from prisma.config.ts.",
        "",
        "Prisma schema loaded from prisma/schema.prisma.",
        `Datasource "db": PostgreSQL database "neondb", schema "public" at "${DIRECT_HOST}"`,
        "",
        ...tail,
        "",
      ].join("\n");
    const APPLIED = prismaOutput(
      "3 migrations found in prisma/migrations",
      "",
      "Applying migration `20260930094543_one_open_build_list_per_bike`",
      "",
      "All migrations have been successfully applied.",
    );
    const NOTHING_PENDING = prismaOutput(
      "3 migrations found in prisma/migrations",
      "",
      "No pending migrations to apply.",
    );
    /**
     * A green run into a database that did not exist. This one IS a copy: the
     * unmodified script and the real 7.10.0 against the local test server, the
     * secret's path changed to a name nothing had created (2026-10-06). That
     * run printed `PostgreSQL database velo_atelier_w5stray41_test created at
     * localhost:5432`; the name and the host are replaced by this file's, and
     * the port is dropped because this file's URL names none (Prisma's source
     * prints `host:port` only when there is one). The `created` line is what
     * the script fails on; everything after it is what made the run look like
     * a success.
     */
    const STRAY_DATABASE = "neondbb";
    const CREATED_THE_DATABASE = prismaOutput(
      `PostgreSQL database ${STRAY_DATABASE} created at ${DIRECT_HOST}`,
      "",
      "3 migrations found in prisma/migrations",
      "",
      "Applying migration `20260911071112_init`",
      "Applying migration `20260921090547_checkup_symptoms_done_reason`",
      "Applying migration `20260930094543_one_open_build_list_per_bike`",
      "",
      "The following migration(s) have been applied:",
      "",
      "migrations/",
      "  └─ 20260911071112_init/",
      "    └─ migration.sql",
      "  └─ 20260921090547_checkup_symptoms_done_reason/",
      "    └─ migration.sql",
      "  └─ 20260930094543_one_open_build_list_per_bike/",
      "    └─ migration.sql",
      "",
      "All migrations have been successfully applied.",
    ).replace('database "neondb"', `database "${STRAY_DATABASE}"`);

    let sandbox: string;
    let npxLog: string;
    let summaryFile: string;

    /* eslint-disable security/detect-non-literal-fs-filename -- every path below is built from mkdtemp */
    /** Install the stand-in `npx`: what it prints after its marker, and how it exits. */
    function standIn(output: string, exitCode = 0): void {
      const canned = join(sandbox, "prisma-output.txt");
      writeFileSync(canned, output);
      writeFileSync(
        join(sandbox, "bin", "npx"),
        [
          "#!/bin/sh",
          `printf '%s\\n' "$*" >>"${npxLog}"`,
          `echo "${STUB_RAN}"`,
          // Says so without printing it: the URL holds the password.
          `[ "$POSTGRES_URL_NON_POOLING" = "$NEON_PREVIEW_DIRECT_URL" ] && echo "${STUB_GOT_THE_URL}"`,
          `cat "${canned}"`,
          `exit ${exitCode}`,
          "",
        ].join("\n"),
      );
      chmodSync(join(sandbox, "bin", "npx"), 0o755);
    }

    beforeEach(() => {
      sandbox = mkdtempSync(join(tmpdir(), "velo-migrate-preview-"));
      npxLog = join(sandbox, "npx.log");
      summaryFile = join(sandbox, "summary.md");
      mkdirSync(join(sandbox, "bin"));
      mkdirSync(join(sandbox, "home"));
      // Green by default: a guard that stops refusing gets a "successful
      // migration", not a second failure to hide behind.
      standIn(APPLIED);
    });

    afterEach(() => {
      rmSync(sandbox, { recursive: true, force: true });
    });

    interface Run {
      readonly status: number;
      /** stdout then stderr: both are the public log. */
      readonly output: string;
      /** One line per `npx` invocation the stand-in saw. `""` when none. */
      readonly ran: string;
      /** The job summary the run wrote, or `null` when it wrote none. */
      readonly summary: string | null;
    }

    function run(env: Record<string, string>, { realNpx = false } = {}): Run {
      rmSync(npxLog, { force: true });
      rmSync(summaryFile, { force: true });
      const result = spawnSync("bash", [join(root, SCRIPT)], {
        cwd: root,
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
        // A clean environment, not the runner's: `GITHUB_REF`, the secret and
        // the two variables are exactly what is under test, and inheriting any
        // of them would decide the outcome before the script did. `NODE_ENV`
        // is spelled out because Next augments `NodeJS.ProcessEnv` to require
        // it (lib/env.ts says why), not because the script reads it.
        env: {
          PATH: [
            ...(realNpx ? [] : [join(sandbox, "bin")]),
            // The node running this test, and its own `npx` for the one case
            // that wants the real one.
            dirname(process.execPath),
            process.env.PATH ?? "",
          ].join(":"),
          HOME: join(sandbox, "home"),
          NODE_ENV: process.env.NODE_ENV ?? "test",
          // Prisma's update check, off for the one real run: this environment
          // has no `CI` in it to turn it off (per Prisma's documentation; no
          // request was observed either way).
          CHECKPOINT_DISABLE: "1",
          ...env,
        },
      });
      // A timeout or a missing `bash` is not "exit code -1": say what it was.
      if (result.error) throw result.error;
      return {
        status: result.status ?? -1,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
        ran: existsSync(npxLog) ? readFileSync(npxLog, "utf8") : "",
        summary: existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : null,
      };
    }
    /* eslint-enable security/detect-non-literal-fs-filename */

    /**
     * The script stopped BEFORE the migration — not "it complained and went
     * on". `ran` is the stand-in's own record; the two strings are what the
     * script and Prisma print first when a migration starts.
     */
    function nothingMigrated(result: Run): void {
      expect(result.ran, "npx was invoked").toBe("");
      expect(result.output).not.toContain(STUB_RAN);
      expect(result.output).not.toContain("migrate deploy → ");
      expect(result.output).not.toContain("Datasource");
      expect(result.summary, "a job summary was written").toBeNull();
    }

    /** Nothing of the secret but the 14 characters the log is allowed. */
    function publishesNothing(text: string): void {
      expect(text).not.toContain("PASSWORD-MUST-NOT-LEAK");
      expect(text).not.toContain("a1b2c3d4");
      expect(text).not.toContain("z9y8x7w6");
      expect(text).not.toContain("eu-central-1");
      expect(text).not.toContain("neon.invalid");
      expect(text).not.toContain("postgresql://");
    }

    it("skips, loudly and green, while the secret has never been set", () => {
      // The bootstrap: the maintainer adds the secret only after rotating the
      // preview branch's password, and until then a red `main` would be noise.
      const result = run({});
      expect(result.status).toBe(0);
      expect(result.output).toContain("SKIP");
      expect(result.output).toContain("NEON_PREVIEW_DIRECT_URL");
      nothingMigrated(result);
      // Where it sends the reader. It used to end "migrate it by hand (§1)" —
      // a command with the connection string inline, i.e. in shell history,
      // in the very window in which the string has just been rotated.
      expect(result.output).toContain(DISPATCH);
      expect(result.output).not.toContain("by hand");
    });

    it("fails once the switch says the secret should exist", () => {
      // GitHub hands a step the empty string for a secret that does not exist,
      // so after the bootstrap the skip above would silently return the day the
      // secret was deleted, renamed or scoped away — green, quiet, and drifting,
      // which is the bug this workflow exists to remove.
      const result = run({ PREVIEW_MIGRATIONS_ENABLED: "1" });
      expect(result.status).toBe(1);
      expect(result.output).not.toContain("SKIP");
      expect(result.output).toContain("PREVIEW_MIGRATIONS_ENABLED is 1");
      nothingMigrated(result);
    });

    it("refuses to run from any ref but main", () => {
      // `workflow_dispatch` takes a `--ref`: without this, `gh workflow run
      // migrate-preview.yml --ref <branch>` would apply that branch's unmerged
      // prisma/migrations/** to the database every open PR's preview reads.
      //
      // EVERYTHING else about these runs is in order — a direct URL, the right
      // endpoint, the switch on — so the ref is the only thing that can refuse
      // them. The first version fed this case a POOLED URL, and the pooled
      // guard answered for a ref guard that had stopped exiting.
      //
      // More than one ref, because one was all it took to pass:
      // `!= refs/heads/main*` (a prefix) and `!= *main` both survived a single
      // feature-branch name. A branch that merely starts with `main`, a TAG
      // called `main`, a pull request's merge ref and no ref at all are each
      // not `refs/heads/main`.
      for (const ref of [
        "refs/heads/w5/some-feature",
        "refs/heads/main-backup",
        "refs/heads/main-x",
        "refs/tags/main",
        "refs/pull/14/merge",
        "",
      ]) {
        const result = run({
          GITHUB_ACTIONS: "true",
          GITHUB_REF: ref,
          NEON_PREVIEW_DIRECT_URL: DIRECT_URL,
          ...ARMED,
        });
        expect(result.status, ref).toBe(1);
        expect(result.output, ref).toContain(`from ${ref || "<no ref>"} —`);
        expect(result.output, ref).toContain(DISPATCH);
        nothingMigrated(result);
      }

      // And the control, so "refuses" is not simply what this environment does:
      // the same run from `refs/heads/main` goes through.
      const onMain = run({ ...ON_MAIN, NEON_PREVIEW_DIRECT_URL: DIRECT_URL, ...ARMED });
      expect(onMain.status).toBe(0);
      expect(onMain.output).toContain(STUB_RAN);
    });

    it("refuses a feature ref before it offers the bootstrap's skip", () => {
      // An ORDER, which CLAUDE.md states as a contract and no test held: the
      // ref guard is the first thing the script does. Every run in the case
      // above carries a secret and the switch, so none of them could tell
      // where the guard sits — moved below the empty-secret block it left this
      // whole file green (measured in review, 2026-10-06). Before the
      // bootstrap that move changes the answer: a dispatch on a feature branch
      // is somebody asking for a migration from the wrong ref, and it was
      // answered by the green skip — with silence.
      //
      // No secret and no switch, so the skip is the only other thing this run
      // could do.
      const result = run({ GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/w5/some-feature" });
      expect(result.status).toBe(1);
      expect(result.output).toContain("from refs/heads/w5/some-feature —");
      expect(result.output).not.toContain("SKIP");
      nothingMigrated(result);

      // The control: the same empty environment on `main` IS the skip.
      const onMain = run({ ...ON_MAIN });
      expect(onMain.status).toBe(0);
      expect(onMain.output).toContain("SKIP");
    });

    it("refuses a pooled endpoint instead of attempting the migration", () => {
      // Prisma's advisory migration lock and DDL do not survive a transaction
      // pooler, and the failure mode is a hung or half-applied migration.
      const result = run({ ...ON_MAIN, NEON_PREVIEW_DIRECT_URL: POOLED_URL, ...ARMED });
      expect(result.status).toBe(1);
      expect(result.output).toContain("POOLED");
      nothingMigrated(result);

      // `postgresql:` is not a special scheme, so `new URL()` keeps the host
      // as it was typed: `-POOLER.` used to be read as direct.
      const shouting = run({
        ...ON_MAIN,
        NEON_PREVIEW_DIRECT_URL: POOLED_URL.replace("-pooler.", "-POOLER."),
        ...ARMED,
      });
      expect(shouting.status).toBe(1);
      expect(shouting.output).toContain("POOLED");
      nothingMigrated(shouting);
    });

    it("refuses a value that is not a connection URL, without printing it", () => {
      // The realistic wrong paste: the console's `psql '…'` snippet rather
      // than the bare string. `new URL()` throws on it, and Node's uncaught
      // `ERR_INVALID_URL` prints its WHOLE input — with the probe's handling
      // removed, the log read `input: "psql 'postgresql://…:<password>@…'"`
      // (measured in review). The value used here before carried no password,
      // so nothing could have noticed.
      const result = run({
        NEON_PREVIEW_DIRECT_URL: `psql '${DIRECT_URL}'`,
        ...ARMED,
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("not a connection URL");
      publishesNothing(result.output);
      nothingMigrated(result);
    });

    it("refuses a URL that parses but has no host, before naming anything", () => {
      // `new URL("foo:bar")` succeeds and leaves `hostname` empty, so without an
      // explicit check the log announced `prisma migrate deploy → bar` and only
      // then let Prisma refuse the string (P1013). Fails closed either way; the
      // point is that a public log must not name a database nothing contacted.
      const result = run({ NEON_PREVIEW_DIRECT_URL: "foo:bar", ...ARMED });
      expect(result.status).toBe(1);
      expect(result.output).toContain("not a connection URL with a host");
      nothingMigrated(result);
    });

    it("refuses a host that could smuggle a `sed` metacharacter into the redaction", () => {
      // The redaction that keeps the endpoint out of a public log is a `sed`
      // filter built from the hostname, so the hostname has to be a literal
      // pattern. `[A-Za-z0-9.-]` is; `ab*cdef` is not, and with the charset
      // assertion relaxed the filter silently stops matching and Prisma's own
      // error publishes the whole endpoint.
      //
      // The MESSAGE is the assertion. Since the endpoint check, this host
      // would be refused further down anyway — as "not the preview endpoint",
      // which echoes the start of the host. The generic line is what shows it
      // was the charset rule that stopped it, before anything was echoed.
      const result = run({
        NEON_PREVIEW_DIRECT_URL: "postgresql://u:p@ab*cdefghijklmnop/db",
        ...ARMED,
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("not a connection URL with a host");
      nothingMigrated(result);
    });

    it("refuses a URL whose host is not the one Prisma would dial", () => {
      // A password with an unencoded `@` or `/` moves the URL's authority. The
      // parser then reads a FRAGMENT of the password as the host and the rest
      // of the string as the path, and the first version logged all of it:
      //   prisma migrate deploy → x.invalid/SECRETPART@ep-plain-block-a1b2c3d4.…/neondb
      // followed by Prisma's own `Datasource … database "SECRETPART@ep-plain-…`
      // (measured in review). GitHub's masking matches the whole secret, never
      // a piece of it. Neon's console does not issue such a password; a role
      // altered by hand can have one.
      //
      // Three rules refuse these — exactly one raw `@`, a username, a path that
      // is a bare database name — and each has a fixture that ONLY it refuses
      // (checked by deleting each rule in turn). Every host a regression would
      // look up is under `.invalid`, never a machine called `owner`.
      const realHost = `${DIRECT_HOST}/neondb`;
      const misparsed = {
        // The review's own URL. Two raw `@`, and the path holds one of them.
        "an unencoded @ and / in the password": `postgresql://neondb_owner:abc@x.invalid/SECRETPART@${realHost}`,
        // Two raw `@`, but the path the parser sees is a clean `/db` and there
        // is a username: ONLY the count of `@` refuses this one.
        "the same, hidden behind a ?": `postgresql://u:abc@tailfrag.invalid/db?SECRETPART@${realHost}`,
        // One raw `@`. Digits then a slash read as a port, so the authority
        // has no userinfo and the path carries the rest.
        "a password that starts with digits and a /": `postgresql://owner.invalid:12/SECRETPART@${realHost}`,
        // One raw `@`, a clean path — and no username, because the `@` is in
        // the query: ONLY the username rule refuses this one.
        "the same, with the rest behind a ?": `postgresql://owner.invalid:12/db?SECRETPART@${realHost}`,
        // One raw `@`, a username, the RIGHT host — and more path than a
        // database name. The path is echoed whole in the log line, so ONLY the
        // path rule keeps whatever follows the name out of it.
        "something after the database name": `postgresql://neondb_owner:abc@${realHost}/SECRETPART`,
      };
      for (const [what, url] of Object.entries(misparsed)) {
        const result = run({ ...ON_MAIN, NEON_PREVIEW_DIRECT_URL: url, ...ARMED });
        expect(result.status, what).toBe(1);
        // The generic message, which prints nothing from the value — not the
        // endpoint mismatch, which would name the mis-read host.
        expect(result.output.trim(), what).toMatch(
          /^:: NEON_PREVIEW_DIRECT_URL is not a connection URL with a host$/,
        );
        expect(result.output, what).not.toContain("SECRETPART");
        publishesNothing(result.output);
        nothingMigrated(result);
      }
    });

    it("refuses a `host` query parameter, which Prisma dials instead of the URL's host", () => {
      // Measured on the pinned 7.10.0, both hosts under `.invalid`:
      //   Datasource "db": … at "first-host.invalid"
      //   Error: P1001: Can't reach database server at `second-host.invalid:5432`
      // So with one, the endpoint this script asserts and the endpoint Prisma
      // contacts are two different things — here, the preview name in front
      // and production's shape behind. (`hostaddr`, tried the same way, is
      // ignored by Prisma and is not refused.)
      const result = run({
        ...ON_MAIN,
        NEON_PREVIEW_DIRECT_URL: `${DIRECT_URL}&host=ep-quiet-river-z9y8x7w6.eu-central-1.aws.neon.invalid`,
        ...ARMED,
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("not a connection URL with a host");
      publishesNothing(result.output);
      nothingMigrated(result);
    });

    it("refuses a switch value that is not 1, instead of skipping green", () => {
      // `true`, `yes`, `on` all read as "enabled" to a human and as "unset" to a
      // `== "1"` compare, which would put the bootstrap skip back the day the
      // secret went missing — green and silent, the exact shape being fixed.
      for (const value of ["true", "yes", "on", "TRUE"]) {
        const result = run({ PREVIEW_MIGRATIONS_ENABLED: value });
        expect(result.status, value).toBe(1);
        expect(result.output, value).toContain(`is set to '${value}'`);
        expect(result.output, value).not.toContain("WARNING SKIP");
        nothingMigrated(result);
      }
    });

    it("echoes a mistyped switch only when it is a short word, and its length otherwise", () => {
      // The refusal above printed the variable verbatim, into a public log —
      // the one value in this script that was neither cut nor held to a
      // charset. A repository variable is a field somebody pastes into: with
      // the connection string in it the log read
      //   PREVIEW_MIGRATIONS_ENABLED is set to 'postgresql://u:<password>@…'
      // (measured in review, 2026-10-06). Letters and digits, eight at most,
      // are every typo the message exists for; anything else is described.
      const unshown = [
        // The measured one: the secret, pasted into the wrong field.
        DIRECT_URL,
        // Not a word: a space, a hyphen.
        "true ",
        "enabled-1",
        // A word, and one character too long to be a typo of `1`.
        "123456789",
      ];
      for (const value of unshown) {
        const result = run({ PREVIEW_MIGRATIONS_ENABLED: value });
        expect(result.status, value).toBe(1);
        expect(result.output, value).toContain(
          `PREVIEW_MIGRATIONS_ENABLED is set to a value of ${value.length} characters, not shown here;`,
        );
        expect(result.output, value).not.toContain(value);
        publishesNothing(result.output);
        nothingMigrated(result);
      }

      // The boundary on the other side: eight letters are still shown.
      const shown = run({ PREVIEW_MIGRATIONS_ENABLED: "disabled" });
      expect(shown.status).toBe(1);
      expect(shown.output).toContain("is set to 'disabled'");
    });

    it("reads the switch when the secret IS there, which is when it is typed", () => {
      // The loop above is the only place the switch used to be read: inside
      // the empty-secret branch. But the bootstrap sets the secret and the
      // variable in one sitting, so at the keyboard the secret was never
      // empty — and with it present, `true`, `0` and an unset variable all
      // went on to `migrate deploy`, green, with no line about the switch
      // (measured in review, 2026-10-06). Everything else here is in order.
      for (const value of ["true", "0", "yes"]) {
        const result = run({
          ...ON_MAIN,
          NEON_PREVIEW_DIRECT_URL: DIRECT_URL,
          NEON_PREVIEW_ENDPOINT: ENDPOINT,
          PREVIEW_MIGRATIONS_ENABLED: value,
        });
        expect(result.status, value).toBe(1);
        expect(result.output, value).toContain(`is set to '${value}'`);
        nothingMigrated(result);
      }
    });

    it("refuses a secret whose switch was never set: the grace period is still open", () => {
      // The forgotten variable — or the misspelt variable NAME, which is the
      // same thing from inside the script. It was green: a migration, no
      // warning, and the day the secret disappeared the job went back to the
      // bootstrap skip, which is the one thing the switch exists to prevent.
      const result = run({
        ...ON_MAIN,
        NEON_PREVIEW_DIRECT_URL: DIRECT_URL,
        NEON_PREVIEW_ENDPOINT: ENDPOINT,
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("PREVIEW_MIGRATIONS_ENABLED is not 1");
      expect(result.output).toContain("grace period was never ended");
      expect(result.output).not.toContain("SKIP");
      nothingMigrated(result);
    });

    it("refuses production's endpoint in the preview secret, before contacting it", () => {
      // The P1 of the review. Production is in the same Neon project, one
      // branch selector away in the console, and nothing compared the host
      // with anything: this exact environment printed
      //   prisma migrate deploy → ep-quiet-river…/neondb
      // went on to Prisma, and — against a stand-in that answered 0 — wrote
      // "applied to the Neon `preview` branch (`ep-quiet-river…/neondb`)" to
      // the job summary. Green, labelled preview, with production's DDL
      // credential in a secret whose name says otherwise, and `preview` still
      // drifting behind the tick.
      const result = run({ ...ON_MAIN, NEON_PREVIEW_DIRECT_URL: PRODUCTION_SHAPED_URL, ...ARMED });
      expect(result.status).toBe(1);
      nothingMigrated(result);
      // It says which two names disagree, cut like every other line of this
      // log: the first 14 characters, never the id, never the rest.
      expect(result.output).toContain("ep-quiet-river…");
      expect(result.output).toContain(`NEON_PREVIEW_ENDPOINT says:  ${ENDPOINT}`);
      // The two names differ where the log shows them, so nothing sends the
      // reader past the 14th character (the case after next).
      expect(result.output).not.toContain("14th character");
      // …and it says where the variable's value comes from, which is not the
      // panel the string was copied from.
      expect(result.output).toContain("never from the panel");
      publishesNothing(result.output);

      // In capitals too: the comparison is on the lower-cased host.
      const shouting = run({
        ...ON_MAIN,
        NEON_PREVIEW_DIRECT_URL: PRODUCTION_SHAPED_URL.replace("ep-quiet-river", "EP-QUIET-RIVER"),
        ...ARMED,
      });
      expect(shouting.status).toBe(1);
      nothingMigrated(shouting);
    });

    it("reports the wrong endpoint before the pooled one: the database is the worse mistake", () => {
      // The other ORDER CLAUDE.md states and nothing held. Production's POOLED
      // string in the preview secret is both mistakes at once, and which one
      // the script names decides what the maintainer does next. With the
      // probe's `kind` computed pooled-first this whole file stayed green
      // (measured in review, 2026-10-06), and the log for this very
      // environment became
      //   NEON_PREVIEW_DIRECT_URL is a POOLED Neon endpoint (ep-quiet-river…/neondb)
      //   — migrations need the DIRECT one.
      // i.e. an instruction to go back for production's DIRECT string.
      const result = run({
        ...ON_MAIN,
        NEON_PREVIEW_DIRECT_URL: PRODUCTION_SHAPED_POOLED_URL,
        ...ARMED,
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("is not the preview endpoint");
      expect(result.output).toContain("ep-quiet-river…");
      expect(result.output).not.toContain("POOLED");
      expect(result.output).not.toContain("DIRECT one");
      publishesNothing(result.output);
      nothingMigrated(result);
    });

    it("says where the difference is when the two names come out the same", () => {
      // Both sides of a mismatch are cut to 14 characters, so they can be
      // IDENTICAL under a message that says they disagree: each of these
      // printed `ep-plain-block…` twice and left the reader to guess (measured
      // in review, 2026-10-06). The id cannot be shown — that is the point of
      // the cut — so the message says that the difference is past it.
      const sameCut = [
        // The variable holds the whole direct host; the secret, the pooled
        // string. (With the NAME in the variable this is the pooled refusal:
        // the host continues it with `-`.)
        { variable: DIRECT_HOST, url: POOLED_URL, starts: "ep-plain-block…" },
        // The variable holds the name with its id; the endpoint was recreated
        // under the same two words.
        {
          variable: "ep-plain-block-a1b2c3d4",
          url: DIRECT_URL.replace("a1b2c3d4", "e5f6g7h8"),
          starts: "ep-plain-block…",
        },
        // The same, with the host typed in capitals: the two cuts are compared
        // in lower case, like the hosts, while the log shows it as typed.
        {
          variable: "ep-plain-block-a1b2c3d4",
          url: DIRECT_URL.replace("ep-plain-block-a1b2c3d4", "EP-Plain-Block-E5F6G7H8"),
          starts: "EP-Plain-Block…",
        },
      ];
      for (const { variable, url, starts } of sameCut) {
        const result = run({
          ...ON_MAIN,
          NEON_PREVIEW_DIRECT_URL: url,
          PREVIEW_MIGRATIONS_ENABLED: "1",
          NEON_PREVIEW_ENDPOINT: variable,
        });
        expect(result.status, variable).toBe(1);
        expect(result.output, variable).toContain("is not the preview endpoint");
        expect(result.output, variable).toContain(`the secret's host starts:  ${starts}`);
        expect(result.output, variable).toContain("NEON_PREVIEW_ENDPOINT says:  ep-plain-block…");
        expect(result.output, variable).toContain("the difference is past the 14th character");
        expect(result.output, variable).toContain("-pooler");
        expect(result.output.toLowerCase(), variable).not.toContain("e5f6g7h8");
        publishesNothing(result.output);
        nothingMigrated(result);
      }
    });

    it("refuses to migrate when nothing says which endpoint is preview's", () => {
      // Fails CLOSED: an empty variable is the first version of the script
      // again, and it is also exactly what a misspelt variable name looks like.
      const empty = run({
        ...ON_MAIN,
        NEON_PREVIEW_DIRECT_URL: DIRECT_URL,
        PREVIEW_MIGRATIONS_ENABLED: "1",
      });
      expect(empty.status).toBe(1);
      expect(empty.output).toContain("NEON_PREVIEW_ENDPOINT is empty");
      // Where to read the value: not off the panel the string comes from,
      // where a wrong branch selector would make the two agree.
      expect(empty.output).toContain("docs/deploy.md §4.5 or .debug/016 §3");
      expect(empty.output).toContain("never from the panel");
      nothingMigrated(empty);

      // …and a value that is not a name at all is refused as one, rather than
      // compared: a trailing space, a pasted URL.
      for (const value of ["ep-plain-block ", "https://ep-plain-block", "ep_plain_block"]) {
        const result = run({
          ...ON_MAIN,
          NEON_PREVIEW_DIRECT_URL: DIRECT_URL,
          PREVIEW_MIGRATIONS_ENABLED: "1",
          NEON_PREVIEW_ENDPOINT: value,
        });
        expect(result.status, value).toBe(1);
        expect(result.output, value).toContain("NEON_PREVIEW_ENDPOINT is not an endpoint name");
        nothingMigrated(result);
      }
    });

    it("holds the endpoint to its whole name, not to a prefix both endpoints share", () => {
      // `host.startsWith(variable + "-")` is the rule, and on its own it lets
      // a variable of `ep` match `ep-quiet-river-…` as readily as
      // `ep-plain-block-…`: the assertion would be set, green, and worth
      // nothing. The `-` continuation is only taken from a value shaped
      // `ep-<word>-<word>`.
      for (const [value, url] of [
        ["ep", PRODUCTION_SHAPED_URL],
        ["ep", DIRECT_URL],
        ["ep-plain", DIRECT_URL],
        // A real name, of the other endpoint: the mismatch read from the
        // variable's side. Its id never reaches the log either.
        ["ep-quiet-river-z9y8x7w6", DIRECT_URL],
      ] as const) {
        const result = run({
          ...ON_MAIN,
          NEON_PREVIEW_DIRECT_URL: url,
          PREVIEW_MIGRATIONS_ENABLED: "1",
          NEON_PREVIEW_ENDPOINT: value,
        });
        expect(result.status, value).toBe(1);
        expect(result.output, value).toContain("is not the preview endpoint");
        publishesNothing(result.output);
        nothingMigrated(result);
      }

      // What does match: the name, the name with its id (a whole label), the
      // whole host, and the name in another case.
      for (const value of [ENDPOINT, "ep-plain-block-a1b2c3d4", DIRECT_HOST, "EP-Plain-Block"]) {
        const result = run({
          ...ON_MAIN,
          NEON_PREVIEW_DIRECT_URL: DIRECT_URL,
          PREVIEW_MIGRATIONS_ENABLED: "1",
          NEON_PREVIEW_ENDPOINT: value,
        });
        expect(result.status, value).toBe(0);
        expect(result.output, value).toContain(STUB_RAN);
      }
    });

    it("names the database without publishing the endpoint or the password", () => {
      // This log is public: the repository is, and `$GITHUB_STEP_SUMMARY` more
      // so. The first 14 characters of a Neon host are what tells `preview`
      // from `production` here, which is the whole reason the log names it
      // (`.debug/016` §3 prints exactly that much); the rest only helps a
      // stranger address the host.
      //
      // Scope: this case is refused at the pooled check, so what it pins is the
      // script's OWN log line. What the JOB publishes is the cases below — the
      // distinction the review made, because only one of the two was ever tested.
      const { output } = run({ NEON_PREVIEW_DIRECT_URL: POOLED_URL, ...ARMED });
      expect(output).toContain("ep-plain-block…/neondb");
      publishesNothing(output);
    });

    it("redacts the endpoint out of the real `migrate deploy`'s own output too", () => {
      // The one case that runs the REAL Prisma, and the reason it exists: with
      // the truncation applied to the script's echo alone, the very next line of
      // a real run was Prisma's own
      //   Datasource "db": PostgreSQL database "neondb", schema "public" at "<host>"
      // with the whole endpoint in it, and a P1001 repeated it. The password
      // was never printed by Prisma on any path the review could reach (and
      // this asserts it once more); the full preview endpoint was, which is
      // the identifier that tells `preview` from `production`.
      //
      // The host is under `.invalid`: an immediate NXDOMAIN, nobody contacted.
      const result = run(
        { ...ON_MAIN, NEON_PREVIEW_DIRECT_URL: DIRECT_URL, ...ARMED },
        { realNpx: true },
      );
      // Prisma really ran: the datasource line is printed by Prisma, not by the
      // script — and not by the stand-in, which this run left off `PATH`.
      expect(result.output).not.toContain(STUB_RAN);
      expect(result.output).toContain('Datasource "db"');
      expect(result.output).toContain("P1001");
      expect(result.output).toContain("ep-plain-block…");
      publishesNothing(result.output);
      // The redaction is a pipe, so `pipefail` (set in `_lib.sh`) is load-bearing:
      // without it a failed migration would be reported by the filter's exit code,
      // which is always 0. A quiet green on a failed migration is the whole shape
      // this workflow exists to remove.
      expect(result.status).toBe(1);
      // …and a migration that failed has nothing to summarise.
      expect(result.summary).toBeNull();

      // Prisma prints the host as it was typed, so the filter is built from
      // it as typed while the endpoint comparison lower-cases it. Both have to
      // hold for one URL, and only the real Prisma can show the first.
      const mixed = run(
        {
          ...ON_MAIN,
          NEON_PREVIEW_DIRECT_URL: DIRECT_URL.replace(
            "ep-plain-block-a1b2c3d4",
            "EP-Plain-Block-A1B2C3D4",
          ),
          ...ARMED,
        },
        { realNpx: true },
      );
      expect(mixed.status).toBe(1);
      expect(mixed.output).toContain('Datasource "db"');
      expect(mixed.output).toContain("EP-Plain-Block…");
      expect(mixed.output).not.toContain("A1B2C3D4");
      publishesNothing(mixed.output);
    });

    it("migrates, and publishes no more on success than on failure", () => {
      // The success path, which no test ran: every other case here ends at a
      // refusal or at Prisma's P1001, so the job summary — written on success
      // only, and the most public thing the job writes — was covered by
      // nothing. A summary carrying the full host, or the whole connection
      // string, passed all the tests there were (measured in review).
      const result = run({
        ...ON_MAIN,
        NEON_PREVIEW_DIRECT_URL: DIRECT_URL,
        ...ARMED,
        GITHUB_STEP_SUMMARY: summaryFile,
      });
      expect(result.status).toBe(0);

      // The stand-in ran — or none of this is about this script's `npx` line —
      // and it was handed the secret under the one name Prisma reads.
      expect(result.output).toContain(STUB_RAN);
      expect(result.output).toContain(STUB_GOT_THE_URL);
      // ONE command, this one. `--no-install`: the repository's pinned Prisma
      // or nothing, never a download. And nothing after it: a `db push`, a
      // `migrate reset` or a seed added to the script would be a second line.
      expect(result.ran).toBe("--no-install prisma migrate deploy\n");

      // The log: Prisma's lines, with the host cut wherever it appears — the
      // datasource line, and a bare endpoint id.
      expect(result.output).toContain("migrate deploy → ep-plain-block…/neondb");
      expect(result.output).toContain('at "ep-plain-block…"');
      expect(result.output).toContain("All migrations have been successfully applied.");
      publishesNothing(result.output);

      // The summary: which endpoint, and what Prisma said — its words, not a
      // sentence of the script's.
      expect(result.summary).toContain("exited 0 on `ep-plain-block…/neondb`");
      expect(result.summary).toContain(
        "Applying migration `20260930094543_one_open_build_list_per_bike`",
      );
      expect(result.summary).toContain('at "ep-plain-block…"');
      publishesNothing(result.summary ?? "");
    });

    it("does not say `applied` when nothing was pending", () => {
      // The summary used to be one static sentence — "`prisma migrate deploy`
      // applied to the Neon `preview` branch" — on every green run. Two runs
      // on one database, the first applying two migrations and the second
      // none, wrote byte-identical summaries (`cmp`, in review). The one run
      // where the difference matters is the first after a bootstrap: a
      // migration is expected, and "No pending migrations" is the tell that
      // the secret points at a database that already had it.
      standIn(NOTHING_PENDING);
      const result = run({
        ...ON_MAIN,
        NEON_PREVIEW_DIRECT_URL: DIRECT_URL,
        ...ARMED,
        GITHUB_STEP_SUMMARY: summaryFile,
      });
      expect(result.status).toBe(0);
      expect(result.output).toContain(STUB_RAN);
      expect(result.summary).toContain("No pending migrations to apply.");
      expect(result.summary).not.toMatch(/applied/i);
      expect(result.output).not.toMatch(/applied/i);
      publishesNothing(result.summary ?? "");
    });

    it("fails, after the fact, when Prisma says it CREATED the database", () => {
      // The endpoint is asserted; the database NAME is not, and Prisma does not
      // need it to exist: `migrate deploy` creates a database that is missing
      // and migrates that. So a secret with the right host and one wrong
      // character in its path was a GREEN run — every migration "applied", a
      // summary saying so — with the database the previews read untouched
      // (the fixture's header says what was measured). The script cannot
      // refuse this beforehand without a fourth input naming the database, so
      // it fails afterwards, on Prisma's own line: `preview` never has a
      // database to create.
      //
      // Everything else about this run is in order, and the stand-in answers
      // 0: only that line can make it red.
      standIn(CREATED_THE_DATABASE);
      const result = run({
        ...ON_MAIN,
        NEON_PREVIEW_DIRECT_URL: DIRECT_URL.replace("/neondb?", `/${STRAY_DATABASE}?`),
        ...ARMED,
        GITHUB_STEP_SUMMARY: summaryFile,
      });
      expect(result.output).toContain(STUB_RAN);
      expect(result.ran).toBe("--no-install prisma migrate deploy\n");
      expect(result.status).toBe(1);

      // What happened, and what to do about it.
      expect(result.output).toContain(`Prisma CREATED the database '${STRAY_DATABASE}'`);
      expect(result.output).toContain("the database the previews read was NOT migrated");
      expect(result.output).toContain("Correct the database name in the secret");
      expect(result.output).toContain(`database '${STRAY_DATABASE}' in the Neon console`);
      expect(result.output).toContain(DISPATCH);

      // Prisma's line is still in the log — it is the evidence — with its host
      // cut like every other.
      expect(result.output).toContain(
        `PostgreSQL database ${STRAY_DATABASE} created at ep-plain-block…`,
      );
      publishesNothing(result.output);

      // And the run does not go on to say it succeeded: no closing line, no
      // summary. Only a green run writes one.
      expect(result.output).not.toContain("exited 0");
      expect(result.summary).toBeNull();

      // The control is every green case in this file. Their canned output
      // carries Prisma's datasource line, which also reads `PostgreSQL
      // database "neondb", …` — a match loose enough to take that for a
      // creation would turn all of them red.
    });

    it("stays red through both filters when the migration fails, and summarises nothing", () => {
      // `migrate deploy | sed | tee`: the status that matters is the first
      // one, and `pipefail` is the only thing that reports it. The real-Prisma
      // case above holds that for `sed`; the `tee` that feeds the summary came
      // later, and this is the same assertion with it in the pipe.
      //
      // The canned failure is a server refusing the connection and naming the
      // endpoint by its ID ALONE. Prisma relays a server's text verbatim
      // (`Error: Schema engine error: FATAL: …`, measured in review against a
      // loopback stand-in), and a filter that matched only the full hostname
      // let exactly this line through. Whether Neon's proxy words an error
      // that way was not observed.
      standIn(
        prismaOutput(
          "Error: Schema engine error:",
          "FATAL: endpoint ep-plain-block-a1b2c3d4 is not available",
        ),
        1,
      );
      const result = run({
        ...ON_MAIN,
        NEON_PREVIEW_DIRECT_URL: DIRECT_URL,
        ...ARMED,
        GITHUB_STEP_SUMMARY: summaryFile,
      });
      expect(result.output).toContain(STUB_RAN);
      expect(result.status).toBe(1);
      expect(result.output).toContain("FATAL: endpoint ep-plain-block… is not available");
      publishesNothing(result.output);
      expect(result.output).not.toContain("exited 0");
      expect(result.summary).toBeNull();
    });

    it("never seeds, and never runs anything but `migrate deploy`", () => {
      // Nothing outside the repository's own local scripts writes ROWS into a
      // Neon branch: `prisma/seed.ts` refuses a non-local host without
      // `ALLOW_REMOTE_SEED` (lib/db/guard.ts), and this script must never be the
      // place that sets it.
      // Comments stripped: the header says "never `migrate dev`, never a seed",
      // and an assertion that a comment can satisfy asserts nothing.
      const code = read(SCRIPT)
        .split("\n")
        .filter((line) => !/^\s*#/.test(line));
      expect(code.join("\n")).not.toContain("migrate dev");
      expect(code.join("\n")).not.toContain("db seed");
      expect(code.join("\n")).not.toContain("ALLOW_REMOTE_SEED");
      // That was the whole test, and its title claimed more: three forbidden
      // strings, which `prisma db push --accept-data-loss` and `prisma migrate
      // reset --force` both passed (measured in review). So, as well as the
      // deny-list: every line that STARTS a package runner, and there is one.
      // (The success case above holds the same thing by execution — the
      // stand-in records a single invocation — but only for a command placed
      // where a green run reaches it.)
      const runners = code
        .map((line) => line.trim())
        .filter((line) => /^(?:npx|npm|prisma)\b/.test(line));
      expect(runners).toHaveLength(1);
      expect(runners[0]).toMatch(/^npx --no-install prisma migrate deploy 2>&1 \| /);
    });
  },
);
