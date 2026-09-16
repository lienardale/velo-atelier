/**
 * The guides on disk, parsed the way the build parses them but without the
 * build: frontmatter through `GuideFrontmatterSchema`, `mdx` left empty. Unit,
 * UI and integration tests use it so none of them depends on
 * `.content-collections/` existing.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fixed paths under content/guides */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter } from "@/lib/content/frontmatter";
import { GuideFrontmatterSchema } from "@/lib/content/schema";
import { GUIDE_LOCALES, type GuideDocument } from "@/lib/content/types";

export const GUIDES_DIR = join(process.cwd(), "content", "guides");

/** Folder names under `content/guides`, sorted. */
export function slugsOnDisk(root = process.cwd()): string[] {
  const dir = join(root, "content", "guides");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/** One locale of one guide, parsed (throws on an invalid file: tests want to know). */
export function readGuide(
  slug: string,
  locale: (typeof GUIDE_LOCALES)[number],
): GuideDocument & { body: string } {
  const source = readFileSync(join(GUIDES_DIR, slug, `${locale}.mdx`), "utf8");
  const parsed = parseFrontmatter(source);
  if (!parsed) throw new Error(`${slug}/${locale}.mdx has no frontmatter`);
  const frontmatter = GuideFrontmatterSchema.parse(parsed.data);
  return { ...frontmatter, locale, mdx: "", body: parsed.body };
}

/** Every guide file on disk. */
export function diskGuides(): Array<GuideDocument & { body: string }> {
  return slugsOnDisk().flatMap((slug) => GUIDE_LOCALES.map((locale) => readGuide(slug, locale)));
}

/** A minimal valid document, for tests that need to shape one by hand. */
export function makeGuide(overrides: Partial<GuideDocument> = {}): GuideDocument {
  return {
    slug: "clean-chain",
    kind: "clean",
    title: "Clean the chain",
    summary: "Summary.",
    status: "full",
    order: 10,
    partIds: ["chain"],
    tools: [],
    difficulty: 1,
    minutes: 10,
    steps: [{ id: "one", title: "One" }],
    related: [],
    locale: "en",
    mdx: "",
    ...overrides,
  };
}
