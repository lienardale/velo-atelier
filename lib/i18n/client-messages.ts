/**
 * What of the message catalogue reaches the BROWSER.
 *
 * The server always has the whole catalogue (`lib/i18n/request.ts` →
 * `getTranslations`). `NextIntlClientProvider` is the other half: whatever it
 * is given is serialised into the page's RSC payload, on every route, and then
 * decoded by React during hydration. Handed the merged catalogue it costs the
 * home page 86 116 B of flight — 46 % of the document — for a screen whose
 * client components read three namespaces (`.debug/008`).
 *
 * So each route declares what its own client subtree reads
 * (`lib/i18n/client-namespaces.ts`) and this module cuts the catalogue down to
 * it. Nothing here decides anything: the declarations are the contract and
 * `tests/unit/i18n/client-namespaces.test.ts` is what holds them to the code.
 *
 * ## Both halves of the import specifier are narrowed at run time
 *
 * `locale` and each namespace are interpolated into an `import()` specifier,
 * so a value that is only TYPED `Locale` would be one bad cast away from a file
 * path. The locale is narrowed the way `lib/i18n/request.ts` narrows it — an
 * unknown one is the default locale — and a namespace outside `NAMESPACES` is
 * a programming error that throws before anything is imported
 * (`tests/security/path-traversal.test.ts`).
 */
import { NAMESPACES, type Namespace, type NamespaceMessages } from "./namespaces";
import { isLocale, routing, type Locale } from "./routing";

/** The messages a provider is given: the declared namespaces, nothing else. */
export type ClientMessages = Partial<NamespaceMessages>;

/**
 * The catalogue restricted to `namespaces`, in the shape
 * `NextIntlClientProvider` wants.
 *
 * Reads the same per-namespace JSON files as `loadMessages`; a namespace loaded
 * here and there in the same request is one module either way.
 */
export async function loadClientMessages(
  locale: Locale,
  namespaces: readonly Namespace[],
): Promise<ClientMessages> {
  const safeLocale: Locale = isLocale(locale) ? locale : routing.defaultLocale;
  const unknown = namespaces.filter((ns) => !(NAMESPACES as readonly string[]).includes(ns));
  if (unknown.length > 0) {
    throw new Error(`loadClientMessages: not a message namespace: ${JSON.stringify(unknown)}`);
  }
  const entries = await Promise.all(
    namespaces.map(
      async (ns) => [ns, (await import(`@/messages/${safeLocale}/${ns}.json`)).default] as const,
    ),
  );
  return Object.fromEntries(entries) as ClientMessages;
}
