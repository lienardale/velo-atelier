/**
 * `Localized<T>` — a value written once per locale.
 *
 * Used ONLY for data that lives in `content/**` YAML (brand tiers, shop
 * categories), where a translator edits both languages side by side. TypeScript
 * data never carries prose: it carries message keys and lets next-intl
 * translate (`parts.<id>.label`, `rules.<id>.message`, …).
 */
/* eslint-disable security/detect-object-injection -- every index is a `Locale` from routing.locales, never user input */
import { routing, type Locale } from "./routing";

export type Localized<T> = { readonly [L in Locale]: T };

/** The value for `locale`. */
export function pickLocalized<T>(value: Localized<T>, locale: Locale): T {
  return value[locale];
}

/**
 * Whether `value` is an object with one entry per locale, each accepted by
 * `isValue`. A plain guard (no zod) so client code can use it too; the content
 * schemas validate the same shape with zod at build time.
 */
export function isLocalized<T>(
  value: unknown,
  isValue: (entry: unknown) => entry is T,
): value is Localized<T> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === routing.locales.length &&
    routing.locales.every((locale) => Object.hasOwn(record, locale) && isValue(record[locale]))
  );
}
