/**
 * The two legal documents (§6.6, §8.4 W3-T4): `content/legal/<id>.<locale>.mdx`.
 *
 * They are ordinary prose, not procedures — no steps, no parts, no tools — so
 * they get their own tiny collection rather than a relaxed guide schema. What
 * they share with guides is the reason they go through content-collections at
 * all: **the MDX is compiled at build time and rendered in a server component**,
 * so no document body is ever evaluated in the browser and `script-src` keeps
 * its `'unsafe-eval'`-free policy (§5.2).
 *
 * `updatedAt` is the only field a page reads besides the prose: a privacy policy
 * whose last revision is unknown is not a privacy policy. YAML parses an
 * unquoted `2026-09-17` into a `Date`, which content-collections cannot put in
 * its generated module, so the transform stores the calendar date as a string
 * and {@link legalUpdatedAt} turns it back into a `Date` for the formatter.
 *
 * Zod-free at the type level for the same reason as `./types.ts`: nothing here
 * should be able to drag a parser into a client bundle. The schema below is
 * used by `content-collections.ts` (build) and by tests, both server-side.
 */
import * as z from "zod";

import type { Locale } from "@/lib/i18n/routing";

/**
 * The file stems under `content/legal/`, and the order the footer lists them
 * in. Each maps to one route: `mentions` → `/mentions-legales`,
 * `confidentialite` → `/confidentialite` (`routing.pathnames`).
 */
export const LEGAL_PAGE_IDS = ["mentions", "confidentialite"] as const;

export type LegalPageId = (typeof LEGAL_PAGE_IDS)[number];

export function isLegalPageId(value: unknown): value is LegalPageId {
  return typeof value === "string" && (LEGAL_PAGE_IDS as readonly string[]).includes(value);
}

/** One locale of one legal page, as the content collection emits it. */
export interface LegalDocument {
  id: LegalPageId;
  locale: Locale;
  /** The page `<h1>`, in the file's language. */
  title: string;
  /** One or two sentences: the meta description. */
  summary: string;
  /** The calendar date of the last revision, `YYYY-MM-DD`. */
  updatedAt: string;
  /** Compiled MDX — rendered in a React Server Component only (§5.2). */
  mdx: string;
}

/**
 * The frontmatter of a legal file, plus the body content-collections hands the
 * transform. `z.coerce.date()` because YAML gives a `Date` here and a `string`
 * the day someone quotes the value.
 */
export const LegalSourceSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(320),
  updatedAt: z.coerce.date(),
  content: z.string(),
});

/** `YYYY-MM-DD` in UTC — the calendar date, never shifted by the build's timezone. */
export function toCalendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The stored calendar date as a `Date` at UTC midnight, for `format.dateTime`. */
export function legalUpdatedAt(document: Pick<LegalDocument, "updatedAt">): Date {
  return new Date(`${document.updatedAt}T00:00:00.000Z`);
}

/** One legal page in one locale, or `undefined`. */
export function findLegal<T extends LegalDocument>(
  documents: readonly T[],
  id: LegalPageId,
  locale: Locale,
): T | undefined {
  return documents.find((document) => document.id === id && document.locale === locale);
}
