/**
 * `@/lib/domain` must not drag zod into the browser bundle (§2).
 *
 * The decision tree, the part list and the engines run in client components on
 * every keystroke; the parsers only ever run on the server, in tests and in
 * build scripts. If the barrel re-exported a schema module as a value, every
 * page that touches the domain would ship a copy of zod — silently, because
 * nothing would break.
 *
 * So this test walks the real import graph from `lib/domain/index.ts` — static
 * imports, re-exports, `import()` and `require()`, skipping type-only ones,
 * which are erased before anything runs — and fails with the full chain if zod
 * is reachable. `lib/domain/schema/index.ts` is walked too, as a positive
 * control: the walker must find zod there, or its silence about the barrel
 * means nothing.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];

const isZod = (specifier: string) => specifier === "zod" || specifier.startsWith("zod/");

function isFile(path: string): boolean {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- candidate paths built from resolved import specifiers
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Resolve an import to a file in the repo, or `undefined` for a package. */
function resolveLocal(specifier: string, fromFile: string): string | undefined {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return undefined;

  const withoutJs = base.replace(/\.(m|c)?js$/, "");
  const found = [
    base,
    ...EXTENSIONS.map((extension) => withoutJs + extension),
    ...EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ].find(isFile);
  if (!found) throw new Error(`unresolved import "${specifier}" in ${relative(ROOT, fromFile)}`);
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
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const [argument] = node.arguments;
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if ((dynamic || required) && ts.isStringLiteralLike(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return specifiers;
}

/** Breadth-first from `entry`; returns the import chain that reaches zod, or null. */
function findZod(entry: string): { chain: string[] | null; visited: number } {
  const parent = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];

  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    for (let at: string | null = file; at; at = parent.get(at) ?? null)
      chain.unshift(relative(ROOT, at));
    return chain;
  };

  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of runtimeImports(file)) {
      if (isZod(specifier)) return { chain: [...chainTo(file), specifier], visited: parent.size };
      const next = resolveLocal(specifier, file);
      if (next === undefined || parent.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }
  return { chain: null, visited: parent.size };
}

describe("lib/domain/index.ts", () => {
  it("does not reach zod", () => {
    const { chain, visited } = findZod(join(ROOT, "lib", "domain", "index.ts"));
    expect(chain, chain ? `zod reached via:\n  ${chain.join("\n  → ")}` : "").toBeNull();
    // A walker that visited only the barrel would pass vacuously.
    expect(visited).toBeGreaterThan(5);
  });
});

describe("the walker itself", () => {
  it("finds zod from the schema barrel, which is allowed to use it", () => {
    const { chain } = findZod(join(ROOT, "lib", "domain", "schema", "index.ts"));
    expect(chain).not.toBeNull();
    expect(chain?.at(-1)).toBe("zod");
    expect(chain?.[0]).toBe(join("lib", "domain", "schema", "index.ts"));
  });

  it("fails loudly on an import it cannot resolve", () => {
    expect(() => resolveLocal("./nope", join(ROOT, "lib", "domain", "index.ts"))).toThrow(
      /unresolved import/,
    );
  });
});
