/**
 * What `lib/guest/schema.ts` and `lib/guest/import.ts` can REACH.
 *
 * Both files open with a rule about their imports, and until 2026-10-09
 * nothing held either:
 *
 *   `lib/guest/schema.ts` is loaded in the browser by `/import` (a dynamic
 *   `import()` in `GuestImport.tsx`). It must put neither classic `zod` nor a
 *   generated enum in that chunk — and it did put classic zod there, through a
 *   VALUE import of `KO_ACTIONS` from `lib/domain/schema/procedure.ts` (43 zod
 *   class names counted in the built chunk, found in review);
 *
 *   `lib/guest/import.ts` is plain Node — no `server-only`, no `next/*`, the
 *   database and the planner passed in — so that the unit tier can drive it
 *   with the real planner and the recording fake.
 *
 * No other gate sees a regression of either. ESLint's `client-bundle` block
 * lists `components/**`, `lib/checkup/**` and `lib/hooks/**`, not this folder;
 * `no-server-only-in-scripts.test.ts` does not list it and `tests/setup.ts`
 * mocks `server-only` anyway; `tsc` has no opinion; and the bundle budget
 * measures FIRST-LOAD JavaScript, while this module arrives in a lazy chunk —
 * a build with a generated enum imported here still ended in "Bundle budget
 * respected" (measured in review: three one-line mutations, every Vitest tier,
 * ESLint, `tsc` and the build all green).
 *
 * So this walks the RUNTIME import graph from each file — static imports,
 * re-exports and `import()`, skipping type-only ones, which are erased before
 * anything runs — and names the whole chain when it finds something. The
 * walker is checked against three files that DO reach what it looks for: its
 * silence about the two above would mean nothing otherwise.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".json"];

function isFile(path: string): boolean {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- candidate paths built from resolved import specifiers
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Resolve an import to a file of the repository, or `null` for a package. */
function resolveLocal(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;
  const found = [
    base,
    ...EXTENSIONS.map((extension) => base + extension),
    ...EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ].find(isFile);
  // An import this walker cannot follow is a part of the graph it did not see.
  if (found === undefined) {
    throw new Error(`unresolved import "${specifier}" in ${relative(ROOT, from)}`);
  }
  return found;
}

/** Module specifiers a file imports at RUNTIME (type-only imports are erased). */
function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- files come from the import walk
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const onlyTypes =
        clause?.isTypeOnly === true ||
        (clause !== undefined &&
          clause.name === undefined &&
          named !== undefined &&
          ts.isNamedImports(named) &&
          named.elements.length > 0 &&
          named.elements.every((element) => element.isTypeOnly));
      if (!onlyTypes) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

interface Graph {
  /** Every package specifier reached, with the chain of files that reaches it. */
  packages: Map<string, string[]>;
  /** Every file of the repository reached (repo-relative), with its chain. */
  files: Map<string, string[]>;
}

/** Everything reachable at runtime from `entry` (repo-relative), breadth-first. */
function reach(entry: string): Graph {
  const start = join(ROOT, entry);
  const chains = new Map<string, string[]>([[start, [entry]]]);
  const packages = new Map<string, string[]>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    const chain = chains.get(file) as string[];
    for (const specifier of runtimeImports(file)) {
      const target = resolveLocal(file, specifier);
      if (target === null) {
        if (!packages.has(specifier)) packages.set(specifier, [...chain, specifier]);
      } else if (!chains.has(target)) {
        chains.set(target, [...chain, relative(ROOT, target)]);
        queue.push(target);
      }
    }
  }
  return {
    packages,
    files: new Map([...chains.entries()].map(([file, chain]) => [relative(ROOT, file), chain])),
  };
}

const show = (chains: readonly string[][]): string[] => chains.map((chain) => chain.join(" → "));

/** The chains that reach a package matching `test`. */
function packagesMatching(graph: Graph, test: (specifier: string) => boolean): string[] {
  return show([...graph.packages.entries()].filter(([name]) => test(name)).map(([, c]) => c));
}

/** The chains that reach a file of the repository under one of `prefixes`. */
function filesUnder(graph: Graph, ...prefixes: string[]): string[] {
  return show(
    [...graph.files.entries()]
      .filter(([file]) => prefixes.some((prefix) => file.startsWith(prefix)))
      .map(([, chain]) => chain),
  );
}

