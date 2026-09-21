/**
 * §4.4 on the READ side: a stored `chosenProduct` whose link does not go where
 * its vendor says is dropped by every reader (the `/liste` page's loader and
 * the guest list's parser), the same rule the guest import applies on write.
 */
import { describe, expect, it } from "vitest";

import { chosenProductOf, isAllowedProductUrl } from "./chosen-product";

const PRODUCT = {
  brand: "Shimano",
  model: "CN-HG601",
  size: "11v",
  vendor: "alltricks",
  url: "https://www.alltricks.fr/C-40598-toutes-les-chaines",
};

describe("chosenProductOf", () => {
  it("keeps a product on its retailer's own host, and one the visitor pasted", () => {
    expect(chosenProductOf(PRODUCT)).toEqual(PRODUCT);
    expect(chosenProductOf({ ...PRODUCT, vendor: "other", url: "https://example.org/x" })).toEqual({
      ...PRODUCT,
      vendor: "other",
      url: "https://example.org/x",
    });
  });

  it.each([
    ["a retailer named, another host", { vendor: "alltricks", url: "https://evil.example/x" }],
    ["a look-alike suffix host", { url: "https://www.alltricks.fr.evil.example/x" }],
    ["plain http", { url: "http://www.alltricks.fr/C-40598" }],
    ["a script URL", { vendor: "other", url: "javascript:alert(1)" }],
    ["credentials in the URL", { vendor: "other", url: "https://user:pw@example.org/" }],
    ["not a URL", { vendor: "other", url: "nope" }],
  ])("drops %s", (_label, overrides) => {
    expect(chosenProductOf({ ...PRODUCT, ...overrides })).toBeUndefined();
  });

  it("drops a value that is not one we would have written", () => {
    expect(chosenProductOf(null)).toBeUndefined();
    expect(chosenProductOf([PRODUCT])).toBeUndefined();
    expect(chosenProductOf({ ...PRODUCT, model: 42 })).toBeUndefined();
    expect(chosenProductOf({ ...PRODUCT, model: "x".repeat(121) })).toBeUndefined();
    expect(
      chosenProductOf({ brand: "a", model: "b", vendor: "other", url: "https://a.b" }),
    ).toBeUndefined();
  });

  it("returns exactly the five fields, nothing the row carried besides", () => {
    expect(Object.keys(chosenProductOf({ ...PRODUCT, admin: true })!).sort()).toEqual([
      "brand",
      "model",
      "size",
      "url",
      "vendor",
    ]);
  });
});

describe("isAllowedProductUrl", () => {
  it("is the pair check: vendor and host together", () => {
    expect(isAllowedProductUrl(PRODUCT)).toBe(true);
    expect(isAllowedProductUrl({ vendor: "decathlon", url: PRODUCT.url })).toBe(false);
  });
});
