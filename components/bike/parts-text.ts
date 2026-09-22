"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { translateScopedKey, type ScopedTranslator } from "@/lib/i18n/scoped-key";

/** `t(key)` over the FULLY QUALIFIED `parts.*` keys the part catalogue carries. */
export type PartsText = (key: string, values?: Record<string, string | number>) => string;

/**
 * The part catalogue's translator, pinned to the `parts` namespace.
 *
 * A `PartDefinition` names its strings by key — an attribute's `labelKey` is
 * `parts.attr.<key>.label` (`lib/domain/data/parts/define.ts`) — so the panel
 * cannot write them as literals. Resolving them with a root translator made the
 * `/velo` routes ship every namespace in the catalogue; this is
 * `useDecisionText()`'s answer to the same problem for the decision tree
 * (`.debug/008`): one literal namespace, the keys resolved inside it.
 */
export function usePartsText(): PartsText {
  const parts = useTranslations("parts") as unknown as ScopedTranslator;
  return useCallback<PartsText>(
    (key, values) => translateScopedKey(key, { parts }, values),
    [parts],
  );
}
