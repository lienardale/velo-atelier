/**
 * next-intl type registration.
 *
 * - `Locale`: `useLocale()`, `getLocale()`, `hasLocale()` and the navigation
 *   APIs return / accept `'fr' | 'en'`, not `string`.
 * - `Messages`: the merged catalogue exactly as `lib/i18n/request.ts` builds
 *   it — one top-level object per namespace file, typed from the French files.
 *   An unknown key in `t()` / `useTranslations()` fails `npm run typecheck`.
 *
 * New namespaces are registered in `lib/i18n/namespaces.ts`, not here.
 */
import type { NamespaceMessages } from "@/lib/i18n/namespaces";
import type { routing } from "@/lib/i18n/routing";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: NamespaceMessages;
  }
}
