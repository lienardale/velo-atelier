/**
 * No client component can lose its namespace (§7.1, `.debug/008`).
 *
 * `components/i18n/ClientMessages.tsx` sends each route only the namespaces
 * `lib/i18n/client-namespaces.ts` declares for it, so the merged catalogue stops
 * riding along on every page. next-intl REPLACES messages on a nested provider
 * — it never merges — so a namespace left out of a declaration is not a smaller
 * payload, it is a component rendering `decision.brake-type.title` at the
 * visitor.
 *
 * This suite is what makes that impossible to ship. It reconstructs, from the
 * source, the set of namespaces each route's client subtree can read, and holds
 * the declarations to it:
 *
 *   1. walk the module graph from every route entry file under `app/`
 *      (`page` / `layout` / `error` / `not-found` / `template` / `loading`),
 *      following static, type-only and dynamic imports alike;
 *   2. mark everything reachable THROUGH a `"use client"` module as client code
 *      (that is the RSC rule: a server module imported by a client one is
 *      compiled into the client bundle);
 *   3. collect what those modules ask of next-intl;
 *   4. resolve which provider covers the route — its own, or the nearest layout
 *      above it — and assert the declaration covers the set.
 *
 * **Every uncertainty is resolved against the payload, never against the page.**
 * An import that cannot be resolved fails the run instead of silently pruning a
 * branch; a `useTranslations()` with no namespace (which can read anything, and
 * is exactly what the tree used to do) requires ALL namespaces, so the only way
 * to make a route lighter is to make what it reads visible. Type-only imports
 * are followed even though the bundler erases them — over-approximating adds
 * bytes, under-approximating breaks the page.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path below is derived from the repo's own tree */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { CLIENT_NAMESPACES } from "@/lib/i18n/client-namespaces";
import { NAMESPACES, type Namespace } from "@/lib/i18n/namespaces";

const ROOT = process.cwd();
const APP = join(ROOT, "app");

/** Route files Next renders; `default.tsx` and `global-error.tsx` are handled below. */
const ENTRY_FILES = [
  "page.tsx",
  "layout.tsx",
  "error.tsx",
  "not-found.tsx",
  "template.tsx",
  "loading.tsx",
];

/**
 * `app/global-error.tsx` replaces the document, provider included: it bundles
 * `messages/{fr,en}/common.json` and mounts its own `NextIntlClientProvider`
 * (nothing above it is rendering by then). It is checked for that, not for a
 * declaration.
 */
const SELF_PROVIDING = "app/global-error.tsx";

/**
 * Generated trees (gitignored, rebuilt per CI job). They hold data, never a
 * component, so they open no client branch — but they are frequently absent, so
 * they are named here rather than crashing the resolver.
 */
const GENERATED_PREFIXES = ["@/lib/generated/", "@/lib/content/generated/"];

const rel = (file: string) => relative(ROOT, file).split(sep).join("/");

// ── module graph ─────────────────────────────────────────────────────────────

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];
const INDEXES = EXTENSIONS.slice(1).map((ext) => `/index${ext}`);

type Resolution = { kind: "file"; file: string } | { kind: "external" } | { kind: "missing" };

function resolveSpecifier(specifier: string, from: string): Resolution {
  if (GENERATED_PREFIXES.some((prefix) => specifier.startsWith(prefix)))
    return { kind: "external" };

  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith("./") || specifier.startsWith("../"))
    base = resolve(dirname(from), specifier);
  else return { kind: "external" }; // a package, or a Node builtin

  for (const suffix of [...EXTENSIONS, ...INDEXES]) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile())
      return { kind: "file", file: candidate };
  }
  return { kind: "missing" };
}

/**
 * Three caches, all keyed by path and all pure functions of the file's bytes:
 * its text, its import specifiers, and whether it is a `"use client"` entry.
 *
 * Every route walks its own graph, and the graphs overlap almost completely —
 * `lib/i18n/navigation`, the domain barrel, the UI primitives are in all of
 * them. Uncached, `ts.createSourceFile` re-PARSES each shared module once per
 * route: W3 added six routes and two cases crossed the 5 s per-test timeout
 * (.debug/009 named this file as the next one to trip, and said the fix was a
 * shared walk rather than a bigger number). The slowest case went 5.3 s -> 0.4 s.
 */
const sources = new Map<string, string>();
function read(file: string): string {
  const cached = sources.get(file);
  if (cached !== undefined) return cached;
  const source = readFileSync(file, "utf8");
  sources.set(file, source);
  return source;
}

/**
 * Every module specifier in `file`.
 *
 * `ts.preProcessFile` is TypeScript's own scanner: it sees multi-line imports,
 * `export … from`, `import type`, `import()` and `require()` — everything a
 * hand-written regex gets wrong. It does not distinguish type-only imports,
 * which is the safe direction here (see the file header).
 */
const specifiers = new Map<string, string[]>();
function specifiersOf(file: string): string[] {
  const cached = specifiers.get(file);
  if (cached !== undefined) return cached;
  const found = file.endsWith(".json")
    ? []
    : ts.preProcessFile(read(file), true, true).importedFiles.map((r) => r.fileName);
  specifiers.set(file, found);
  return found;
}

