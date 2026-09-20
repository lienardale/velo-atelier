/**
 * The retailer host allow-list (§4.4).
 *
 * A `chosenProduct` arrives from the guest import — user-supplied data — and
 * `lib/guest/schema.ts` refuses one whose link is not on the host of the
 * retailer it names. The host set is DERIVED from `RETAILERS` rather than
 * written down twice, so these tests hold the derivation, not a list.
 */
import { describe, expect, it } from "vitest";

import {
  isRetailerId,
  isRetailerUrl,
  retailerHosts,
  RETAILER_ORDER,
  RETAILERS,
} from "@/lib/domain/data/retailers";

describe("retailerHosts", () => {
  it("covers every URL the retailer's own targets can produce, and nothing else", () => {
    for (const id of RETAILER_ORDER) {
      const hosts = retailerHosts(id);
      expect(hosts.length, id).toBeGreaterThan(0);
      expect([...hosts], id).toEqual([...hosts].sort());

      // Every declared target's host is in the set — search templates and
      // category URLs alike, so a new locale or a new per-part URL is covered
      // the moment it is added.
      for (const target of Object.values(RETAILERS[id].byLocale)) {
        const urls =
          target.kind === "search"
            ? [target.template.replace("{q}", "chaine")]
            : [target.fallback, ...Object.values(target.byPartId)];
        for (const url of urls) {
          if (url === undefined) continue;
          expect(hosts, `${id} ${url}`).toContain(new URL(url).host);
        }
      }
    }
  });

  it("does not leak one retailer's hosts into another's", () => {
    expect(retailerHosts("rosebikes")).not.toContain("www.alltricks.fr");
    expect(retailerHosts("decathlon")).not.toContain("www.rosebikes.com");
  });
});

describe("isRetailerUrl", () => {
  it("accepts the retailer's own https links", () => {
    expect(isRetailerUrl("rosebikes", "https://www.rosebikes.fr/search?q=chaine")).toBe(true);
    expect(isRetailerUrl("alltricks", "https://www.alltricks.fr/C-40598-toutes-les-chaines")).toBe(
      true,
    );
    expect(isRetailerUrl("decathlon", "https://www.decathlon.co.uk/search?Ntt=chain")).toBe(true);
  });

  it("refuses another host, another retailer, a suffix and an unknown subdomain", () => {
    expect(isRetailerUrl("alltricks", "https://evil.example/chain")).toBe(false);
    expect(isRetailerUrl("alltricks", "https://www.rosebikes.fr/search?q=chain")).toBe(false);
    // A substring check would pass this one.
    expect(isRetailerUrl("rosebikes", "https://www.rosebikes.fr.evil.example/x")).toBe(false);
    expect(isRetailerUrl("decathlon", "https://promo.decathlon.fr/x")).toBe(false);
  });

  it("refuses anything that is not https, and anything that is not a URL", () => {
    expect(isRetailerUrl("rosebikes", "http://www.rosebikes.fr/x")).toBe(false);
    expect(isRetailerUrl("rosebikes", "javascript:alert(1)")).toBe(false);
    // Unparseable: the guard returns false rather than throwing at the caller.
    expect(isRetailerUrl("rosebikes", "not a url at all")).toBe(false);
    expect(isRetailerUrl("rosebikes", "")).toBe(false);
  });
});

describe("isRetailerId", () => {
  it("is true for exactly the retailers this site links to", () => {
    for (const id of RETAILER_ORDER) expect(isRetailerId(id)).toBe(true);
    // `other` is the plan's escape hatch for a link the visitor pasted.
    expect(isRetailerId("other")).toBe(false);
    expect(isRetailerId("__proto__")).toBe(false);
    expect(isRetailerId("")).toBe(false);
  });
});
