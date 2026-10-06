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
 * job is to refuse, and only running it proves it refuses.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
 * Most cases below are ones the script must REFUSE (or skip), so they never
 * reach `prisma migrate deploy`. Exactly one does reach it, deliberately: a
 * review found that every assertion about what this job PUBLISHES was being
 * made on a run that stopped at a refusal, so the script's own truncated log
 * line was pinned while `migrate deploy`'s output — which printed the whole
 * host on the next line — was not. That case points Prisma at a `.invalid`
 * host (RFC 2606 reserves the TLD, so it cannot resolve): no database, nothing
 * contacted, under a second, and both of Prisma's host-bearing lines produced.
 *
 * The happy path is still absent — it needs a Neon branch.
 *
 * `spawnSync` with an explicit `env` is the point: the script's whole job is
 * to read the environment GitHub hands it, and a grep for `PREVIEW_MIGRATIONS_ENABLED`
 * would pass against a script that never branched on it.
 */
describe("deploy: the shared Neon preview branch has exactly one writer", () => {
  const SCRIPT = "scripts/ci/migrate-preview.sh";

  /** A pooled preview URL, with a password no log may ever contain. */
  const POOLED_URL =
    "postgresql://neondb_owner:PASSWORD-MUST-NOT-LEAK@ep-plain-block-a1b2c3d4-pooler.eu-central-1.aws.neon.tech/neondb";

  /**
   * The same preview URL, DIRECT, on a host that cannot exist: RFC 2606
   * reserves `.invalid`, so it is an immediate NXDOMAIN rather than a packet
   * sent to anybody. Shaped like the real endpoint on purpose — the truncation
   * under test cuts at 14 characters, which is `ep-plain-block`.
   */
  const UNREACHABLE_DIRECT_URL =
    "postgresql://neondb_owner:PASSWORD-MUST-NOT-LEAK@ep-plain-block-a1b2c3d4.eu-central-1.aws.neon.invalid/neondb?sslmode=require";

  function run(env: Record<string, string>): { status: number; output: string } {
    const result = spawnSync("bash", [join(root, SCRIPT)], {
      cwd: root,
      encoding: "utf8",
      // A clean environment, not the runner's: `GITHUB_REF` and the secret are
      // exactly what is under test, and inheriting either would decide the
      // outcome before the script did. `NODE_ENV` is spelled out because Next
      // augments `NodeJS.ProcessEnv` to require it (lib/env.ts says why), not
      // because the script reads it; `PATH` and `HOME` are what `_lib.sh`
      // needs to find node and nvm.
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: process.env.NODE_ENV ?? "test",
        ...env,
      },
    });
    return { status: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  }

  it("skips, loudly and green, while the secret has never been set", () => {
    // The bootstrap: the maintainer adds the secret only after rotating the
    // preview branch's password, and until then a red `main` would be noise.
    const { status, output } = run({});
    expect(status).toBe(0);
    expect(output).toContain("SKIP");
    expect(output).toContain("NEON_PREVIEW_DIRECT_URL");
  });

  it("fails once the switch says the secret should exist", () => {
    // GitHub hands a step the empty string for a secret that does not exist,
    // so after the bootstrap the skip above would silently return the day the
    // secret was deleted, renamed or scoped away — green, quiet, and drifting,
    // which is the bug this workflow exists to remove.
    const { status, output } = run({ PREVIEW_MIGRATIONS_ENABLED: "1" });
    expect(status).toBe(1);
    expect(output).not.toContain("SKIP");
    expect(output).toContain("PREVIEW_MIGRATIONS_ENABLED is 1");
  });

  it("refuses to run from any ref but main", () => {
    // `workflow_dispatch` takes a `--ref`: without this, `gh workflow run
    // migrate-preview.yml --ref <branch>` would apply that branch's unmerged
    // prisma/migrations/** to the database every open PR's preview reads.
    const { status, output } = run({
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/heads/w5/some-feature",
      NEON_PREVIEW_DIRECT_URL: POOLED_URL,
      PREVIEW_MIGRATIONS_ENABLED: "1",
    });
    expect(status).toBe(1);
    expect(output).toContain("refs/heads/w5/some-feature");
    expect(output).toContain("--ref main");
  });

  it("refuses a pooled endpoint instead of attempting the migration", () => {
    // Prisma's advisory migration lock and DDL do not survive a transaction
    // pooler, and the failure mode is a hung or half-applied migration.
    const { status, output } = run({
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/heads/main",
      NEON_PREVIEW_DIRECT_URL: POOLED_URL,
      PREVIEW_MIGRATIONS_ENABLED: "1",
    });
    expect(status).toBe(1);
    expect(output).toContain("POOLED");
  });

  it("refuses a value that is not a connection URL", () => {
    const { status, output } = run({
      NEON_PREVIEW_DIRECT_URL: "paste-the-string-here",
      PREVIEW_MIGRATIONS_ENABLED: "1",
    });
    expect(status).toBe(1);
    expect(output).toContain("not a connection URL");
  });

  it("refuses a URL that parses but has no host, before naming anything", () => {
    // `new URL("foo:bar")` succeeds and leaves `hostname` empty, so without an
    // explicit check the log announced `prisma migrate deploy → bar` and only
    // then let Prisma refuse the string (P1013). Fails closed either way; the
    // point is that a public log must not name a database nothing contacted.
    const { status, output } = run({
      NEON_PREVIEW_DIRECT_URL: "foo:bar",
      PREVIEW_MIGRATIONS_ENABLED: "1",
    });
    expect(status).toBe(1);
    expect(output).toContain("not a connection URL with a host");
    expect(output).not.toContain("migrate deploy → ");
  });

  it("refuses a host that could smuggle a `sed` metacharacter into the redaction", () => {
    // The redaction that keeps the endpoint out of a public log is a `sed`
    // filter built from the hostname, so the hostname has to be a literal
    // pattern. `[A-Za-z0-9.-]` is; `ab*cdef` is not, and with the charset
    // assertion relaxed the filter silently stops matching and Prisma's own
    // error publishes the whole endpoint. This is the only test that notices.
    const { status, output } = run({
      NEON_PREVIEW_DIRECT_URL: "postgresql://u:p@ab*cdefghijklmnop/db",
      PREVIEW_MIGRATIONS_ENABLED: "1",
    });
    expect(status).toBe(1);
    expect(output).toContain("not a connection URL with a host");
    expect(output).not.toContain("migrate deploy → ");
  });

  it("refuses a switch value that is not 1, instead of skipping green", () => {
    // `true`, `yes`, `on` all read as "enabled" to a human and as "unset" to a
    // `== "1"` compare, which would put the bootstrap skip back the day the
    // secret went missing — green and silent, the exact shape being fixed.
    for (const value of ["true", "yes", "on", "TRUE"]) {
      const { status, output } = run({ PREVIEW_MIGRATIONS_ENABLED: value });
      expect(status).toBe(1);
      expect(output).toContain(`is set to '${value}'`);
      expect(output).not.toContain("WARNING SKIP");
    }
  });

  it("names the database without publishing the endpoint or the password", () => {
    // This log is public: the repository is, and `$GITHUB_STEP_SUMMARY` more
    // so. Two words of a Neon endpoint tell `preview` from `production`, which
    // is the whole reason the log names it (`.debug/016` §3 prints exactly
    // that much); the rest only helps a stranger address the host.
    //
    // Scope: this case is refused at the pooled check, so what it pins is the
    // script's OWN log line. What the JOB publishes is the case below — the
    // distinction the review made, because only one of the two was ever tested.
    const { output } = run({
      NEON_PREVIEW_DIRECT_URL: POOLED_URL,
      PREVIEW_MIGRATIONS_ENABLED: "1",
    });
    expect(output).toContain("ep-plain-block…/neondb");
    expect(output).not.toContain("PASSWORD-MUST-NOT-LEAK");
    expect(output).not.toContain("a1b2c3d4");
    expect(output).not.toContain("aws.neon.tech");
  });

  it("redacts the endpoint out of `migrate deploy`'s own output too", () => {
    // The one case that REACHES the migration, and the reason it exists: with
    // the truncation applied to the script's echo alone, the very next line of
    // a real run was Prisma's own
    //   Datasource "db": PostgreSQL database "neondb", schema "public" at "<host>"
    // with the whole endpoint in it, and a P1001 repeated it. Credentials were
    // never leaked (Prisma masks them, and this asserts that too); the full
    // preview endpoint was, which is the identifier that tells `preview` from
    // `production` and the one thing docs/deploy.md §4.5 promises not to print.
    const { status, output } = run({
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/heads/main",
      NEON_PREVIEW_DIRECT_URL: UNREACHABLE_DIRECT_URL,
      PREVIEW_MIGRATIONS_ENABLED: "1",
    });
    // Prisma really ran: the datasource line is printed by Prisma, not by the
    // script, so its presence is what makes the assertions below mean anything.
    expect(output).toContain("Datasource");
    expect(output).toContain("ep-plain-block…");
    expect(output).not.toContain("a1b2c3d4");
    expect(output).not.toContain("neon.invalid");
    expect(output).not.toContain("PASSWORD-MUST-NOT-LEAK");
    // The redaction is a pipe, so `pipefail` (set in `_lib.sh`) is load-bearing:
    // without it a failed migration would be reported by the filter's exit code,
    // which is always 0. A quiet green on a failed migration is the whole shape
    // this workflow exists to remove.
    expect(status).toBe(1);
  }, 30_000);

  it("never seeds, and never runs anything but `migrate deploy`", () => {
    // Nothing outside the repository's own local scripts writes ROWS into a
    // Neon branch: `prisma/seed.ts` refuses a non-local host without
    // `ALLOW_REMOTE_SEED` (lib/db/guard.ts), and this script must never be the
    // place that sets it.
    // Comments stripped: the header says "never `migrate dev`, never a seed",
    // and an assertion that a comment can satisfy asserts nothing.
    const code = read(SCRIPT)
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(code).toContain("prisma migrate deploy");
    expect(code).not.toContain("migrate dev");
    expect(code).not.toContain("db seed");
    expect(code).not.toContain("ALLOW_REMOTE_SEED");
  });
});