/** The `"use client"` directive, which must be the first statement of the module. */
const clientEntries = new Map<string, boolean>();
function isClientEntry(file: string): boolean {
  const cached = clientEntries.get(file);
  if (cached !== undefined) return cached;
  let answer = false;
  if (!file.endsWith(".json")) {
    const statements = ts.createSourceFile(
      file,
      read(file),
      ts.ScriptTarget.Latest,
      true,
    ).statements;
    const first = statements[0];
    answer =
      first !== undefined &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === "use client";
  }
  clientEntries.set(file, answer);
  return answer;
}

/**
 * The modules reachable from `entry`, each flagged with whether it is compiled
 * into the client bundle. Client-ness propagates DOWN from a `"use client"`
 * module: a server module that imports a client one stays a server module, and
 * everything a client module imports becomes client code.
 */
function clientModulesFrom(entry: string): Set<string> {
  const client = new Set<string>();
  const seen = new Set<string>(); // `${file}\0${isClient}`
  const queue: Array<{ file: string; inClient: boolean }> = [
    { file: entry, inClient: isClientEntry(entry) },
  ];

  while (queue.length > 0) {
    const { file, inClient } = queue.pop() as { file: string; inClient: boolean };
    const key = `${file}\0${String(inClient)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (inClient) client.add(file);

    for (const specifier of specifiersOf(file)) {
      const resolved = resolveSpecifier(specifier, file);
      if (resolved.kind === "external") continue;
      if (resolved.kind === "missing") {
        throw new Error(
          `${rel(file)} imports "${specifier}", which resolves to nothing. The namespace ` +
            `analysis cannot follow it, so it cannot promise the route's client subtree is covered. ` +
            `Fix the import, or add its prefix to GENERATED_PREFIXES if it is a generated data tree.`,
        );
      }
      queue.push({ file: resolved.file, inClient: inClient || isClientEntry(resolved.file) });
    }
  }
  return client;
}

// ── what a client module asks of next-intl ───────────────────────────────────

/** `"*"` = "anything in the catalogue": a translator that was given no namespace. */
type Requirement = Namespace | "*";

/**
 * What `file` reads from the catalogue, from its syntax tree rather than from a
 * grep: a doc comment that quotes `useTranslations()` — this suite's own
 * subjects are full of them — must not read as a claim on the whole catalogue.
 *
 * `useTranslations("x.y")` is namespace `x`. `useTranslations()` and
 * `useTranslations(somethingComputed)` are `"*"`: a translator that was handed
 * no literal namespace can reach any message there is, and no static analysis
 * can say which. `useMessages()` hands over the catalogue itself.
 */
