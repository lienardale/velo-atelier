/**
 * Retailers (§2.5) — where a "you need a new one" ends up.
 *
 * Three shops, per locale, with **human-verified** URLs: no scraping, no
 * affiliate ids, no click tracking. Some shops expose a search endpoint we can
 * fill in (`{q}`), others only category pages, so a locale entry is one of the
 * two kinds. `verifiedAt` is the date a human last opened the links and
 * confirmed they still land where they should (`docs/retailers.md`).
 */
import * as z from "zod";

import { ID_PATTERN } from "../data/conventions";

export const RETAILER_IDS = ["rosebikes", "alltricks", "decathlon"] as const;

export type RetailerId = (typeof RETAILER_IDS)[number];

/**
 * The locales a retailer entry covers. Structurally the same union as
 * `Locale` from `lib/i18n/routing.ts`; declared here so `lib/domain` needs no
 * import from the i18n layer (`schema.test.ts` asserts the two agree).
 */
export const RETAILER_LOCALES = ["fr", "en"] as const;

export type RetailerLocale = (typeof RETAILER_LOCALES)[number];

/** A search URL with exactly one `{q}` placeholder. */
export interface RetailerSearchTarget {
  kind: "search";
  template: `${string}{q}${string}`;
}

/** A shop that only has category pages: one per part when we know it, plus a fallback. */
export interface RetailerCategoryTarget {
  kind: "category";
  byPartId: Partial<Record<string, string>>;
  fallback: string;
}

export type RetailerTarget = RetailerSearchTarget | RetailerCategoryTarget;

export interface RetailerDef {
  id: RetailerId;
  /** `parts.retailers.<id>` */
  labelKey: string;
  byLocale: Record<RetailerLocale, RetailerTarget>;
  /** ISO date (`2026-09-07`), or `null` while the links are still unverified. */
  verifiedAt: string | null;
}

/** https only — an outbound link from this site is never plain http. */
const HttpsUrlSchema = z.string().regex(/^https:\/\/[^\s]+$/);

const SearchTargetSchema = z.strictObject({
  kind: z.literal("search"),
  template: HttpsUrlSchema.refine((value) => value.split("{q}").length === 2, {
    message: "a search template contains {q} exactly once",
  }),
});

const CategoryTargetSchema = z.strictObject({
  kind: z.literal("category"),
  byPartId: z.partialRecord(z.string().regex(ID_PATTERN), HttpsUrlSchema),
  fallback: HttpsUrlSchema,
});

export const RetailerTargetSchema = z.union([SearchTargetSchema, CategoryTargetSchema]);

export const RetailerDefSchema = z.strictObject({
  id: z.enum(RETAILER_IDS),
  labelKey: z.string().min(1),
  byLocale: z.record(z.enum(RETAILER_LOCALES), RetailerTargetSchema),
  verifiedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

/**
 * Build the outbound URL for a query.
 *
 * `encodeURIComponent` on the query, never on the template: the template is our
 * own data, the query is built from part labels and attribute values.
 */
export function buildSearchUrl(target: RetailerTarget, query: string, partId?: string): string {
  if (target.kind === "search") {
    return target.template.replace("{q}", encodeURIComponent(query));
  }
  // eslint-disable-next-line security/detect-object-injection -- reads our own category table; a miss falls through to the fallback
  const byPart = partId === undefined ? undefined : target.byPartId[partId];
  return byPart ?? target.fallback;
}
