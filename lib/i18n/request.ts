/**
 * next-intl request configuration — resolved by `createNextIntlPlugin(
 * './lib/i18n/request.ts')` in `next.config.ts`.
 *
 * The locale comes from the `[locale]` segment (`requestLocale`, a Promise in
 * next-intl v4) and falls back to the default locale when it is missing or not
 * one of `routing.locales` — `app/[locale]/layout.tsx` has already turned an
 * unknown locale into a 404 by then; the fallback covers requests outside the
 * `[locale]` tree (e.g. `app/global-error.tsx`).
 *
 * Messages are merged from one file per namespace (§1.2): every file listed in
 * `NAMESPACES` becomes a top-level object keyed by its file name.
 */
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { NAMESPACES } from "./namespaces";
import { routing, type Locale } from "./routing";

/** The merged catalogue for `locale`: `{ common: {...}, parts: {...}, … }`. */
export async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  return Object.fromEntries(
    await Promise.all(
      NAMESPACES.map(async (ns) => [ns, (await import(`@/messages/${locale}/${ns}.json`)).default]),
    ),
  );
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
