"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { translateScopedKey, type ScopedTranslator } from "@/lib/i18n/scoped-key";

/** `t(key)` over the message KEYS a bike write answers with. */
export type BikeActionText = (key: string) => string;

/**
 * The translator for what a bike write returns — `updateBikePartAction`,
 * `updateBikeFitAction`, the guest repo in `lib/bike/repo.ts`, the garage's
 * rename and delete.
 *
 * Those answer with an `ActionResult` whose messages are KEYS chosen at runtime
 * (§1.2): the headline is `errors.<code>` and a field message is
 * `bike.errors.<reason>` (`fitRange`, `storageFull`, `nameTooLong`, the domain's
 * `setAttribute` refusals). Rendering them used to take a root translator, which
 * can read the whole catalogue — so every route with one of these forms had to
 * ship all of it. Pinned here to the two namespaces those keys can come from,
 * in literals `tests/unit/i18n/client-namespaces.test.ts` can read, the routes
 * declare `bike` and `errors` instead.
 *
 * A key from any other namespace is reported by next-intl as missing rather
 * than resolved somewhere else (`translateScopedKey`). The function is stable
 * for as long as the two translators are.
 */
export function useBikeActionText(): BikeActionText {
  const errors = useTranslations("errors") as unknown as ScopedTranslator;
  const bike = useTranslations("bike") as unknown as ScopedTranslator;
  return useCallback<BikeActionText>(
    (key) => translateScopedKey(key, { errors, bike }),
    [errors, bike],
  );
}
