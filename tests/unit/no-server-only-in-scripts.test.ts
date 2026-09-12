/**
 * `server-only` must never be reachable from code that runs outside Next.
 *
 * `import "server-only"` throws unless the module is being bundled for a React
 * Server Component. That is exactly right inside `app/**`, and exactly wrong in
 * `prisma/seed.ts` (run by `tsx`), in `scripts/**` (run by `tsx` in CI and the
 * husky hooks) and in the plain-Node library layers they import — there it
 * turns into a crash at the first `npm run db:seed`, far from the edit that
 * caused it (a helper that started importing a server-only module three
 * imports down).
 *
 * So this test walks the real import graph — static imports, re-exports,
 * `import()` and `require()`, resolving `@/` and relative specifiers the way
 * the TypeScript config does — from every entry point that runs outside Next,
 * and fails naming the full chain if `server-only` is reachable.
 *
 * Entry points: `prisma/seed.ts`, `prisma.config.ts`, every `scripts/**` file,
 * and the layers the plan declares plain Node (lib/domain, lib/content,
 * lib/checkup, lib/shop, lib/geometry, lib/db, lib/auth/password.ts).
 * Type-only imports are skipped: they are erased before anything runs.
 */
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];
const FORBIDDEN = "server-only";

/** Directories the plan declares plain Node — every file in them is an entry point. */
const PLAIN_NODE_DIRS = [
  "lib/domain",
  "lib/content",
  "lib/checkup",
  "lib/shop",
  "lib/geometry",
  "lib/db",
];
const PLAIN_NODE_FILES = ["prisma/seed.ts", "prisma.config.ts", "lib/auth/password.ts"];

function listSources(dir: string): string[] {
  let entries: string[];
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-relative paths from constants above
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path derived from a directory listing
    if (statSync(path).isDirectory()) {
      return name === "node_modules" || name === "generated" ? [] : listSources(path);
    }
    const isSource = EXTENSIONS.some((ext) => name.endsWith(ext)) && !name.endsWith(".d.ts");
    return isSource && !/\.test\.[cm]?[jt]sx?$/.test(name) ? [path] : [];
  });
}

function isFile(path: string): boolean {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- candidate paths built from resolved import specifiers
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve an import specifier to a file in the repo, `undefined` for a
 * package (bare specifier), or throw for a local import that does not exist.
 */
function resolveLocal(specifier: string, fromFile: string, root: string): string | undefined {
  let base: string;
  if (specifier.startsWith("@/")) base = join(root, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return undefined;

  const withoutJs = base.replace(/\.(m|c)?js$/, "");
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => withoutJs + ext),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  const found = candidates.find(isFile);
  if (!found) throw new Error(`unresolved import "${specifier}" in ${relative(root, fromFile)}`);
  return found;
}

/** Runtime (non-type-only) module specifiers imported by a source file. */
function runtimeImports(file: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- files come from the import walk
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly =
        clause?.isTypeOnly ||
        (clause !== undefined &&
          clause.name === undefined &&
          clause.namedBindings !== undefined &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((element) => element.isTypeOnly));
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const [argument] = node.arguments;
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if ((isDynamicImport || isRequire) && ts.isStringLiteralLike(argument)) {
        specifiers.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/**
 * Breadth-first walk from `entries`. Returns the import chain that reaches
 * `server-only`, or `null`, plus how many local files were visited.
 */
function findServerOnly(entries: string[], root: string) {
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const entry of entries) {
    if (!parent.has(entry)) {
      parent.set(entry, null);
      queue.push(entry);
    }
  }
  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    for (let at: string | null = file; at; at = parent.get(at) ?? null) {
      chain.unshift(relative(root, at));
    }
    return chain;
  };

  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of runtimeImports(file)) {
      if (specifier === FORBIDDEN)
        return { chain: [...chainTo(file), FORBIDDEN], visited: parent.size };
      // Generated Prisma client: machine-written, never imports server-only,
      // and absent until `prisma generate` has run.
      if (specifier.includes("lib/generated/")) continue;
      const next = resolveLocal(specifier, file, root);
      if (!next || parent.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }
  return { chain: null, visited: parent.size };
}

describe("server-only is unreachable from code that runs outside Next", () => {
  const entries = [
    ...PLAIN_NODE_FILES.map((file) => join(ROOT, file)).filter(isFile),
    ...listSources(join(ROOT, "scripts")),
    ...PLAIN_NODE_DIRS.flatMap((dir) => listSources(join(ROOT, dir))),
  ];

  it("finds the entry points it is meant to guard", () => {
    // A walker with nothing to walk passes vacuously; pin the ones that exist today.
    const names = entries.map((file) => relative(ROOT, file));
    expect(names).toContain("prisma/seed.ts");
    expect(names).toContain(join("lib", "auth", "password.ts"));
    expect(names.some((name) => name.startsWith("scripts/"))).toBe(true);
  });

  it("walks the whole graph and never reaches server-only", () => {
    const { chain, visited } = findServerOnly(entries, ROOT);
    expect(chain, chain ? `server-only reached via:\n  ${chain.join("\n  → ")}` : "").toBeNull();
    // seed.ts alone reaches lib/auth/password, lib/db/{env,guard} and seed-data.
    expect(visited).toBeGreaterThan(entries.length);
  });
});

describe("the walker itself", () => {
  // A throwaway graph, so the detection is proven against a positive case and
  // not only by the absence of a finding.
  const fixture = mkdtempSync(join(tmpdir(), "velo-server-only-"));
  const write = (path: string, content: string) => {
    const full = join(fixture, path);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside a mkdtemp fixture
    mkdirSync(dirname(full), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- inside a mkdtemp fixture
    writeFileSync(full, content);
    return full;
  };

  afterAll(() => {
    if (fixture.startsWith(tmpdir()) && fixture.includes("velo-server-only-")) {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("reports the chain through @/ aliases, re-exports and dynamic imports", () => {
    const entry = write("scripts/job.ts", 'import { helper } from "@/lib/a";\nhelper();\n');
    write("lib/a/index.ts", 'export * from "./b";\n');
    write("lib/a/b.ts", 'export const helper = () => import("../c.js");\n');
    write("lib/c.ts", 'import "server-only";\nexport const secret = 1;\n');

    const { chain } = findServerOnly([entry], fixture);
    expect(chain).toEqual([
      "scripts/job.ts",
      join("lib", "a", "index.ts"),
      join("lib", "a", "b.ts"),
      join("lib", "c.ts"),
      "server-only",
    ]);
  });

  it("ignores type-only imports, which are erased at runtime", () => {
    const entry = write(
      "scripts/types.ts",
      'import type { T } from "@/lib/typed";\nimport { type U } from "@/lib/typed";\nexport type { V } from "@/lib/typed";\n',
    );
    write(
      "lib/typed.ts",
      'import "server-only";\nexport type T = 1; export type U = 2; export type V = 3;\n',
    );

    expect(findServerOnly([entry], fixture).chain).toBeNull();
  });

  it("fails loudly on a local import it cannot resolve", () => {
    const entry = write("scripts/broken.ts", 'import "./missing";\n');
    expect(() => findServerOnly([entry], fixture)).toThrow(/unresolved import "\.\/missing"/);
  });
});
