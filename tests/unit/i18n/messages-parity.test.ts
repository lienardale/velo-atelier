/**
 * Message catalogues: FR and EN say the same things (§7.1).
 *
 * Copied from bd-platform's `__tests__/i18n/messages.test.ts` and extended for
 * one-file-per-namespace catalogues:
 *
 *   1. the namespace list (`lib/i18n/namespaces.ts`) and the files on disk agree,
 *      in both locales, and every name matches /^[a-z0-9-]+$/;
 *   2. per namespace, FR and EN have identical flattened key sets — a failure
 *      names every missing key;
 *   3. keys are leaves (a key is a string or an object, never both — next-intl
 *      cannot express both) and no key segment contains a dot;
 *   4. no empty value, and no EN value that is just its key (an untranslated
 *      placeholder pasted by hand);
 *   5. FR and EN use the same ICU placeholders (`{count}`, `{value, number}`,
 *      `<link>` tags): a translation that drops `{count}` would render an
 *      unformatted message, one that renames it would throw at runtime.
 */
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename -- fixed paths under messages/ and offsets into our own catalogue strings */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NAMESPACES } from "@/lib/i18n/namespaces";
import { routing } from "@/lib/i18n/routing";

const MESSAGES_DIR = join(process.cwd(), "messages");
const [SOURCE, ...TARGETS] = routing.locales; // French is the source language.

type Tree = { [key: string]: string | Tree };

function load(locale: string, namespace: string): Tree {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, locale, `${namespace}.json`), "utf8")) as Tree;
}

function namespacesOnDisk(locale: string): string[] {
  return readdirSync(join(MESSAGES_DIR, locale))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();
}

/** `{ a: { b: "x" } }` → `[["a.b", "x"]]`. Non-string, non-object leaves are reported as-is. */
function flatten(tree: unknown, prefix = ""): Array<[string, unknown]> {
  if (typeof tree !== "object" || tree === null || Array.isArray(tree)) return [[prefix, tree]];
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? flatten(value, prefix ? `${prefix}.${key}` : key)
      : [[prefix ? `${prefix}.${key}` : key, value] as [string, unknown]],
  );
}

/** Every raw key segment (a flattened key hides a dotted segment, so walk the tree). */
function keySegments(tree: unknown): string[] {
  if (typeof tree !== "object" || tree === null || Array.isArray(tree)) return [];
  return Object.entries(tree).flatMap(([key, value]) => [key, ...keySegments(value)]);
}

// ── ICU placeholder extraction ────────────────────────────────────────────────
//
// A small recursive-descent reader of ICU MessageFormat as next-intl
// (intl-messageformat) parses it: `{name}`, `{name, type}`, `{name, type, style}`,
// `{name, plural|selectordinal|select, … {sub-message} …}`, `#` inside plurals,
// `<tag>…</tag>` rich-text tags, and apostrophe quoting ('' is a literal
// apostrophe; '{…}' is literal text). Returns argument names and `<tag>` names.

const BRANCHING = new Set(["plural", "selectordinal", "select"]);

