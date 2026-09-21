/**
 * `BuildListItem.chosenProduct`'s link rule (§4.4), in ONE place: the guest
 * import applies it on the way in (`lib/guest/schema.ts`, the only writer
 * besides the seed) and every reader applies it on the way out — the `/liste`
 * loader and the guest list's parser. The `Json` column and
 * `va:buildlist:<ref>` hold what some earlier version of the app (or a
 * visitor's own DevTools) put there, and "the writer checked" is not a
 * property a reader can see. A product that fails is dropped, not repaired.
 *
 * The rule: https, no credentials, and on the named retailer's own hosts —
 * or `vendor: 'other'`, a link the visitor pasted, where plain https is the
 * only bar. §4.2 types the vendor `RetailerId | 'other'`, so a vendor that is
 * neither is refused rather than treated as `other`: before W4 both sides let
 * any unknown vendor through with any https link.
 *
 * Plain TS, no zod: `components/build-list/BuildList.tsx` is a client module,
 * and so is everything it imports.
 */
import { isRetailerId, isRetailerUrl } from "@/lib/domain/data/retailers";
import type { ChosenProduct } from "@/lib/checkup/types";

/** The vendor of a link the visitor pasted themselves (§4.4). */
export const OTHER_VENDOR = "other";

/** The field caps of the guest import's `ChosenProductSchema`. */
const LIMITS = { brand: 80, model: 120, size: 40, vendor: 40, url: 1000 } as const;

/** `https://…` and nothing else: never `javascript:`, never a credentialed URL. */
export function isPlainHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "";
}

/**
 * Does `product` link where its vendor says it does? Checked as a pair: a
 * product claiming `vendor: "rosebikes"` and pointing somewhere that is not
 * Rose is exactly the case worth refusing.
 */
export function isAllowedProductUrl(product: { vendor: string; url: string }): boolean {
  if (!isPlainHttpsUrl(product.url)) return false;
  if (isRetailerId(product.vendor)) return isRetailerUrl(product.vendor, product.url);
  return product.vendor === OTHER_VENDOR;
}

/** A stored value, as a `ChosenProduct` — or `undefined` when it is not one we would have written. */
export function chosenProductOf(value: unknown): ChosenProduct | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const product: Record<string, string> = {};
  for (const [field, max] of Object.entries(LIMITS)) {
    // eslint-disable-next-line security/detect-object-injection -- `field` iterates the literal LIMITS table
    const entry = record[field];
    if (typeof entry !== "string" || entry.length > max) return undefined;
    // eslint-disable-next-line security/detect-object-injection -- as above
    product[field] = entry;
  }
  const chosen = product as unknown as ChosenProduct;
  return isAllowedProductUrl(chosen) ? chosen : undefined;
}
