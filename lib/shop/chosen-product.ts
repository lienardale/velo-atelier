/**
 * `BuildListItem.chosenProduct` on the way OUT of storage (§4.4).
 *
 * The rule — https, no credentials, and on the named retailer's own hosts
 * unless the vendor is not one of ours — is enforced where the value is written
 * (`lib/guest/schema.ts`, the only writer besides the seed). This is the same
 * rule where it is READ: the `Json` column and `va:buildlist:<ref>` hold what
 * some earlier version of the app (or a visitor's own DevTools) put there, and
 * "the writer checked" is not a property a reader can see. A product that
 * fails is dropped, not repaired.
 *
 * Plain TS, no zod: `components/build-list/BuildList.tsx` is a client module,
 * and so is everything it imports.
 */
import { isRetailerId, isRetailerUrl } from "@/lib/domain/data/retailers";
import type { ChosenProduct } from "@/lib/checkup/types";

/** The field caps of the guest import's `ChosenProductSchema`. */
const LIMITS = { brand: 80, model: 120, size: 40, vendor: 40, url: 1000 } as const;

function isPlainHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "";
}

/** Does `product` link where its vendor says it does? */
export function isAllowedProductUrl(product: { vendor: string; url: string }): boolean {
  if (!isPlainHttpsUrl(product.url)) return false;
  return isRetailerId(product.vendor) ? isRetailerUrl(product.vendor, product.url) : true;
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
