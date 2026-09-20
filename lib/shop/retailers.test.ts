/**
 * The shop's content accessors (§5.5).
 *
 * The YAML's own structure is already held by
 * `tests/unit/content/parts-legal-shop.test.ts` (both locales, real part ids,
 * the three retailers). What is checked here is the READER: that it turns the
 * file into what `/acheter` renders, that it drops what it cannot use instead
 * of shipping a half-built card, and that every category produces three live
 * outbound URLs.
 */
import { describe, expect, it } from "vitest";

import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { isPartId } from "@/lib/domain/data/parts";
import { routing } from "@/lib/i18n/routing";

import { outboundUrl } from "./outbound";
import { BRAND_TIERS } from "./questions";
import {
  BRANDS,
  brandsFor,
  brandTiersFor,
  categoryForPart,
  findCategory,
  SHOP_CATEGORIES,
} from "./retailers";

void BIKE_PRESETS;

describe("SHOP_CATEGORIES", () => {
  it("is the grid §5.5 asks for: at least 8 categories, each on three retailers", () => {
    expect(SHOP_CATEGORIES.length).toBeGreaterThanOrEqual(8);
    for (const category of SHOP_CATEGORIES) {
      expect(category.retailers).toEqual(["rosebikes", "alltricks", "decathlon"]);
    }
  });

  it("has unique kebab-case ids that can become message-key segments", () => {
    const ids = SHOP_CATEGORIES.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("names only real parts, main part first", () => {
    for (const category of SHOP_CATEGORIES) {
      expect(category.partIds.length).toBeGreaterThan(0);
      for (const partId of category.partIds) expect(isPartId(partId)).toBe(true);
    }
  });

  it("carries a label, a hint and a query in both locales", () => {
    for (const category of SHOP_CATEGORIES) {
      for (const locale of routing.locales) {
        expect(category.label[locale].length, `${category.id}.label.${locale}`).toBeGreaterThan(0);
        expect(category.hint[locale].length, `${category.id}.hint.${locale}`).toBeGreaterThan(0);
        expect(category.query[locale].length, `${category.id}.query.${locale}`).toBeGreaterThan(0);
      }
    }
  });

  it("produces three https links per card, in both locales", () => {
    for (const category of SHOP_CATEGORIES) {
      for (const locale of routing.locales) {
        for (const retailer of category.retailers) {
          const url = outboundUrl(retailer, locale, category.query[locale], category.partIds[0]);
          expect(new URL(url).protocol, `${category.id}/${retailer}/${locale}`).toBe("https:");
        }
      }
    }
  });

  it("finds a card by id, and the first card that sells a part", () => {
    expect(findCategory("chains")?.partIds).toContain("chain");
    expect(findCategory("nope")).toBeUndefined();
    expect(categoryForPart("chain")?.id).toBe("chains");
    expect(categoryForPart("brake-pads-rear")?.id).toBe("brake-pads");
    expect(categoryForPart("frame")).toBeUndefined();
  });
});

describe("BRANDS", () => {
  it("covers only real parts, each with three non-empty tiers", () => {
    expect(Object.keys(BRANDS).length).toBeGreaterThan(0);
    for (const [partId, brands] of Object.entries(BRANDS)) {
      expect(isPartId(partId)).toBe(true);
      for (const tier of BRAND_TIERS) {
        expect(brands!.tiers[tier].length, `${partId}.${tier}`).toBeGreaterThan(0);
      }
    }
  });

  it("carries the note in both locales", () => {
    for (const [partId, brands] of Object.entries(BRANDS)) {
      for (const locale of routing.locales) {
        expect(brands!.note[locale].length, `${partId}.note.${locale}`).toBeGreaterThan(0);
      }
    }
  });

  it("answers `null` for a part with no tier advice, and for a prototype key", () => {
    expect(brandsFor("chain")).not.toBeNull();
    expect(brandsFor("frame")).toBeNull();
    expect(brandsFor("__proto__")).toBeNull();
    expect(brandsFor("constructor")).toBeNull();
  });

  it("flattens to the one locale a client component needs", () => {
    const flat = brandTiersFor("chain", "en");
    expect(flat?.note).toBe(brandsFor("chain")!.note.en);
    expect(flat?.tiers.mid).toEqual(brandsFor("chain")!.tiers.mid);
    expect(brandTiersFor("frame", "en")).toBeNull();
  });
});
