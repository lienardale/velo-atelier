import { getRequestConfig } from "next-intl/server";

/**
 * next-intl request configuration — **W0-T1 scaffold placeholder**.
 *
 * `createNextIntlPlugin('./lib/i18n/request.ts')` in `next.config.ts` resolves
 * this path while the config is loaded, so the file has to exist before any
 * `next build` can run — including the one in W0-T1's own acceptance, which
 * lands before W0-T2 writes the i18n shell.
 *
 * W0-T2 REPLACES THIS FILE ENTIRELY with the real implementation:
 * `routing` from `@/lib/i18n/routing`, a `hasLocale` guard, and the namespace
 * merge described in §1.2 —
 *
 *   messages = Object.fromEntries(await Promise.all(NAMESPACES.map(async (ns) =>
 *     [ns, (await import(`@/messages/${locale}/${ns}.json`)).default])))
 *
 * Nothing here is a contract. There are no message files yet, so this returns
 * an empty catalogue: any `t()` call would throw, which is the correct signal
 * that the shell is not built yet.
 */
const LOCALES = ["fr", "en"] as const;
const DEFAULT_LOCALE = "fr";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = LOCALES.includes(requested as (typeof LOCALES)[number])
    ? (requested as string)
    : DEFAULT_LOCALE;

  return { locale, messages: {} };
});
