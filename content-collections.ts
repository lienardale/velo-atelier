/**
 * content-collections configuration (§5.1) — compiles every guide at build
 * time into `.content-collections/generated` (gitignored), imported as
 * `content-collections` (tsconfig `paths`).
 *
 *   guides   content/guides/<slug>/{fr,en}.mdx  → GuideDocument (lib/content/types.ts)
 *   legal    content/legal/<id>.{fr,en}.mdx     → LegalDocument (lib/content/legal.ts)
 *
 * MDX is compiled HERE, once, by mdx-bundler; the compiled string is rendered
 * only in React Server Components (`components/mdx/GuideContent.tsx`), so no
 * `new Function` and no guide code ever reach the browser, and the static CSP
 * needs no `unsafe-eval` (§5.2).
 *
 * The frontmatter parser is the `GuideFrontmatterSchema` of the content check
 * (plus the `content` body content-collections adds: `GuideSourceSchema`). `transform` re-runs the `<Step id>` ↔ `steps[].id` comparison as
 * defence in depth; the authoritative validator — with file and line — is
 * `npm run content:check` (`lib/content/check.ts`), which runs before
 * `next build`.
 *
 * `parts` (optional per-part notes) is declared by the task that writes it
 * (W2-T3); declaring a collection over a folder that does not exist yet would
 * only produce an empty module and a warning.
 *
 * Wiring: `next.config.ts` wraps the config in `withContentCollections`
 * (orchestrator-owned file); `npm run content:build` runs the same build from
 * the CLI and then regenerates `lib/content/generated/*`.
 */
import { defineCollection, defineConfig } from "@content-collections/core";
import { compileMDX } from "@content-collections/mdx";
import remarkGfm from "remark-gfm";

import {
  isLegalPageId,
  LegalSourceSchema,
  toCalendarDate,
  type LegalDocument,
} from "./lib/content/legal";
import { GuideSourceSchema } from "./lib/content/schema";
import { GUIDE_LOCALES, type GuideDocument } from "./lib/content/types";

/**
 * `GuideDocument` with every interface flattened into a plain object type.
 * content-collections requires the transform's return type to be assignable
 * to its serialisable-record type, and TypeScript never lets an `interface`
 * satisfy an index signature; the mapped type is structurally identical.
 */
type Plain<T> = T extends readonly (infer U)[]
  ? ReadonlyArray<Plain<U>>
  : T extends object
    ? { [K in keyof T]: Plain<T[K]> }
    : T;

/** `<Step id="…">` openings in document order — a regex is enough for defence in depth. */
function bodyStepIds(content: string): string[] {
  return [...content.matchAll(/<Step\s+id="([a-z0-9-]+)"/g)].map((match) => match[1]);
}

const guides = defineCollection({
  name: "guides",
  directory: "content/guides",
  include: "*/*.mdx",
  schema: GuideSourceSchema,
  transform: async (document, context): Promise<Plain<GuideDocument>> => {
    const { _meta, content, ...frontmatter } = document;
    /* eslint-disable security/detect-object-injection -- indices come from Array.prototype.some over `expected` itself */
    const locale = _meta.fileName.replace(/\.mdx$/, "");
    const folder = _meta.directory.split(/[\\/]/).at(-1);

    if (!(GUIDE_LOCALES as readonly string[]).includes(locale)) {
      throw new Error(`${_meta.filePath}: a guide file is named fr.mdx or en.mdx`);
    }
    if (folder !== frontmatter.slug) {
      throw new Error(`${_meta.filePath}: slug "${frontmatter.slug}" must equal its folder name`);
    }

    const expected = frontmatter.steps.map((step) => step.id);
    const actual = bodyStepIds(content);
    if (
      frontmatter.status === "full" &&
      (actual.length !== expected.length || actual.some((id, index) => id !== expected[index]))
    ) {
      throw new Error(
        `${_meta.filePath}: <Step> ids [${actual.join(", ")}] must equal frontmatter steps [${expected.join(", ")}]`,
      );
    }

    /* eslint-enable security/detect-object-injection */
    const mdx = await compileMDX(context, document);
    return { ...frontmatter, locale: locale as GuideDocument["locale"], mdx };
  },
});

/**
 * The legal pages (§6.6). One file per page and locale, named `<id>.<locale>.mdx`
 * directly under `content/legal/` — the id is the document, not a folder, because
 * there are exactly two of them and they have no assets of their own.
 */
const legal = defineCollection({
  name: "legalPage",
  directory: "content/legal",
  include: "*.mdx",
  schema: LegalSourceSchema,
  transform: async (document, context): Promise<Plain<LegalDocument>> => {
    const { _meta, content, updatedAt, ...frontmatter } = document;
    const [id, locale, ...rest] = _meta.fileName.replace(/\.mdx$/, "").split(".");

    if (rest.length > 0 || !isLegalPageId(id)) {
      throw new Error(`${_meta.filePath}: a legal file is named <id>.<locale>.mdx`);
    }
    if (!(GUIDE_LOCALES as readonly string[]).includes(locale)) {
      throw new Error(`${_meta.filePath}: "${locale}" is not a locale (fr, en)`);
    }

    /**
     * GFM, for the LEGAL pages only.
     *
     * An RGPD privacy policy is a table — data, purpose, legal basis, and a
     * second one for cookies — and MDX without `remark-gfm` renders a pipe
     * table as a paragraph of pipe characters, which is what
     * `/fr/confidentialite` shipped as until the W3 integration. §1.4 pins the
     * dependency set and predates this content; adding the plugin was the
     * smaller of the two honest fixes (the other being to rewrite the policy
     * without tables).
     *
     * Scoped to this collection deliberately. GFM also turns on strikethrough,
     * autolinks, task lists and footnotes, and the 47 guides are validated by
     * `lib/content/check.ts` against a closed set of components — changing how
     * their bodies parse is a content decision for a wave that owns the guides.
     */
    const mdx = await compileMDX(context, document, { remarkPlugins: [remarkGfm] });
    return {
      ...frontmatter,
      id,
      locale: locale as LegalDocument["locale"],
      updatedAt: toCalendarDate(updatedAt),
      mdx,
    };
  },
});

export default defineConfig({ content: [guides, legal] });
