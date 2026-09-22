/**
 * The three retailers the buying guide links to (§2.5), per locale.
 *
 * No scraping, no affiliate id, no click tracking: plain outbound links opened
 * in a real browser session. `verifiedAt` is the date of that check, `null`
 * while it is still pending (the shop page then says "lien non vérifié
 * récemment", §5.5); the checklist and the log of what was checked live in
 * `docs/retailers.md`. The 2026-09-21 pass covered every row of both locales.
 *
 *   Rose Bikes  search template in both locales (FR first verified 2026-09-07).
 *   Alltricks   category pages (its search is not a stable URL), the same map
 *               in both locales: chains, brake pads, and the components
 *               section for every other part. EN used to fall back to the home
 *               page, which the checklist refuses; on alltricks.com the
 *               brake-pad page's own canonical keeps the French slug.
 *   Decathlon   search template (`?Ntt=`); it refuses headless requests
 *               (HTTP 403), so only a real browser can verify it.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import type { RetailerDef, RetailerId } from "../schema/retailer";

/**
 * Display order. The same list as `RETAILER_IDS` in `schema/retailer.ts`,
 * restated here because that module loads zod and this one must not
 * (`buying-guide.test.ts` asserts the two agree).
 */
export const RETAILER_ORDER: readonly RetailerId[] = ["rosebikes", "alltricks", "decathlon"];

export const RETAILERS: Record<RetailerId, RetailerDef> = {
  rosebikes: {
    id: "rosebikes",
    labelKey: "parts.retailers.rosebikes",
    byLocale: {
      fr: { kind: "search", template: "https://www.rosebikes.fr/search?q={q}" },
      en: { kind: "search", template: "https://www.rosebikes.com/search?q={q}" },
    },
    verifiedAt: "2026-09-21",
  },
  alltricks: {
    id: "alltricks",
    labelKey: "parts.retailers.alltricks",
    byLocale: {
      fr: {
        kind: "category",
        byPartId: {
          chain: "https://www.alltricks.fr/C-40598-toutes-les-chaines",
          "brake-pads-front": "https://www.alltricks.fr/C-372000-toutes-les-plaquettes",
          "brake-pads-rear": "https://www.alltricks.fr/C-372000-toutes-les-plaquettes",
        },
        fallback: "https://www.alltricks.fr/C-1239709-composants-de-velo",
      },
      en: {
        kind: "category",
        byPartId: {
          chain: "https://www.alltricks.com/C-40598-chains",
          "brake-pads-front": "https://www.alltricks.com/C-372000-toutes-les-plaquettes",
          "brake-pads-rear": "https://www.alltricks.com/C-372000-toutes-les-plaquettes",
        },
        fallback: "https://www.alltricks.com/C-1239709-cycling-components",
      },
    },
    verifiedAt: "2026-09-21",
  },
  decathlon: {
    id: "decathlon",
    labelKey: "parts.retailers.decathlon",
    byLocale: {
      fr: { kind: "search", template: "https://www.decathlon.fr/search?Ntt={q}" },
      en: { kind: "search", template: "https://www.decathlon.co.uk/search?Ntt={q}" },
    },
    verifiedAt: "2026-09-21",
  },
};

/**
 * The hosts a retailer is allowed to send a visitor to, derived from its own
 * `byLocale` targets so the two can never drift.
 *
 * §4.4 requires a `chosenProduct.url` to be https AND on the host of the
 * retailer it names, unless the visitor typed their own link (`vendor: 'other'`).
 * A stored product is user-supplied data — it arrives through the guest import
 * (`lib/guest/schema.ts`) — so "rosebikes" must not be able to carry a link to
 * anywhere at all.
 *
 * Plain Node, no zod: this module is reachable from `prisma/seed.ts` and from
 * `zod/mini` client code alike.
 */
export function retailerHosts(retailer: RetailerId): readonly string[] {
  const urls: string[] = [];
  for (const target of Object.values(RETAILERS[retailer].byLocale)) {
    if (target.kind === "search") urls.push(target.template.replace("{q}", "x"));
    else
      urls.push(
        target.fallback,
        // `byPartId` is a Partial record: its values are `string | undefined`.
        ...Object.values(target.byPartId).filter((url): url is string => url !== undefined),
      );
  }
  const hosts = new Set<string>();
  for (const url of urls) {
    try {
      hosts.add(new URL(url).host);
    } catch {
      // A malformed template is the retailer schema's problem, not this one's.
    }
  }
  return [...hosts].sort();
}

/** Is `url` an https link on `retailer`'s own hosts? */
export function isRetailerUrl(retailer: RetailerId, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && retailerHosts(retailer).includes(parsed.host);
}

/** `true` when `vendor` names one of the retailers this site links to. */
export function isRetailerId(vendor: string): vendor is RetailerId {
  return (RETAILER_ORDER as readonly string[]).includes(vendor);
}
