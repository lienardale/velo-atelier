"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

/** `t(key)` over the FULLY QUALIFIED keys the decision data carries. */
export type DecisionText = (key: string, values?: Record<string, string>) => string;

const PREFIX = "decision.";

/**
 * The decision tree's translator, pinned to the `decision` namespace.
 *
 * The tree's strings are addressed by keys the data carries, not by literals:
 * `node.titleKey`, `option.labelKey`, `node.help.textKey`, and the
 * `decision.<question>.options.<option>.label` the summary builds. Every one of
 * them is `decision.…` — `lib/domain/data/decision-tree.ts` derives them from
 * the question and option ids, and `validateDecisionTree` fails the build if a
 * single one has another shape.
 *
 * Reading them used to mean `useTranslations()` with no namespace, i.e. the
 * WHOLE catalogue, cast through `as unknown as` to get past the typed keys.
 * That is what made `NextIntlClientProvider` unable to ship anything less than
 * all thirteen namespaces to every page: no static check can tell which part of
 * the catalogue a `t(node.titleKey)` will touch. Naming the namespace here —
 * once, in a literal `tests/unit/i18n/client-namespaces.test.ts` can read —
 * is what lets the home route declare three namespaces instead of thirteen
 * (`.debug/008`).
 *
 * A key that is not a `decision.` key is passed through unchanged: next-intl
 * then resolves it inside the namespace, does not find it, and renders the key
 * — the same degradation as before, never a throw.
 *
 * The returned function is stable for as long as the translator is (use-intl
 * memoises it per namespace), so it is safe in a dependency array.
 */
export function useDecisionText(): DecisionText {
  const t = useTranslations("decision") as unknown as DecisionText;
  return useCallback<DecisionText>(
    (key, values) => t(key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key, values),
    [t],
  );
}
