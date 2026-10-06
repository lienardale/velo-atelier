/**
 * `scripts/vercel-build.sh` refuses a deployment BEFORE it touches the database.
 *
 * Three refusals, in this order, and each one is executed here:
 *
 *   1. `VERCEL_ENV` is not one of Vercel's three values. Every other guard
 *      keys off that variable, so without it they all fail open at once.
 *   2. `NEXT_PUBLIC_TEST_HOOKS` is on. The bundler inlines it and Next does not
 *      run `instrumentation.ts`'s `register()` during a build, so nothing later
 *      can take `window.__va` — a remote control for the 3D viewer — back out
 *      of the JavaScript the deployment serves.
 *   3. `scripts/check-env.ts`: the whole environment contract (`lib/env.ts`),
 *      evaluated at build time. Without it a scope's VALUES are first met by
 *      the deployed server — after the migration, on a deployment that is
 *      already live.
 *
 * The script is executed for real, with `npx` and `npm` replaced by stubs on
 * `PATH` that only record their arguments: nothing migrates, nothing builds,
 * and "it exited 1 BEFORE touching the database" is an assertion rather than a
 * reading of the source. The stubs also make the negative space visible — the
 * log file stays empty, which is the actual requirement.
 *
 * **One command goes THROUGH the stub: `npx tsx scripts/check-env.ts`.** A stub
 * that answered 0 for it would swallow the preflight whole — every case below
 * would stay green with `check-env.ts` deleted, or throwing. So the stub
 * records it like the rest and then hands it to the repository's own `tsx`,
 * and the contract cases (a forbidden flag, a missing `AUTH_URL`) can only pass
 * if the real file ran and really refused.
 *
 * The child's environment is built from nothing, not inherited: `tests/setup.ts`
 * pins `AUTH_URL`, `AUTH_SECRET` and the Google pair into THIS process for the
 * fake-DB tiers, and "production without AUTH_URL" has to mean exactly that.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = process.cwd();
const SCRIPT = "scripts/vercel-build.sh";
/** The repository's own tsx — what `npx tsx` resolves to on Vercel. */
const TSX = join(root, "node_modules/.bin/tsx");

/** The one command the `npx` stub executes instead of swallowing. */
const PREFLIGHT = "tsx scripts/check-env.ts";

let sandbox: string;
let log: string;

/* eslint-disable security/detect-non-literal-fs-filename -- every path below is built from mkdtemp */
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "velo-vercel-build-"));
  log = join(sandbox, "ran.log");
  // `$@` unquoted would lose nothing here, but quoting keeps an argument with
  // a space intact if the script ever grows one.
  const record = (name: string) => `printf '%s %s\\n' "${name}" "$*" >>"${log}"`;
  writeFileSync(join(sandbox, "npm"), `#!/bin/sh\n${record("npm")}\nexit 0\n`);
  writeFileSync(
    join(sandbox, "npx"),
    [
      "#!/bin/sh",
      record("npx"),
      // Recorded first, so the ORDER of the preflight is visible in the log;
      // then the real thing, whose exit code becomes this stub's.
      `if [ "$*" = "${PREFLIGHT}" ]; then exec "${TSX}" scripts/check-env.ts; fi`,
      "exit 0",
      "",
    ].join("\n"),
  );
  for (const name of ["npx", "npm"]) chmodSync(join(sandbox, name), 0o755);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});
/* eslint-enable security/detect-non-literal-fs-filename */

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * What `docs/deploy.md` §2 puts in each Vercel scope. Fixture values: the
 * database is the local Docker one's shape, nothing here is a credential.
 */
const DATABASE = "postgresql://velo:velo@localhost:5432/velo_atelier";
const EVERY_SCOPE = {
  POSTGRES_URL: DATABASE,
  POSTGRES_URL_NON_POOLING: DATABASE,
  AUTH_SECRET: "x".repeat(32),
  AUTH_TRUST_HOST: "true",
  NEXT_PUBLIC_SITE_URL: "https://velo-atelier.example",
} as const;
const PRODUCTION_ONLY = {
  AUTH_URL: "https://velo-atelier.example",
  AUTH_GOOGLE_ID: "google-id",
  AUTH_GOOGLE_SECRET: "google-secret",
} as const;

/** The Production scope, complete. */
const production = (overrides: Environment = {}): Environment => ({
  VERCEL_ENV: "production",
  ...EVERY_SCOPE,
  ...PRODUCTION_ONLY,
  ...overrides,
});
/** The Preview scope, complete: no `AUTH_URL` and no Google pair, by design. */
const preview = (overrides: Environment = {}): Environment => ({
  VERCEL_ENV: "preview",
  ...EVERY_SCOPE,
  ...overrides,
});

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  /** One line per `npx` / `npm` invocation, in order. `""` when nothing ran. */
  readonly ran: string;
}

