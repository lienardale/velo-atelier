/**
 * Guide accessors (§5.1, §6.2) — pure functions over the documents the content
 * collection emits.
 *
 * They take the documents as an argument instead of importing
 * `content-collections` themselves: the generated module only exists after
 * `npm run content:build`, and a unit test, a script or the CI `unit` job must
 * not depend on a build step to exercise the logic. The one import of the
 * generated module is `lib/content/collection.ts`, used by the pages.
 *
 * Zod-free and React-free.
 */
import { PART_SYSTEMS } from "@/lib/domain/data/conventions";
import { partDefinition } from "@/lib/domain/data/parts";
import type { ProcedureKind } from "@/lib/domain/schema/procedure";
import type { Locale } from "@/lib/i18n/routing";

import type { GuideDocument, GuideSummary, GuideTocEntry } from "./types";

/** `/guides` sections, in display order. */
export const GUIDE_KIND_ORDER: readonly ProcedureKind[] = [
  "check",
  "adjust",
  "clean",
  "replace",
  "measure",
];

/** The part systems a set of part ids belongs to, in catalogue order. */
export function systemsOf(partIds: readonly string[]): string[] {
  const systems = new Set(partIds.map((id) => partDefinition(id)?.system));
  return PART_SYSTEMS.filter((system) => systems.has(system));
}

/** A document without its MDX: what list pages and client filters receive. */
export function toSummary(document: GuideDocument): GuideSummary {
  return {
    slug: document.slug,
    locale: document.locale,
    kind: document.kind,
    title: document.title,
    summary: document.summary,
    status: document.status,
    difficulty: document.difficulty,
    minutes: document.minutes,
    order: document.order,
    partIds: document.partIds,
    systems: systemsOf(document.partIds),
    ...(document.appliesTo === undefined ? {} : { appliesTo: document.appliesTo }),
  };
}

/** Kind (in `GUIDE_KIND_ORDER`), then `order`, then title — a stable total order. */
export function compareGuides(
  a: Pick<GuideSummary, "kind" | "order" | "title" | "slug">,
  b: Pick<GuideSummary, "kind" | "order" | "title" | "slug">,
): number {
  return (
    GUIDE_KIND_ORDER.indexOf(a.kind) - GUIDE_KIND_ORDER.indexOf(b.kind) ||
    a.order - b.order ||
    a.title.localeCompare(b.title) ||
    a.slug.localeCompare(b.slug)
  );
}

/** Every guide of `locale`, sorted. */
export function guidesForLocale<T extends GuideDocument>(
  documents: readonly T[],
  locale: Locale,
): T[] {
  return documents.filter((document) => document.locale === locale).sort(compareGuides);
}

/** One guide, or `undefined`. */
export function findGuide<T extends GuideDocument>(
  documents: readonly T[],
  slug: string,
  locale: Locale,
): T | undefined {
  return documents.find((document) => document.slug === slug && document.locale === locale);
}

/** `generateStaticParams` for `/[locale]/guides/[slug]`. */
export function guideSlugsForLocale(documents: readonly GuideDocument[], locale: Locale): string[] {
  return guidesForLocale(documents, locale).map((document) => document.slug);
}

/** The table of contents: the steps, in order. */
export function tocOf(document: Pick<GuideDocument, "steps">): GuideTocEntry[] {
  return document.steps.map((step) => ({ id: step.id, title: step.title }));
}

/**
 * The guides listed under "À lire ensuite": the `related` slugs that exist in
 * this locale, in the author's order, stubs excluded (§5.7).
 */
export function relatedGuides<T extends GuideDocument>(documents: readonly T[], document: T): T[] {
  return document.related.flatMap((slug) => {
    const target = findGuide(documents, slug, document.locale);
    return target && target.status === "full" && target.slug !== document.slug ? [target] : [];
  });
}

/** The neighbours of a guide in the sorted list of its locale. */
export function prevNextOf<T extends GuideDocument>(
  documents: readonly T[],
  document: T,
): { previous: T | null; next: T | null } {
  const list = guidesForLocale(documents, document.locale);
  const index = list.findIndex((candidate) => candidate.slug === document.slug);
  return {
    previous: index > 0 ? list[index - 1] : null,
    next: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
  };
}
