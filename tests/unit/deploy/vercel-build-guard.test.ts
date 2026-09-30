/**
 * `scripts/vercel-build.sh` refuses the one flag a runtime check cannot catch.
 *
 * `NEXT_PUBLIC_TEST_HOOKS` is inlined by the bundler, and Next does not run
 * `instrumentation.ts`'s `register()` during a build — so on Vercel this entry
 * point is the only thing standing between the flag and a deployment that
 * serves `window.__va`, a remote control for the 3D viewer, to every visitor.
 *
 * The script is executed for real, with `npx` and `npm` replaced by stubs on
 * `PATH` that only record their arguments: nothing migrates, nothing builds,
 * and "it exited 1 BEFORE touching the database" is an assertion rather than a
 * reading of the source. The stubs also make the negative space visible — the
 * log file stays empty, which is the actual requirement.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = process.cwd();
const SCRIPT = "scripts/vercel-build.sh";

let sandbox: string;
let log: string;

/* eslint-disable security/detect-non-literal-fs-filename -- every path below is built from mkdtemp */
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "velo-vercel-build-"));
  log = join(sandbox, "ran.log");
  // `$@` unquoted would lose nothing here, but quoting keeps an argument with
  // a space intact if the script ever grows one.
  for (const name of ["npx", "npm"]) {
    const stub = join(sandbox, name);
    writeFileSync(stub, `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >>"${log}"\nexit 0\n`);
    chmodSync(stub, 0o755);
  }
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});
/* eslint-enable security/detect-non-literal-fs-filename */

interface Run {
  readonly status: number;
  readonly stderr: string;
  readonly ran: string;
}

function run(env: Readonly<Record<string, string | undefined>>): Run {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${sandbox}:${process.env.PATH}`,
    // Cleared unless the case asks for them, so a shell that happens to export
    // one (a Vercel CLI session, an earlier export) cannot decide a case.
    VERCEL_ENV: undefined,
    NEXT_PUBLIC_TEST_HOOKS: undefined,
    ...env,
  };
  const childEnv = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as NodeJS.ProcessEnv;

  let status = 0;
  let stderr = "";
  try {
    execFileSync("bash", [SCRIPT], { cwd: root, env: childEnv, encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    status = failure.status ?? -1;
    stderr = failure.stderr ?? "";
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `log` is built from mkdtemp
  const ran = existsSync(log) ? readFileSync(log, "utf8") : "";
  return { status, stderr, ran };
}

describe("vercel-build: the test hooks never reach a deployment", () => {
  it("exits 1 on a preview deployment carrying the flag, before running anything", () => {
    const result = run({ VERCEL_ENV: "preview", NEXT_PUBLIC_TEST_HOOKS: "1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEXT_PUBLIC_TEST_HOOKS");
    // The message has to say what to unset and where, or it is a riddle.
    expect(result.stderr).toMatch(/Environment Variables/);
    // Nothing was migrated and nothing was built: a deployment that must not
    // ship must not rewrite the shared preview branch's schema on the way out.
    expect(result.ran).toBe("");
  });

  it("exits 1 on a production deployment carrying the flag", () => {
    const result = run({ VERCEL_ENV: "production", NEXT_PUBLIC_TEST_HOOKS: "1" });

    expect(result.status).toBe(1);
    expect(result.ran).toBe("");
  });

  it.each(["true", "YES", "1"])("reads %s the way lib/env.ts's flag does", (value) => {
    expect(run({ VERCEL_ENV: "preview", NEXT_PUBLIC_TEST_HOOKS: value }).status).toBe(1);
  });

  it("builds a preview deployment that does not carry the flag, without migrating", () => {
    const result = run({ VERCEL_ENV: "preview" });

    expect(result.status).toBe(0);
    expect(result.ran).toContain("npm run build");
    expect(result.ran).toContain("npx tsx scripts/bundle-guard.ts");
    expect(result.ran).not.toContain("migrate deploy");
  });

  it("migrates and builds a production deployment", () => {
    const result = run({ VERCEL_ENV: "production" });

    expect(result.status).toBe(0);
    expect(result.ran.indexOf("npx prisma migrate deploy")).toBeGreaterThan(-1);
    expect(result.ran.indexOf("npx prisma migrate deploy")).toBeLessThan(
      result.ran.indexOf("npm run build"),
    );
  });

  it("leaves the flag alone when VERCEL_ENV is unset", () => {
    // `ENABLE_TEST_PAGES=1 NEXT_PUBLIC_TEST_HOOKS=1 bash scripts/ci/build.sh`
    // is how the e2e artifact is built. The guard must not reach it.
    const result = run({ NEXT_PUBLIC_TEST_HOOKS: "1" });

    expect(result.status).toBe(0);
    expect(result.ran).toContain("npm run build");
  });
});