/** Run the script with EXACTLY this environment (plus the stubbed PATH). */
function run(env: Environment): Run {
  const childEnv = Object.fromEntries(
    Object.entries({
      // The stubs first; the rest of PATH is where `bash`, `tr` and — for the
      // preflight's `#!/usr/bin/env node` — node itself are found.
      PATH: `${sandbox}:${process.env.PATH}`,
      HOME: sandbox,
      // Where tsx keeps its transform cache; absent, it falls back to /tmp.
      TMPDIR: process.env.TMPDIR,
      ...env,
    }).filter(([, value]) => value !== undefined),
    // `as unknown as`: Next augments `NodeJS.ProcessEnv` so `NODE_ENV` is
    // REQUIRED, and a Vercel build shell is not guaranteed to have one.
  ) as unknown as NodeJS.ProcessEnv;

  let status = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync("bash", [SCRIPT], {
      cwd: root,
      env: childEnv,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    status = failure.status ?? -1;
    stdout = failure.stdout ?? "";
    stderr = failure.stderr ?? "";
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `log` is built from mkdtemp
  const ran = existsSync(log) ? readFileSync(log, "utf8") : "";
  return { status, stdout, stderr, ran };
}

const MIGRATE = "npx prisma migrate deploy";
const BUILD = "npm run build";

/**
 * Every case that reaches the preflight starts a real `tsx`: about 0.7 s here,
 * and an unknown multiple of that on a CI runner busy with the rest of the
 * unit tier. Vitest's default 5 s is too close to that to be a fair verdict.
 */
const STARTS_TSX = { timeout: 30_000 };

describe("vercel-build: it only runs as a Vercel deployment", STARTS_TSX, () => {
  it("exits 1 when VERCEL_ENV is unset, before running anything", () => {
    // The whole environment is otherwise complete: the only thing wrong is that
    // nothing says which deployment this is. Run that way, every guard that
    // keys off VERCEL_ENV is off and a production deployment would not migrate.
    const result = run(production({ VERCEL_ENV: undefined }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("VERCEL_ENV is not set");
    // The message has to name the setting that hides it, or it is a riddle.
    expect(result.stderr).toMatch(/System Environment Variables/);
    expect(result.ran).toBe("");
  });

  it("exits 1 when VERCEL_ENV is unset and the hooks flag is on", () => {
    // This exact environment used to build and exit 0 (found in review,
    // 2026-10-06): the hooks guard only fired `if VERCEL_ENV`, so the one flag
    // nothing can take back went through on a build that had lost the variable.
    const result = run(production({ VERCEL_ENV: undefined, NEXT_PUBLIC_TEST_HOOKS: "1" }));

    expect(result.status).toBe(1);
    // Refused for the missing variable, by the guard written for it — not by
    // `set -u` tripping over `${VERCEL_ENV}` further down.
    expect(result.stderr).toContain("VERCEL_ENV is not set");
    expect(result.ran).toBe("");
  });

  it("exits 1 on a value that is not one of Vercel's three", () => {
    // `lib/env.ts` types VERCEL_ENV as the same enum and refuses to boot on
    // anything else; the build says so before it migrates.
    const result = run(production({ VERCEL_ENV: "staging" }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("VERCEL_ENV=staging");
    expect(result.ran).toBe("");
  });
});

describe("vercel-build: the test hooks never reach a deployment", STARTS_TSX, () => {
  it("exits 1 on a preview deployment carrying the flag, before running anything", () => {
    const result = run(preview({ NEXT_PUBLIC_TEST_HOOKS: "1" }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEXT_PUBLIC_TEST_HOOKS");
    // The message has to say what to unset and where, or it is a riddle.
    expect(result.stderr).toMatch(/Environment Variables/);
    // Nothing was migrated and nothing was built: a deployment that must not
    // ship must not rewrite the shared preview branch's schema on the way out.
    expect(result.ran).toBe("");
  });

  it("exits 1 on a production deployment carrying the flag", () => {
    const result = run(production({ NEXT_PUBLIC_TEST_HOOKS: "1" }));

    expect(result.status).toBe(1);
    expect(result.ran).toBe("");
  });

  it.each(["true", "YES", "1"])("reads %s the way lib/env.ts's flag does", (value) => {
    const result = run(preview({ NEXT_PUBLIC_TEST_HOOKS: value }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("window.__va");
  });

  it("fires before the contract preflight, whatever else is wrong", () => {
    // Two violations at once. The preflight would refuse both, but it must
    // never get the chance: the hooks guard is first, says what the flag DOES,
    // and needs nothing installed. An empty log is the proof — the preflight
    // is recorded by the stub before it runs.
    const result = run(production({ NEXT_PUBLIC_TEST_HOOKS: "1", ENABLE_TEST_PAGES: "1" }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("window.__va");
    expect(result.stderr).not.toContain("ENABLE_TEST_PAGES");
    expect(result.ran).toBe("");
  });
});

describe(
  "vercel-build: the environment contract is checked before the database is touched",
  STARTS_TSX,
  () => {
    it("migrates and builds a production deployment that satisfies the contract", () => {
      const result = run(production());

      expect(result.status, result.stderr).toBe(0);
      // The real check-env.ts ran, and said so.
      expect(result.stdout).toContain("check-env: environment contract satisfied");
      expect(result.stdout).toContain("VERCEL_ENV=production");
      // Preflight, then migrate, then build, then the bundle guard.
      expect(result.ran.split("\n").filter(Boolean)).toEqual([
        `npx ${PREFLIGHT}`,
        MIGRATE,
        BUILD,
        "npx tsx scripts/bundle-guard.ts",
      ]);
    });

    it("builds a preview deployment without AUTH_URL or the Google pair, and never migrates", () => {
      // The live Preview scope as docs/deploy.md describes it. The preflight
      // must not turn "previews have no Google credentials" into a failed build.
      const result = run(preview());

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("check-env: environment contract satisfied");
      expect(result.ran.split("\n").filter(Boolean)).toEqual([
        `npx ${PREFLIGHT}`,
        BUILD,
        "npx tsx scripts/bundle-guard.ts",
      ]);
    });

    it("never migrates a development deployment either", () => {
      // The third value VERCEL_ENV can hold. Migrations are for production alone.
      const result = run(preview({ VERCEL_ENV: "development" }));

      expect(result.status, result.stderr).toBe(0);
      expect(result.ran).toContain(BUILD);
      expect(result.ran).not.toContain("migrate deploy");
    });

    it("exits 1 on a production deployment carrying ENABLE_TEST_PAGES, before it migrates", () => {
      const result = run(production({ ENABLE_TEST_PAGES: "1" }));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("ENABLE_TEST_PAGES must never be set on a deployment");
      // The scope to fix, and where.
      expect(result.stderr).toContain("VERCEL_ENV=production");
      expect(result.stderr).toMatch(/Environment Variables/);
      // The preflight is the ONLY thing that ran: no migration, no build.
      expect(result.ran).toBe(`npx ${PREFLIGHT}\n`);
      // The list is complete here, so nothing warns that it might not be.
      expect(result.stderr).not.toContain("may name more");
    });

    it("says so when a missing variable hides the rules that were not evaluated", () => {
      // zod stops before the cross-field rules when a variable is MISSING: with
      // AUTH_SECRET absent, the forbidden flag beside it is not listed at all.
      // An operator who fixes the one named variable then meets a second failed
      // build — which is expected, and the first log has to have said so.
      const result = run(production({ AUTH_SECRET: undefined, ENABLE_TEST_PAGES: "1" }));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("AUTH_SECRET");
      expect(result.stderr).toContain("may name more");
      expect(result.ran).toBe(`npx ${PREFLIGHT}\n`);
    });

    it("says so when a value outside an enum hides them too", () => {
      // The other way zod stops early, and it is worded differently: a
      // NODE_ENV that is none of development / test / production is an
      // "Invalid option", not an "Invalid input". Measured 2026-10-06 with
      // this exact environment: the only issue listed is NODE_ENV, the flag
      // beside it is not named — and the hint, which matched "Invalid input"
      // alone, was not printed either. (An unknown VERCEL_ENV is worded the
      // same way; step 1 refuses it before the preflight runs.)
      const result = run(production({ NODE_ENV: "staging", ENABLE_TEST_PAGES: "1" }));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("NODE_ENV");
      expect(result.stderr).toContain("may name more");
      expect(result.ran).toBe(`npx ${PREFLIGHT}\n`);
    });

    it("exits 1 on a production deployment without AUTH_URL, naming it", () => {
      const result = run(production({ AUTH_URL: undefined }));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("AUTH_URL is required in production");
      expect(result.ran).toBe(`npx ${PREFLIGHT}\n`);
    });

    it("exits 1 on a preview deployment carrying NEXT_PUBLIC_DEMO_LOGIN, without building", () => {
      // A preview URL is public: the flags are refused there too, and the build
      // is where that is now found out.
      const result = run(preview({ NEXT_PUBLIC_DEMO_LOGIN: "1" }));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("NEXT_PUBLIC_DEMO_LOGIN");
      expect(result.ran).toBe(`npx ${PREFLIGHT}\n`);
    });

    it("never prints a value when it refuses", () => {
      // The build log is read by more people than the dashboard is. A secret
      // that is too short must be named, not quoted.
      const marker = "leak-canary-0123";
      const result = run(production({ AUTH_SECRET: marker }));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("AUTH_SECRET");
      expect(result.stdout + result.stderr).not.toContain(marker);
    });
  },
);
