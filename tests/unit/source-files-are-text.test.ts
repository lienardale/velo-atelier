/**
 * Every source file is TEXT to git.
 *
 * One raw control character is enough for git — and GitHub's pull-request view
 * — to show a whole file as "Binary files differ", so a change to it cannot be
 * reviewed from its diff. The W4 integration found five such files, each with a
 * single NUL inside a string literal, and one of them was
 * `lib/auth/safe-callback-url.ts`, the open-redirect guard: a weakened check
 * there would have reached `main` as an unreadable diff. Write the escape
 * (`"\u0000"`) instead; it is the same string at run time.
 *
 * Tab, LF and CR are text. Every other C0 control character is not.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path read here is derived from `import.meta.url` and a directory listing, never from input */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

import { expect, it } from "vitest";

const REPO = new URL("../../", import.meta.url);

/** Where the hand-written sources live, plus the root-level config files. */
const DIRECTORIES = [
  "app",
  "components",
  "content",
  "lib",
  "messages",
  "prisma",
  "scripts",
  "styles",
  "tests",
  "types",
  ".github",
  ".debug",
  "docs",
];
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|ya?ml|css|sql|sh|prisma|toml)$/;
/** Generated or vendored trees: not written by hand, and gitignored. */
const SKIP = /(^|\/)(node_modules|generated|\.content-collections|\.next)(\/|$)/;

function isControl(byte: number): boolean {
  return byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d;
}

function sourceFiles(): string[] {
  const files = readdirSync(REPO, { encoding: "utf8" }).filter(
    (name) => TEXT.test(name) && statSync(new URL(name, REPO)).isFile(),
  );
  for (const directory of DIRECTORIES) {
    const root = new URL(`${directory}/`, REPO);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      const relative = `${directory}/${entry}`;
      if (SKIP.test(relative) || !TEXT.test(relative)) continue;
      if (statSync(new URL(relative, REPO)).isFile()) files.push(relative);
    }
  }
  return files;
}

it("no source file contains a raw control character", () => {
  const files = sourceFiles();
  // The walk itself must not silently find nothing.
  expect(files.length).toBeGreaterThan(500);
  expect(files).toContain("lib/auth/safe-callback-url.ts");

  const offenders = files.flatMap((file) => {
    const bytes = readFileSync(new URL(file, REPO));
    const at = bytes.findIndex(isControl);
    if (at === -1) return [];
    const line = bytes.subarray(0, at).toString("utf8").split("\n").length;
    return [`${file}:${line} (0x${bytes.readUInt8(at).toString(16).padStart(2, "0")})`];
  });

  expect(offenders).toEqual([]);
});
