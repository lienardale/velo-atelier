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
    const migrateAt = vercelBuild.indexOf("prisma migrate deploy");
    const buildAt = vercelBuild.indexOf("npm run build");
    expect(migrateAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(-1);
    expect(migrateAt).toBeLessThan(buildAt);
  });

  it("gates migrate on VERCEL_ENV=production", () => {
    expect(vercelBuild).toMatch(/VERCEL_ENV.*=.*"?production"?/);
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
