#!/usr/bin/env tsx
/**
 * Scaffold a guide in both locales (§5.1).
 *
 *   npm run content:new -- replace-bar-tape
 *   npx tsx scripts/content-new.ts adjust-cleats --part pedal-left --part pedal-right
 *
 * Writes `content/guides/<slug>/{fr,en}.mdx` with identical frontmatter,
 * `status: stub` and one `<Step>` placeholder, then runs nothing else: fill in
 * the text and run `npm run content:check`. The kind comes from the slug's
 * first segment. Refuses to overwrite an existing guide, and refuses
 * `check-`/`measure-` slugs only in spirit — they are scaffolded too, but the
 * check will insist they become `full` before they pass.
 *
 * Plain Node (`tsx`): no `server-only` in the import graph.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { stringify } from "yaml";

import { isGuideSlug, kindOfGuideSlug } from "../lib/content/schema";
import { isPartId } from "../lib/domain/data/parts";

const PLACEHOLDER = {
  fr: {
    title: "Titre du guide",
    summary: "Une ou deux phrases : ce que le guide fait faire, en combien de temps.",
    step: "Première étape",
    body: "Décrivez ici l’étape en au moins quarante mots : ce qu’il faut regarder, dans quel ordre, avec quel outil, ce qui est normal et ce qui ne l’est pas, et ce qu’il faut faire ensuite. Remplacez ce texte avant de passer le guide en « full ».",
  },
  en: {
    title: "Guide title",
    summary: "One or two sentences: what the guide has you do, and how long it takes.",
    step: "First step",
    body: "Describe the step here in at least forty words: what to look at, in which order, with which tool, what is normal and what is not, and what to do next. Replace this text before switching the guide to full status in both locales.",
  },
} as const;

export function scaffold(slug: string, partIds: readonly string[]): Record<"fr" | "en", string> {
  const kind = kindOfGuideSlug(slug);
  if (!isGuideSlug(slug) || kind === null) {
    throw new Error(
      `"${slug}" is not a guide slug: <check|replace|clean|adjust|measure>-<kebab-case>`,
    );
  }
  const unknown = partIds.filter((id) => !isPartId(id));
  if (unknown.length > 0) throw new Error(`unknown part id(s): ${unknown.join(", ")}`);

  const render = (locale: "fr" | "en") => {
    // eslint-disable-next-line security/detect-object-injection -- `locale` is the literal "fr" | "en"
    const text = PLACEHOLDER[locale];
    const frontmatter = {
      slug,
      kind,
      title: text.title,
      summary: text.summary,
      status: "stub",
      order: 100,
      difficulty: 1,
      minutes: 15,
      partIds: partIds.length > 0 ? [...partIds] : ["frame"],
      tools: [],
      related: [],
      steps: [{ id: "first-step", title: text.step }],
    };
    return `---\n${stringify(frontmatter)}---\n\n<Step id="first-step">\n\n${text.body}\n\n</Step>\n`;
  };
  return { fr: render("fr"), en: render("en") };
}

function main(): void {
  const args = process.argv.slice(2);
  const slug = args.find(
    (arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--part",
  );
  const parts = args.flatMap((arg, index) => (args[index - 1] === "--part" ? [arg] : []));
  if (!slug) {
    console.error("usage: npm run content:new -- <kind>-<slug> [--part <partId>]…");
    process.exitCode = 1;
    return;
  }

  let files: Record<"fr" | "en", string>;
  try {
    files = scaffold(slug, parts);
  } catch (error) {
    console.error(`content:new: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const dir = path.join(process.cwd(), "content", "guides", slug);
  /* eslint-disable security/detect-non-literal-fs-filename -- `slug` passed isGuideSlug (no dot, no slash) */
  if (existsSync(dir)) {
    console.error(`content:new: content/guides/${slug} already exists — nothing written.`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(dir, { recursive: true });
  for (const locale of ["fr", "en"] as const) {
    // eslint-disable-next-line security/detect-object-injection -- literal locale tuple
    writeFileSync(path.join(dir, `${locale}.mdx`), files[locale], "utf8");
  }
  /* eslint-enable security/detect-non-literal-fs-filename */
  console.log(
    `content:new: wrote content/guides/${slug}/{fr,en}.mdx (status: stub). Now run npm run content:check.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) main();
