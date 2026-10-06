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
 * under every other open PR.
 *
 * Everything is read off disk — no Vercel, no network.
 */

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
