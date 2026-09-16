#!/usr/bin/env tsx
/**
 * Content gate — validates every guide under `content/guides/` (§5.1).
 *
 *   npx tsx scripts/content-check.ts            # default (structural) rules
 *   npx tsx scripts/content-check.ts --strict   # + the corpus rules (W2-T4 on, CI)
 *   npx tsx scripts/content-check.ts --emit     # + regenerate lib/content/generated/*
 *   npx tsx scripts/content-check.ts --root <dir>
 *
 * Prints one `file:line: message` per problem and exits 1 when there is any.
 * Runs first in `npm run build`, in `scripts/ci/content.sh` and in lint-staged
 * (which appends staged file paths: extra positional arguments are ignored,
 * the whole corpus is always checked — a rename in one file can break
 * another).
 *
 * `--emit` writes the gitignored `lib/content/generated/{version,slugs,reason-keys}.ts`
 * (`npm run content:build`), and only when the check passed: a broken corpus
 * never produces a manifest.
 *
 * The rules live in `lib/content/check.ts`. Plain Node (`tsx`): no
 * `server-only` anywhere in the import graph.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  buildContentManifest,
  formatIssues,
  renderGeneratedModules,
  runContentCheck,
} from "../lib/content/check";

export interface CliResult {
  code: 0 | 1;
  stdout: string;
  stderr: string;
}

/** The whole CLI, as a function of its arguments — `main()` prints the result. */
export function runCli(argv: readonly string[], cwd = process.cwd()): CliResult {
  const valueOf = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const root = path.resolve(cwd, valueOf("--root") ?? ".");
  const strict = argv.includes("--strict");
  const emit = argv.includes("--emit");
  const mode = `content-check${strict ? " --strict" : ""}`;

  const { errors } = runContentCheck(root, { strict });
  if (errors.length > 0) {
    return {
      code: 1,
      stdout: "",
      stderr: `${formatIssues(errors)}\n\n${mode}: ${errors.length} problem(s). See content/README.md.\n`,
    };
  }

  const manifest = buildContentManifest(root);
  if (emit) {
    const outDir = path.join(root, "lib", "content", "generated");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- lib/content/generated under the chosen root
    mkdirSync(outDir, { recursive: true });
    for (const [file, source] of Object.entries(renderGeneratedModules(manifest))) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed file names from renderGeneratedModules, under the repo root
      writeFileSync(path.join(outDir, file), source, "utf8");
    }
  }

  return {
    code: 0,
    stdout:
      `${mode}: ${manifest.slugs.length} guide(s), ${manifest.stepKeys.length} step(s), no problem.` +
      `${emit ? " lib/content/generated/ written." : ""}\n`,
    stderr: "",
  };
}

function main(): void {
  const result = runCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) main();