const isServerSide = (specifier: string): boolean =>
  specifier === "server-only" || /^next(\/|$)/.test(specifier) || /^node:/.test(specifier);

describe("lib/guest/schema.ts — loaded in the browser by /import", () => {
  const graph = reach("lib/guest/schema.ts");

  it("reaches zod/mini, and not classic zod", () => {
    // The bare specifier `zod` IS the classic build; `zod/mini` is the other.
    expect(packagesMatching(graph, (name) => name === "zod")).toEqual([]);
    expect(
      packagesMatching(graph, (name) => name.startsWith("zod/") && name !== "zod/mini"),
    ).toEqual([]);
    expect(graph.packages.has("zod/mini")).toBe(true);
  });

  it("reaches no generated enum — ids are matched by pattern, and by the plan on the server", () => {
    expect(filesUnder(graph, "lib/content/generated/", ".content-collections/")).toEqual([]);
    expect(packagesMatching(graph, (name) => name === "content-collections")).toEqual([]);
  });

  it("reaches nothing that only runs on a server", () => {
    expect(packagesMatching(graph, isServerSide)).toEqual([]);
    expect(filesUnder(graph, "lib/db/", "lib/generated/", "lib/actions/", "app/")).toEqual([]);
  });

  it("was walked, not skimmed: it reaches the three modules whose shapes it projects", () => {
    // A walker that stopped at the entry would pass everything above.
    expect(graph.files.has("lib/checkup/storage.ts")).toBe(true);
    expect(graph.files.has("lib/bike/local-bike.ts")).toBe(true);
    expect(graph.files.has("lib/domain/data/conventions.ts")).toBe(true);
    expect(graph.files.size).toBeGreaterThan(10);
  });
});

describe("lib/guest/import.ts — plain Node, the database and the planner passed in", () => {
  const graph = reach("lib/guest/import.ts");

  it("reaches neither server-only nor next/*", () => {
    expect(
      packagesMatching(graph, (name) => name === "server-only" || /^next(\/|$)/.test(name)),
    ).toEqual([]);
  });

  it("does not import the corpus: the planner is injected", () => {
    expect(packagesMatching(graph, (name) => name === "content-collections")).toEqual([]);
    expect(filesUnder(graph, "lib/content/", ".content-collections/")).toEqual([]);
  });

  it("does not import the database client either — only its types", () => {
    expect(filesUnder(graph, "lib/db/prisma", "lib/generated/")).toEqual([]);
  });

  it("was walked, not skimmed", () => {
    expect(graph.files.has("lib/guest/schema.ts")).toBe(true);
    expect(graph.files.has("lib/checkup/items.ts")).toBe(true);
    expect(graph.packages.has("node:crypto")).toBe(true);
  });
});

describe("the walker itself", () => {
  it("finds classic zod from the module the contract used to take a value from", () => {
    const graph = reach("lib/domain/schema/procedure.ts");
    expect(packagesMatching(graph, (name) => name === "zod")).toEqual([
      "lib/domain/schema/procedure.ts → zod",
    ]);
  });

  it("finds the generated enums and next/* from a saved bike's checkup actions", () => {
    const graph = reach("app/[locale]/velo/[id]/controle/actions.ts");
    expect(filesUnder(graph, "lib/content/generated/").length).toBeGreaterThan(0);
    expect(packagesMatching(graph, (name) => /^next(\/|$)/.test(name)).length).toBeGreaterThan(0);
  });

  it("finds server-only and the corpus from the import ACTION, which is allowed both", () => {
    const graph = reach("app/[locale]/(protected)/import/actions.ts");
    expect(packagesMatching(graph, (name) => name === "server-only").length).toBeGreaterThan(0);
    expect(filesUnder(graph, "lib/content/").length).toBeGreaterThan(0);
  });

  it("does not follow a type-only import, and fails loudly on one it cannot resolve", () => {
    // `lib/guest/import.ts` names `PrismaClient` — as a type.
    expect(readFileSync(join(ROOT, "lib/guest/import.ts"), "utf8")).toMatch(
      /import type \{[^}]*PrismaClient[^}]*\} from "@\/lib\/generated\/prisma\/client"/,
    );
    expect(() => resolveLocal(join(ROOT, "lib/guest/schema.ts"), "./nope")).toThrow(
      /unresolved import/,
    );
  });
});
