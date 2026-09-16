/**
 * Content types — what a guide is once its MDX file has been read (§5.1).
 *
 * Zod-free on purpose: client components (the `/guides` filter, the checkup
 * wizard) import these types, and `import type` from here never drags a parser
 * into the browser bundle. The parsers live in `./schema.ts`.
 *
 * Vocabulary:
 *
 *   frontmatter  the YAML block at the top of `content/guides/<slug>/<locale>.mdx`
 *                — `ProcedureMeta` (lib/domain/schema/procedure.ts) plus the
 *                document fields below;
 *   document     one locale of one guide, as content-collections emits it
 *                (frontmatter + `locale` + compiled MDX `mdx`);
 *   summary      the serialisable subset a list page or a client filter needs.
 */
import type { SpecCondition } from "@/lib/domain/schema/condition";
import type { ProcedureKind, ProcedureMeta } from "@/lib/domain/schema/procedure";
import type { Locale } from "@/lib/i18n/routing";

/**
 * `full` = written in full in both locales; `stub` = complete frontmatter and a
 * single `<Step>` body, rendered with a banner, excluded from the sitemap and
 * from related-guide suggestions (§5.7).
 */
export const GUIDE_STATUSES = ["full", "stub"] as const;

export type GuideStatus = (typeof GUIDE_STATUSES)[number];

/** The locales a guide is written in — the file names under its folder. */
export const GUIDE_LOCALES = ["fr", "en"] as const satisfies readonly Locale[];

/** Everything the frontmatter of one guide file declares. */
export interface GuideFrontmatter extends ProcedureMeta<string> {
  /** The page `<h1>`, in the file's language. */
  title: string;
  /** One or two sentences: the card text and the meta description. */
  summary: string;
  status: GuideStatus;
  /** Slugs of guides worth reading next (their kind is free). */
  related: readonly string[];
  /** Sort key inside a kind on `/guides`; lower first. */
  order: number;
  /**
   * Safety notes shown above the steps. Required by the strict content check
   * for guides that touch a battery, a motor, a brake hose or a rotor.
   */
  safety?: readonly string[];
}

/** One heading of the table of contents: a step, in document order. */
export interface GuideTocEntry {
  id: string;
  title: string;
}

/** One locale of one guide, as the content collection emits it. */
export interface GuideDocument extends GuideFrontmatter {
  locale: Locale;
  /** Compiled MDX (mdx-bundler output) — rendered by `components/mdx` in RSC only. */
  mdx: string;
}

/** What a list card and the client-side filter need: no MDX, no steps bodies. */
export interface GuideSummary {
  slug: string;
  locale: Locale;
  kind: ProcedureKind;
  title: string;
  summary: string;
  status: GuideStatus;
  difficulty: 1 | 2 | 3;
  minutes: number;
  order: number;
  partIds: readonly string[];
  /** The part systems the guide touches, derived from its `partIds`. */
  systems: readonly string[];
  appliesTo?: SpecCondition<string>;
}

/** A located problem found by the content check: `file:line: message`. */
export interface ContentIssue {
  /** Repo-relative, forward slashes. */
  file: string;
  /** 1-based. */
  line: number;
  message: string;
}

export interface ContentCheckResult {
  errors: ContentIssue[];
}