const requirements = new Map<string, Set<Requirement>>();
function requirementsOf(file: string): Set<Requirement> {
  const cached = requirements.get(file);
  if (cached !== undefined) return cached;
  const found = new Set<Requirement>();
  requirements.set(file, found);
  if (file.endsWith(".json")) return found;
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if (callee === "useMessages") found.add("*");
      if (callee === "useTranslations") {
        const [argument] = node.arguments;
        if (argument === undefined || !ts.isStringLiteralLike(argument)) found.add("*");
        else {
          const namespace = argument.text.split(".")[0];
          if (!(NAMESPACES as readonly string[]).includes(namespace)) {
            throw new Error(
              `${rel(file)} calls useTranslations("${argument.text}"), which is not one of ` +
                `the namespaces in lib/i18n/namespaces.ts.`,
            );
          }
          found.add(namespace as Namespace);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

// ── routes and the provider that covers each ─────────────────────────────────

function routeEntries(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...routeEntries(full));
    else if (ENTRY_FILES.includes(name)) found.push(full);
  }
  return found.sort();
}

const DECLARED = new Map<string, readonly Namespace[]>(
  Object.entries(CLIENT_NAMESPACES).map(([key, value]) => [key, value as readonly Namespace[]]),
);

/** A file mounts a provider when it is a key of the table AND reads its own key. */
function mountsProvider(file: string): boolean {
  return DECLARED.has(rel(file));
}

/**
 * The provider a route entry renders under: its own when it mounts one, else the
 * nearest `layout.tsx` above it that does. Route groups are directories, so
 * walking up the tree is exactly Next's own nesting.
 */
function providerFor(entry: string): string | null {
  if (mountsProvider(entry) && entry.endsWith(`${sep}page.tsx`)) return rel(entry);
  if (mountsProvider(entry) && entry.endsWith(`${sep}layout.tsx`)) return rel(entry);
  let dir = dirname(entry);
  // An `error.tsx` renders INSIDE its own segment's layout, so start at this directory.
  for (;;) {
    const layout = join(dir, "layout.tsx");
    if (layout !== entry && mountsProvider(layout)) return rel(layout);
    if (dir === APP || dir === ROOT) return null;
    dir = dirname(dir);
  }
}

function requiredBy(entry: string): Set<Requirement> {
  const required = new Set<Requirement>();
  for (const file of clientModulesFrom(entry)) {
    for (const requirement of requirementsOf(file)) required.add(requirement);
  }
  return required;
}

function expand(required: Set<Requirement>): Namespace[] {
  return required.has("*")
    ? [...NAMESPACES]
    : ([...required] as Namespace[]).sort((a, b) => a.localeCompare(b));
}

// ── the tests ────────────────────────────────────────────────────────────────

const ENTRIES = routeEntries(APP).filter((file) => rel(file) !== SELF_PROVIDING);

describe("the client-namespace table", () => {
  it("names files that exist, and each of them reads its own entry", () => {
    for (const [key, namespaces] of DECLARED) {
      const file = join(ROOT, key);
      expect(existsSync(file), `${key} is declared but does not exist`).toBe(true);
      expect(
        read(file).includes(`CLIENT_NAMESPACES["${key}"]`),
        `${key} must read CLIENT_NAMESPACES["${key}"] — a route may not inline its own list, ` +
          `or this table stops describing what ships`,
      ).toBe(true);
      expect(namespaces.length, `${key} declares no namespace`).toBeGreaterThan(0);
      for (const namespace of namespaces) {
        expect(NAMESPACES, `${key} declares an unknown namespace`).toContain(namespace);
      }
    }
  });

  it("is mounted around everything the route renders, never beside it", () => {
    for (const key of DECLARED.keys()) {
      const source = read(join(ROOT, key));
      const open = source.indexOf("<ClientMessages");
      const close = source.indexOf("</ClientMessages>");
      expect(open, `${key} declares namespaces but mounts no <ClientMessages>`).toBeGreaterThan(-1);
      expect(close, `${key}: unclosed <ClientMessages>`).toBeGreaterThan(open);

      if (key.endsWith("/layout.tsx")) {
        // A layout's provider has to contain `{children}` — the pages below it
        // mount their own, but an `error.tsx` of this segment renders here.
        const children = source.indexOf("{children}");
        expect(
          children > open && children < close,
          `${key} must render {children} inside <ClientMessages>, or the segment's error ` +
            `boundary falls back to the provider above it`,
        ).toBe(true);
      } else {
        expect(
          /return\s*\(\s*<ClientMessages[\s>]/.test(source),
          `${key} must return <ClientMessages …> as its outermost element: a client component ` +
            `rendered beside it would silently fall back to the provider above`,
        ).toBe(true);
      }
    }
  });
});

describe("every route's provider covers the namespaces its client subtree reads", () => {
  for (const entry of ENTRIES) {
    it(rel(entry), () => {
      const required = expand(requiredBy(entry));
      if (required.length === 0) return; // no client component reads a message here

      const provider = providerFor(entry);
      expect(
        provider,
        `${rel(entry)} reads ${required.join(", ")} on the client but no provider covers it`,
      ).not.toBeNull();

      const declared = DECLARED.get(provider as string) as readonly Namespace[];
      const missing = required.filter((namespace) => !declared.includes(namespace));
      expect(
        missing,
        `${rel(entry)} renders under the provider in ${provider as string}.\n` +
          `  it can read:  ${required.join(", ")}\n` +
          `  declared:     ${declared.join(", ")}\n` +
          `  MISSING:      ${missing.join(", ")}\n` +
          `Write the full set into CLIENT_NAMESPACES["${provider as string}"].`,
      ).toEqual([]);
    });
  }
});

describe("app/global-error.tsx", () => {
  it("carries its own provider and its own messages: nothing above it is rendering", () => {
    const source = read(join(ROOT, SELF_PROVIDING));
    expect(source).toMatch(/<NextIntlClientProvider[^>]*\n?[^>]*messages=/);
    expect(source).toMatch(/from "@\/messages\/(fr|en)\/common\.json"/);
  });
});

describe("the analysis itself", () => {
  it("sees the decision tree's namespaces, which are the point of the exercise", () => {
    const required = expand(requiredBy(join(APP, "[locale]", "page.tsx")));
    // If `useDecisionText` ever goes back to a bare `useTranslations()`, this is
    // the line that fails: the requirement becomes every namespace there is.
    expect(required).toContain("decision");
    expect(required.length).toBeLessThan(NAMESPACES.length);
  });

  it("treats an unscoped useTranslations() as a claim on the whole catalogue", () => {
    const file = join(ROOT, "components", "bike", "PartInfo.tsx");
    expect(requirementsOf(file).has("*")).toBe(true);
  });

  it("refuses to guess at an import it cannot resolve", () => {
    // A branch the walk cannot follow is a branch it cannot vouch for, so it
    // stops the run rather than quietly reporting a smaller requirement.
    expect(resolveSpecifier("@/lib/does-not-exist", join(APP, "[locale]", "page.tsx")).kind).toBe(
      "missing",
    );

    const scratch = mkdtempSync(join(tmpdir(), "va-namespaces-"));
    const entry = join(scratch, "entry.tsx");
    writeFileSync(entry, 'import { gone } from "./nowhere";\nexport default gone;\n');
    expect(() => clientModulesFrom(entry)).toThrow(/resolves to nothing/);
  });
});
