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
 */
import type { Namespace, NamespaceMessages } from "./namespaces";
import type { Locale } from "./routing";

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
  const entries = await Promise.all(
    namespaces.map(
      async (ns) => [ns, (await import(`@/messages/${locale}/${ns}.json`)).default] as const,
    ),
  );
  return Object.fromEntries(entries) as ClientMessages;
}