function icuPlaceholders(message: string): string[] {
  const found = new Set<string>();
  let i = 0;

  const fail = (reason: string): never => {
    throw new Error(`ICU parse error at ${i} in ${JSON.stringify(message)}: ${reason}`);
  };

  const skipWhitespace = () => {
    while (i < message.length && /\s/.test(message[i])) i++;
  };

  // Reads message text until the `}` that closes the enclosing sub-message (not consumed).
  const readMessage = (inBranch: boolean) => {
    while (i < message.length) {
      const ch = message[i];
      if (ch === "'") {
        const next = message[i + 1];
        if (next === "'") {
          i += 2;
        } else if (next === "{" || next === "}" || (inBranch && next === "#") || next === "<") {
          const end = message.indexOf("'", i + 1);
          i = end === -1 ? message.length : end + 1;
        } else {
          i++;
        }
      } else if (ch === "{") {
        i++;
        readArgument();
      } else if (ch === "}") {
        if (!inBranch) fail("unmatched }");
        return;
      } else if (ch === "<") {
        const tag = /^<\/?([a-zA-Z][\w-]*)\s*\/?>/.exec(message.slice(i));
        if (tag) {
          found.add(`<${tag[1]}>`);
          i += tag[0].length;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }
    if (inBranch) fail("unterminated sub-message");
  };

  // After `{`: `name`, `name, type`, `name, type, style` or a branching argument.
  const readArgument = () => {
    skipWhitespace();
    const name = /^[^\s,{}]+/.exec(message.slice(i))?.[0] ?? fail("empty argument name");
    found.add(name);
    i += name.length;
    skipWhitespace();
    if (message[i] === "}") {
      i++;
      return;
    }
    if (message[i] !== ",") fail(`expected , or } after "${name}"`);
    i++;
    skipWhitespace();
    const type = /^[a-z]+/.exec(message.slice(i))?.[0] ?? fail("missing argument type");
    i += type.length;
    skipWhitespace();

    if (!BRANCHING.has(type)) {
      // number / date / time with an optional style, possibly a skeleton `::…`.
      let depth = 1;
      while (i < message.length && depth > 0) {
        if (message[i] === "{") depth++;
        else if (message[i] === "}") depth--;
        i++;
      }
      if (depth > 0) fail("unterminated argument");
      return;
    }

    if (message[i] !== ",") fail(`expected , after ${type}`);
    i++;
    // selector {sub-message} pairs until the closing brace of the argument.
    for (;;) {
      skipWhitespace();
      if (message[i] === "}") {
        i++;
        return;
      }
      const selector = /^[^\s{}]+/.exec(message.slice(i))?.[0] ?? fail("missing selector");
      i += selector.length;
      skipWhitespace();
      if (selector.startsWith("offset:") && message[i] !== "{") continue;
      if (message[i] !== "{") fail(`expected { after selector "${selector}"`);
      i++;
      readMessage(true);
      i++; // the sub-message's closing }
    }
  };

  readMessage(false);
  return [...found].sort();
}

// ── The tests ─────────────────────────────────────────────────────────────────

describe("icuPlaceholders (the parser this suite relies on)", () => {
  it("finds simple, typed and branching arguments, nested ones and tags", () => {
    expect(icuPlaceholders("Bonjour")).toEqual([]);
    expect(icuPlaceholders("Référence : {digest}")).toEqual(["digest"]);
    expect(icuPlaceholders("{value, number} mm")).toEqual(["value"]);
    expect(icuPlaceholders("{d, date, ::yyyyMMdd} {n, number, percent}")).toEqual(["d", "n"]);
    expect(
      icuPlaceholders(
        "{count, plural, offset:1 =0 {aucune} one {# pièce de {owner}} other {# pièces}}",
      ),
    ).toEqual(["count", "owner"]);
    expect(icuPlaceholders("{kind, select, road {Route} other {Autre}}")).toEqual(["kind"]);
    expect(icuPlaceholders("Lire <link>la suite</link> et <br/>")).toEqual(["<br>", "<link>"]);
  });

  it("honours apostrophe quoting", () => {
    expect(icuPlaceholders("l'atelier de {name}")).toEqual(["name"]);
    expect(icuPlaceholders("It''s {name}")).toEqual(["name"]);
    expect(icuPlaceholders("literal '{braces}' here")).toEqual([]);
    expect(icuPlaceholders("{n, plural, other {'#' is # }}")).toEqual(["n"]);
  });

  it("rejects malformed messages instead of guessing", () => {
    for (const bad of ["oops }", "{}", "{n, plural, one {x}", "{n, number", "{n x}", "{n,}"]) {
      expect(() => icuPlaceholders(bad), bad).toThrow(/ICU parse error/);
    }
    expect(() => icuPlaceholders("{n, plural, one x}")).toThrow(/expected \{/);
    expect(() => icuPlaceholders("{n, select {x}}")).toThrow(/expected , after select/);
  });
});

describe("namespace registry", () => {
  it("lists only well-formed, unique names", () => {
    expect(NAMESPACES.length).toBeGreaterThan(0);
    // Digits are allowed: plan Appendix A names the `bike3d` namespace, while §1.2 quotes
    // /^[a-z-]+$/. What the rule protects is a dot-free file name / key segment.
    for (const ns of NAMESPACES) expect(ns).toMatch(/^[a-z0-9-]+$/);
    expect(new Set(NAMESPACES).size).toBe(NAMESPACES.length);
  });

  for (const locale of routing.locales) {
    it(`matches the files in messages/${locale}/`, () => {
      expect(namespacesOnDisk(locale)).toEqual([...NAMESPACES].sort());
    });
  }
});

for (const namespace of NAMESPACES) {
  describe(`messages/*/${namespace}.json`, () => {
    const source = load(SOURCE, namespace);

    for (const locale of routing.locales) {
      const tree = load(locale, namespace);
      const entries = flatten(tree);

      it(`${locale}: every key is a leaf string or an object, and no segment has a dot`, () => {
        const nonStrings = entries.filter(([, value]) => typeof value !== "string").map(([k]) => k);
        expect(nonStrings, `non-string leaves in ${locale}/${namespace}.json`).toEqual([]);
        const dotted = keySegments(tree).filter((segment) => segment.includes("."));
        expect(dotted, `key segments containing "." in ${locale}/${namespace}.json`).toEqual([]);
      });

      it(`${locale}: no empty value`, () => {
        const empty = entries
          .filter(([, value]) => typeof value === "string" && value.trim() === "")
          .map(([key]) => key);
        expect(empty, `empty values in ${locale}/${namespace}.json`).toEqual([]);
      });

      it(`${locale}: every ICU message parses`, () => {
        for (const [key, value] of entries) {
          expect(
            () => icuPlaceholders(String(value)),
            `${locale}/${namespace}:${key}`,
          ).not.toThrow();
        }
      });
    }

    for (const target of TARGETS) {
      const translated = load(target, namespace);

      it(`${SOURCE} and ${target} have identical key sets`, () => {
        const sourceKeys = new Set(flatten(source).map(([key]) => key));
        const targetKeys = new Set(flatten(translated).map(([key]) => key));
        const missingInTarget = [...sourceKeys].filter((key) => !targetKeys.has(key));
        const missingInSource = [...targetKeys].filter((key) => !sourceKeys.has(key));
        expect(
          { [`missing in ${target}`]: missingInTarget, [`missing in ${SOURCE}`]: missingInSource },
          `${namespace}.json key sets differ`,
        ).toEqual({ [`missing in ${target}`]: [], [`missing in ${SOURCE}`]: [] });
      });

      it(`${target}: no value is just its key`, () => {
        const echoed = flatten(translated)
          .filter(([key, value]) => {
            const last = key.split(".").at(-1);
            return value === key || value === `${namespace}.${key}` || value === last;
          })
          .map(([key]) => key);
        expect(echoed, `${target}/${namespace}.json values equal to their key`).toEqual([]);
      });

      it(`${SOURCE} and ${target} use the same ICU placeholders`, () => {
        const targetValues = new Map(flatten(translated));
        const mismatches = flatten(source)
          .filter(([key]) => targetValues.has(key))
          .map(([key, value]) => ({
            key,
            [SOURCE]: icuPlaceholders(String(value)),
            [target]: icuPlaceholders(String(targetValues.get(key))),
          }))
          .filter((row) => JSON.stringify(row[SOURCE]) !== JSON.stringify(row[target]));
        expect(mismatches, `${namespace}.json placeholder mismatches`).toEqual([]);
      });
    }
  });
}
