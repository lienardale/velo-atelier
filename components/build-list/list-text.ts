"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { translateScopedKey, type ScopedTranslator } from "@/lib/i18n/scoped-key";

/** `t(key)` over the FULLY QUALIFIED keys a build-list line carries. */
export type ListText = (key: string) => string;

/**
 * The translator for the message keys a build-list line carries at runtime:
 * the finding's reason (`guides.reasons.<reasonKey>`, §5.4) and a refinement's
 * compatibility issue (`rules.<group>.{message,fix}`, `checkCompatibility`).
 *
 * Both are chosen by data, not written as literals, so rendering them used to
 * take a root translator — which can read the whole catalogue, so
 * `tests/unit/i18n/client-namespaces.test.ts` had to charge `/velo/[id]/liste`
 * all sixteen namespaces. Pinned here to the two namespaces those keys can come
 * from, in literals the test can read, the route declares what it renders
 * instead. A key from any other namespace is reported by next-intl as missing
 * rather than resolved somewhere else (`translateScopedKey`), exactly like
 * `usePartsText()` and `useBikeActionText()` (`components/bike/`).
 */
export function useListText(): ListText {
  const guides = useTranslations("guides") as unknown as ScopedTranslator;
  const rules = useTranslations("rules") as unknown as ScopedTranslator;
  return useCallback<ListText>(
    (key) => translateScopedKey(key, { guides, rules }),
    [guides, rules],
  );
}
