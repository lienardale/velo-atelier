/**
 * Outbound links to the three retailers (§2.5, §5.5).
 *
 * One function, `outboundUrl`, and two constants that every `<a>` leaving this
 * site carries. There is no affiliate id, no redirect hop and no click beacon:
 * the visitor goes straight to the shop, and the only thing we put in the URL
 * is the search terms they can read in the link's own label.
 *
 *   outboundUrl("rosebikes", "fr", "cassette 11 vitesses 11-34 hg")
 *   → "https://www.rosebikes.fr/search?q=cassette%2011%20vitesses%2011-34%20hg"
 *
 * Two kinds of target, because the shops differ (`lib/domain/data/retailers.ts`):
 * a `search` retailer takes the query in its own template, a `category` one has
 * no stable search URL and gets the category page for the part (its fallback
 * page when the part is not one it lists).
 *
 * ## Why this does not call `buildSearchUrl`
 *
 * `lib/domain/schema/retailer.ts` exports the same one-line template fill, but
 * that module loads zod to validate the retailer table at build time. This one
 * is reachable from `<VendorButtons>` and `<VendorSearch>`, which are client
 * components: importing the schema module would put a copy of zod in the build
 * list's bundle for a `String.replace`. The domain's own barrel makes the same
 * cut — `export type *` for `schema/**`, values only from `data/**` and
 * `engine/**` — so this module imports the DATA table and the TYPES, and
 * nothing that parses. `lib/shop/outbound.test.ts` asserts the two spellings
 * agree, so they cannot drift.
 */
import { RETAILERS, RETAILER_ORDER } from "@/lib/domain/data/retailers";
import type { PartId } from "@/lib/domain/data/parts";
import type { RetailerDef, RetailerId, RetailerTarget } from "@/lib/domain/schema/retailer";
import type { Locale } from "@/lib/i18n/routing";

/**
 * Every outbound link opens in a new tab: the visitor is mid-task (a build
 * list, a checkup) and losing the page to a shop is losing the task.
 */
export const OUTBOUND_TARGET = "_blank";

/**
 * `noopener noreferrer` is the security pair (no `window.opener` handle back
 * into this origin, no referrer leak of which bike the visitor is fixing);
 * `nofollow` says these are not editorial endorsements. The exact string is
 * asserted by `components/shop/OutboundLink.test.tsx` and by
 * `tests/e2e/build-list.spec.ts` (§5.8 AC5, §6.8 AC7).
 */
export const OUTBOUND_REL = "noopener noreferrer nofollow";

/** The retailers, in display order (§2.5). */
export const SHOP_RETAILERS: readonly RetailerId[] = RETAILER_ORDER;

export function retailerDef(retailer: RetailerId): RetailerDef {
  // eslint-disable-next-line security/detect-object-injection -- `retailer` is a RetailerId, a key of our own table
  return RETAILERS[retailer];
}

/** `parts.retailers.<id>` — the shop's name, translated like any other domain label. */
export function retailerLabelKey(retailer: RetailerId): string {
  return retailerDef(retailer).labelKey;
}

/** What `retailer` offers in `locale`: a search template, or category pages. */
export function retailerTarget(retailer: RetailerId, locale: Locale): RetailerTarget {
  // eslint-disable-next-line security/detect-object-injection -- `locale` is a Locale, a key of `byLocale`
  return retailerDef(retailer).byLocale[locale];
}

/**
 * The date a human last opened this retailer's links and confirmed they still
 * land where they should, or `null` while that is still pending.
 * `docs/retailers.md` is the checklist; the shop page shows a note for `null`.
 */
export function retailerVerifiedAt(retailer: RetailerId): string | null {
  return retailerDef(retailer).verifiedAt;
}

/** Has a human opened this retailer's links? Drives the "lien non vérifié" note (§5.5). */
export function isRetailerVerified(retailer: RetailerId): boolean {
  return retailerVerifiedAt(retailer) !== null;
}

/**
 * Where "buy this part" goes.
 *
 * `encodeURIComponent` is applied to the QUERY and never to the template: the
 * template is our own data (https, `{q}` exactly once — the retailer schema
 * enforces both), while the query is assembled from part labels and attribute
 * values and is the only part of the URL a visitor's input can reach.
 *
 * `partId` only matters to a `category` retailer, which has no search endpoint:
 * it picks the category page for that part, or the shop's generic components
 * page when it has none.
 */
export function outboundUrl(
  retailer: RetailerId,
  locale: Locale,
  query: string,
  partId?: PartId | string,
): string {
  const target = retailerTarget(retailer, locale);
  if (target.kind === "search") return target.template.replace("{q}", encodeURIComponent(query));
  const byPart =
    partId === undefined || !Object.hasOwn(target.byPartId, partId)
      ? undefined
      : // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn above
        target.byPartId[partId];
  return byPart ?? target.fallback;
}

/** The `target`/`rel` pair, as props. Spread it; never retype the strings. */
export function outboundLinkAttributes(): { target: string; rel: string } {
  return { target: OUTBOUND_TARGET, rel: OUTBOUND_REL };
}
