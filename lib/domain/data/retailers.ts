/**
 * The three retailers the buying guide links to (§2.5), per locale.
 *
 * No scraping, no affiliate id, no click tracking: plain outbound links a human
 * has opened. `verifiedAt` is the date of that human check, `null` while it is
 * still pending (the shop page then says "lien non vérifié récemment", §5.5);
 * the checklist and the log of what was checked live in `docs/retailers.md`.
 *
 *   Rose Bikes  search template in both locales — the FR template was verified
 *               by hand on 2026-09-07 (§2.5); both templates answered with a
 *               search-results page to an automated check on 2026-09-13.
 *   Alltricks   category pages (its search is not a stable URL). The FR
 *               category URLs were found through a web search of alltricks.fr
 *               on 2026-09-13 and are unverified by hand; EN falls back to
 *               the home page.
 *   Decathlon   search template (`?Ntt=`); the site refuses automated requests
 *               (HTTP 403), so it stays unverified until a human opens it.
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
    verifiedAt: "2026-09-07",
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
      en: { kind: "category", byPartId: {}, fallback: "https://www.alltricks.com/" },
    },
    verifiedAt: null,
  },
  decathlon: {
    id: "decathlon",
    labelKey: "parts.retailers.decathlon",
    byLocale: {
      fr: { kind: "search", template: "https://www.decathlon.fr/search?Ntt={q}" },
      en: { kind: "search", template: "https://www.decathlon.co.uk/search?Ntt={q}" },
    },
    verifiedAt: null,
  },
};
