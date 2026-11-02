/**
 * What an allowlist entry BY ID may cover (`audit-ci.json`,
 * `audit-ci-allowlist.md`).
 *
 * An id entry accepts the advisory on every copy of the package, wherever it
 * sits, so a production copy arriving later — a new `dependencies` entry that
 * pulls the same package in — would pass `audit` in silence. The allowlist's
 * rule is that an entry covers only what is out of the deployed application,
 * and the zod entries are written as dependency PATHS for exactly that reason
 * (the shipped `zod` carries the same id). A path entry is not always
 * possible: audit-ci's path for `minimatch` changes between runs of one tree
 * (ESLint's dependency cycles; "Five advisories of 2026-10-27 to 30"), so that
 * one is an id.
 *
 * This holds every id entry to its stated scope, offline, on the lockfile:
 *
 *   - every id in the array is named below, with its package and the scope
 *     its section argues — an id cannot be added without saying what it
 *     covers;
 *   - every lockfile copy of that package carries that scope: `dev`, or, for
 *     the Prisma CLI chain, `devOptional` (the production `@prisma/client`
 *     declares an optional peer on `prisma`; the allowlist's "Prisma CLI
 *     chain" section says why the bundle, not the flag, is the argument there);
 *   - the package is still in the tree — an entry whose package has left it is
 *     dead, and `show-not-found: false` keeps audit-ci quiet about that.
 *
 * Path entries (`GHSA-…|a>b>c`) are audit-ci's own business: it compares them
 * with the path it computes, and a shipped copy has a different path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string): unknown => JSON.parse(readFileSync(join(root, file), "utf8"));

type Scope = "dev" | "devOptional";

/** Every advisory the array accepts BY ID: the package it is on and the scope argued for it. */
const ID_ENTRIES: Readonly<Record<string, { pkg: string; scope: Scope }>> = {
  "GHSA-ggr8-5vv4-36mx": { pkg: "deepmerge-ts", scope: "devOptional" },
  "GHSA-jmr9-qjv8-65gv": { pkg: "extract-zip", scope: "dev" },
  "GHSA-7pqw-9j4j-h8q3": { pkg: "extract-zip", scope: "dev" },
  "GHSA-g3hv-75wg-m249": { pkg: "minimatch", scope: "dev" },
};

const allowlist = (read("audit-ci.json") as { allowlist: string[] }).allowlist;
const lockPackages = (
  read("package-lock.json") as {
    packages: Record<string, { version?: string; dev?: boolean; devOptional?: boolean }>;
  }
).packages;

/** Every lockfile node of `pkg`, by its install path. */
function copiesOf(pkg: string): Array<[string, { dev?: boolean; devOptional?: boolean }]> {
  return Object.entries(lockPackages).filter(
    ([installPath]) =>
      installPath === `node_modules/${pkg}` || installPath.endsWith(`/node_modules/${pkg}`),
  );
}

const idEntries = allowlist.filter((entry) => !entry.includes("|"));

describe("audit-ci.json entries by id", () => {
  it("names every id entry here, with its package and scope", () => {
    expect([...idEntries].sort()).toEqual(Object.keys(ID_ENTRIES).sort());
  });

  it.each(Object.entries(ID_ENTRIES))(
    "%s: every copy of its package is out of the production tree",
    (_id, { pkg, scope }) => {
      const copies = copiesOf(pkg);
      expect(
        copies.length,
        `${pkg} is no longer in the lockfile: remove the entry`,
      ).toBeGreaterThan(0);
      for (const [installPath, node] of copies) {
        const actual =
          node.dev === true ? "dev" : node.devOptional === true ? "devOptional" : "production";
        expect(actual, `${installPath}`).toBe(scope);
      }
    },
  );
});
