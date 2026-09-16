/**
 * The domain's own message lookup (§2): `messages/<locale>/{parts,decision}.json`,
 * imported directly, with an explicit `locale` argument.
 *
 * The domain is plain TypeScript with no next-intl: the buying guide builds
 * search queries and constraint sentences that are **data** (a URL, a string
 * stored on a build-list item), not UI, so it resolves its own strings. React
 * components keep using `useTranslations()` / `getTranslations()`.
 *
 * Placeholders are the plain `{name}` form only — every key this module reads
 * uses no plural or select, and `tests/unit/i18n/messages-parity.test.ts`
 * keeps the placeholder sets identical across locales.
 *
 * A key that does not resolve comes back as the key itself (what next-intl
 * shows too), so a missing string degrades the page rather than crashing it;
 * the parity and key-resolution tests are what keep that from shipping.
 */
import enDecision from "../../messages/en/decision.json";
import enParts from "../../messages/en/parts.json";
import frDecision from "../../messages/fr/decision.json";
import frParts from "../../messages/fr/parts.json";

import type { RetailerLocale } from "./schema/retailer";

/** The locales the domain can speak (structurally `Locale` from `lib/i18n/routing.ts`). */
export type DomainLocale = RetailerLocale;

const CATALOGUES: Record<DomainLocale, Record<string, unknown>> = {
  fr: { parts: frParts, decision: frDecision },
  en: { parts: enParts, decision: enDecision },
};

/** The raw string at `key`, or `undefined`. Own keys only. */
export function lookupMessage(locale: DomainLocale, key: string): string | undefined {
  // eslint-disable-next-line security/detect-object-injection -- `locale` is a DomainLocale, a key of CATALOGUES
  let current: unknown = CATALOGUES[locale];
  for (const segment of key.split(".")) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn above
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : undefined;
}

/** Resolve `key` and fill `{name}` placeholders; unknown keys come back verbatim. */
export function domainMessage(
  locale: DomainLocale,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const template = lookupMessage(locale, key) ?? key;
  const known = new Map(Object.entries(values));
  return template.replace(/\{([a-zA-Z]+)\}/g, (placeholder, name: string) =>
    known.has(name) ? String(known.get(name)) : placeholder,
  );
}

/** `parts.<id>.label`. */
export function partLabel(locale: DomainLocale, partId: string): string {
  return domainMessage(locale, `parts.${partId}.label`);
}

/** `parts.attr.<key>.label`. */
export function attributeLabel(locale: DomainLocale, key: string): string {
  return domainMessage(locale, `parts.attr.${key}.label`);
}

/**
 * `parts.values.<key>.<value>` for an enum value, `parts.boolean.<true|false>`
 * for a yes/no, else the value with its unit (`parts.units.<unit>`), else the
 * bare value.
 */
export function valueLabel(
  locale: DomainLocale,
  key: string,
  value: string | number | boolean,
  unit?: string,
): string {
  const label = lookupMessage(locale, `parts.values.${key}.${String(value)}`);
  if (label !== undefined) return label;
  if (typeof value === "boolean") return domainMessage(locale, `parts.boolean.${String(value)}`);
  if (unit !== undefined)
    return domainMessage(locale, `parts.units.${unit}`, { value: String(value) });
  return String(value);
}
