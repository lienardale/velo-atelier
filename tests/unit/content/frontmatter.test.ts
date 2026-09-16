/**
 * The frontmatter splitter (§5.1): fences, YAML errors with their file line,
 * and `lineOf` — the line a validation issue is reported on.
 */
import { describe, expect, it } from "vitest";

import { lineAt, parseFrontmatter, splitFrontmatter } from "@/lib/content/frontmatter";

const SOURCE = [
  "---",
  "slug: clean-chain",
  "tools:",
  "  - toolId: rags",
  "    alternatives: []",
  "steps:",
  "  - id: first",
  "  - id: second",
  "---",
  "",
  '<Step id="first">',
].join("\n");

describe("splitFrontmatter", () => {
  it("splits the YAML block from the body and records where each starts", () => {
    const split = splitFrontmatter(SOURCE);
    expect(split).not.toBeNull();
    expect(split!.yaml.split("\n")[0]).toBe("slug: clean-chain");
    expect(split!.yamlStartLine).toBe(2);
    expect(split!.bodyStartLine).toBe(10);
    expect(split!.body).toContain('<Step id="first">');
  });

  it("accepts a byte-order mark, CRLF line endings and trailing spaces on the fences", () => {
    const split = splitFrontmatter("﻿--- \r\nkind: check\r\n---\t\r\nbody");
    expect(split?.yaml).toBe("kind: check");
    expect(split?.body).toBe("body");
  });

  it("returns null without an opening or a closing fence", () => {
    expect(splitFrontmatter("kind: check\n---\n")).toBeNull();
    expect(splitFrontmatter("---\nkind: check\n")).toBeNull();
    expect(splitFrontmatter("")).toBeNull();
  });
});

describe("parseFrontmatter", () => {
  it("parses YAML into plain data", () => {
    const parsed = parseFrontmatter(SOURCE)!;
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toMatchObject({
      slug: "clean-chain",
      steps: [{ id: "first" }, { id: "second" }],
    });
  });

  it("locates a path in the file, falling back to the deepest existing ancestor", () => {
    const parsed = parseFrontmatter(SOURCE)!;
    expect(parsed.lineOf([])).toBe(2);
    expect(parsed.lineOf(["slug"])).toBe(2);
    expect(parsed.lineOf(["tools", 0, "toolId"])).toBe(4);
    expect(parsed.lineOf(["tools", 0, "alternatives"])).toBe(5);
    expect(parsed.lineOf(["steps", 1])).toBe(8);
    expect(parsed.lineOf(["steps", 1, "id"])).toBe(8);
    expect(parsed.lineOf(["steps", 9, "id"])).toBe(6); // no such item: its list's key
    expect(parsed.lineOf(["nope"])).toBe(2); // no such key: the document
    expect(parsed.lineOf(["slug", "deeper"])).toBe(2); // a scalar has no children
  });

  it("reports YAML syntax errors on their file line and returns no data", () => {
    const parsed = parseFrontmatter("---\nkind: check\ntitle: a: b\n---\n")!;
    expect(parsed.data).toBeUndefined();
    expect(parsed.errors[0].line).toBe(3);
    expect(parsed.errors[0].message).toMatch(/^invalid YAML: /);
  });

  it("rejects duplicate keys", () => {
    const parsed = parseFrontmatter("---\nkind: check\nkind: clean\n---\n")!;
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("returns null when there is no frontmatter at all", () => {
    expect(parseFrontmatter("# Just markdown")).toBeNull();
  });

  it("handles an empty YAML block", () => {
    const parsed = parseFrontmatter("---\n---\nbody")!;
    expect(parsed.data).toBeNull();
    expect(parsed.lineOf(["anything"])).toBe(2);
  });
});

describe("lineAt", () => {
  it("maps an offset to a 1-based line, shifted by the first line", () => {
    expect(lineAt("a\nb\nc", 0)).toBe(1);
    expect(lineAt("a\nb\nc", 2)).toBe(2);
    expect(lineAt("a\nb\nc", 4, 10)).toBe(12);
  });
});
