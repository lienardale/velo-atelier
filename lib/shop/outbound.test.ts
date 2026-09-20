/**
 * Outbound links (§5.8 AC5).
 *
 * The two URLs of the acceptance criterion are asserted here **character for
 * character**, encoding included: they are the contract between the query
 * builder, the retailer table and `encodeURIComponent`, and a change to any of
 * the three shows up as a different string rather than as a shop that answers
 * "no results".
 */
import { describe, expect, it } from "vitest";

import { RETAILERS, RETAILER_ORDER } from "@/lib/domain/data/retailers";
import { buildSearchUrl } from "@/lib/domain/schema/retailer";
import { routing } from "@/lib/i18n/routing";

import { buildQuery } from "./query";
import {
  isRetailerVerified,
  outboundLinkAttributes,
  outboundUrl,
  OUTBOUND_REL,
  OUTBOUND_TARGET,
  retailerLabelKey,
  retailerTarget,
  retailerVerifiedAt,
  SHOP_RETAILERS,
} from "./outbound";

const CASSETTE = { speeds: 11, range: "11-34", freehub: "hg" } as const;

describe("§5.8 AC5 — the pinned URLs", () => {
  it("is the French Rose Bikes search, encoded", () => {
    expect(outboundUrl("rosebikes", "fr", buildQuery("cassette", CASSETTE, "fr"))).toBe(
      "https://www.rosebikes.fr/search?q=cassette%2011%20vitesses%2011-34%20hg",
    );
  });

  it("is the English one, with `speed` where French says `vitesses`", () => {
    const url = outboundUrl("rosebikes", "en", buildQuery("cassette", CASSETTE, "en"));
    expect(url).toBe("https://www.rosebikes.com/search?q=cassette%2011%20speed%2011-34%20hg");
    expect(url).toContain("%2011%20speed");
  });
});

describe("outboundUrl", () => {
  it("encodes the query and never the template", () => {
    const url = outboundUrl("decathlon", "fr", "chaîne 11 vitesses");
    expect(url).toBe("https://www.decathlon.fr/search?Ntt=cha%C3%AEne%2011%20vitesses");
    expect(url.startsWith("https://www.decathlon.fr/search?Ntt=")).toBe(true);
  });

  it("keeps a & or a # out of the query string", () => {
    const url = new URL(outboundUrl("rosebikes", "fr", "chain & cassette #11"));
    expect(url.searchParams.get("q")).toBe("chain & cassette #11");
    expect(url.search).toBe("?q=chain%20%26%20cassette%20%2311");
  });

  it("gives a category retailer the page for the part", () => {
    expect(outboundUrl("alltricks", "fr", "chaîne", "chain")).toBe(
      "https://www.alltricks.fr/C-40598-toutes-les-chaines",
    );
    expect(outboundUrl("alltricks", "fr", "plaquettes", "brake-pads-rear")).toBe(
      "https://www.alltricks.fr/C-372000-toutes-les-plaquettes",
    );
  });

  it("falls back to the shop's own components page for a part it does not list", () => {
    expect(outboundUrl("alltricks", "fr", "selle", "saddle")).toBe(
      "https://www.alltricks.fr/C-1239709-composants-de-velo",
    );
    // No partId at all is the same case: there is nothing to look up.
    expect(outboundUrl("alltricks", "fr", "selle")).toBe(
      "https://www.alltricks.fr/C-1239709-composants-de-velo",
    );
  });

  it("never invents a category from a prototype key", () => {
    expect(outboundUrl("alltricks", "fr", "x", "constructor")).toBe(
      "https://www.alltricks.fr/C-1239709-composants-de-velo",
    );
    expect(outboundUrl("alltricks", "fr", "x", "__proto__")).toBe(
      "https://www.alltricks.fr/C-1239709-composants-de-velo",
    );
  });

  it("agrees with the domain's own `buildSearchUrl`, which loads zod", () => {
    // The two spellings exist so the client bundle does not have to carry a
    // parser (see the module header); this is what keeps them the same.
    for (const retailer of RETAILER_ORDER) {
      for (const locale of routing.locales) {
        for (const partId of ["chain", "saddle", undefined]) {
          const query = "chaîne 11 vitesses";
          expect(outboundUrl(retailer, locale, query, partId)).toBe(
            buildSearchUrl(retailerTarget(retailer, locale), query, partId),
          );
        }
      }
    }
  });

  it("only ever produces https", () => {
    for (const retailer of RETAILER_ORDER) {
      for (const locale of routing.locales) {
        expect(new URL(outboundUrl(retailer, locale, "x", "chain")).protocol).toBe("https:");
      }
    }
  });
});

describe("the link contract", () => {
  it("is exactly the rel and target §5.8 AC5 pins", () => {
    expect(OUTBOUND_TARGET).toBe("_blank");
    expect(OUTBOUND_REL).toBe("noopener noreferrer nofollow");
    expect(outboundLinkAttributes()).toEqual({
      target: "_blank",
      rel: "noopener noreferrer nofollow",
    });
  });

  it("orders the three shops the way the domain does", () => {
    expect(SHOP_RETAILERS).toEqual(["rosebikes", "alltricks", "decathlon"]);
  });

  it("names each shop through a `parts.retailers.<id>` key", () => {
    for (const retailer of SHOP_RETAILERS) {
      expect(retailerLabelKey(retailer)).toBe(`parts.retailers.${retailer}`);
    }
  });
});

describe("verification (§5.5 — the 'lien non vérifié récemment' note)", () => {
  it("reports what the retailer table actually carries today", () => {
    // (verify) in the plan: recorded here so a hand-check that lands later is a
    // visible diff, and so the shop page's note is driven by data, not by hope.
    expect(retailerVerifiedAt("rosebikes")).toBe("2026-09-07");
    expect(retailerVerifiedAt("alltricks")).toBeNull();
    expect(retailerVerifiedAt("decathlon")).toBeNull();
    expect(isRetailerVerified("rosebikes")).toBe(true);
    expect(isRetailerVerified("alltricks")).toBe(false);
    expect(isRetailerVerified("decathlon")).toBe(false);
  });

  it("reads the dates from the domain table rather than repeating them", () => {
    for (const retailer of SHOP_RETAILERS) {
      expect(retailerVerifiedAt(retailer)).toBe(RETAILERS[retailer].verifiedAt);
    }
  });
});
