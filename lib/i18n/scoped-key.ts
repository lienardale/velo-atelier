import type { Namespace } from "./namespaces";

/** A translator bound to ONE namespace, called with a key relative to it. */
export type ScopedTranslator = (key: string, values?: Record<string, string | number>) => string;

/** The namespaces a call site can resolve, each with its own bound translator. */
export type ScopedTranslators = Readonly<Partial<Record<Namespace, ScopedTranslator>>>;

/**
 * Resolve a FULLY QUALIFIED message key — `errors.invalidCredentials`,
 * `bike.errors.fitRange`, `parts.attr.speeds.label` — with translators that are
 * each bound to a single, literal namespace.
 *
 * Why not a root translator (`useTranslations()`)? Because it can reach the
 * whole catalogue, so nothing static can say which namespaces the component
 * needs, and `tests/unit/i18n/client-namespaces.test.ts` has to charge its route
 * all of them (`.debug/008`). Keys chosen at runtime — a server action's
 * `fieldErrors`, a part definition's `labelKey` — are always one of a known set
 * of namespaces; naming that set once, in `useTranslations("…")` literals the
 * test can read, is what lets the route declare it instead of everything.
 *
 * The first segment picks the translator and the rest is looked up inside it.
 * A key whose namespace is not in `translators` is handed, unchanged, to the
 * FIRST translator: next-intl then reports `MISSING_MESSAGE` through its
 * `onError` and renders the fallback — the same visible degradation as any
 * missing message, never a throw and never a silently blank label.
 * `useDecisionText()` (`components/decision-tree/decision-text.ts`) is the
 * one-namespace version of the same idea.
 */
export function translateScopedKey(
  key: string,
  translators: ScopedTranslators,
  values?: Record<string, string | number>,
): string {
  const dot = key.indexOf(".");
  if (dot > 0) {
    const namespace = key.slice(0, dot);
    if (Object.hasOwn(translators, namespace)) {
      const translate = translators[namespace as Namespace];
      if (translate) return translate(key.slice(dot + 1), values);
    }
  }
  const fallback = Object.values(translators)[0];
  if (fallback === undefined) {
    throw new Error("translateScopedKey: no translator given");
  }
  return fallback(key, values);
}
