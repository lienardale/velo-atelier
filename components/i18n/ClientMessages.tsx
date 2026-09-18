import { NextIntlClientProvider } from "next-intl";

import { loadClientMessages } from "@/lib/i18n/client-messages";
import type { Namespace } from "@/lib/i18n/namespaces";
import type { Locale } from "@/lib/i18n/routing";

export interface ClientMessagesProps {
  locale: Locale;
  /**
   * The namespaces this subtree's client components read — the route's entry in
   * `CLIENT_NAMESPACES` (`lib/i18n/client-namespaces.ts`), never an inline list:
   * the test reads that table and nothing else.
   */
  namespaces: readonly Namespace[];
  children: React.ReactNode;
}

/**
 * The messages one part of the tree hands to the browser.
 *
 * A **server** component: it reads the catalogue on the server and serialises
 * only `namespaces` into the RSC payload. `NextIntlClientProvider` replaces —
 * never merges — what an enclosing provider gave, and fills in `locale`,
 * `timeZone`, `now` and `formats` from the request configuration, so a subtree
 * under this one sees exactly these namespaces and the same everything else.
 *
 * Which is the whole point: the locale layout wraps every route, so the
 * provider it mounts cannot know what the page below it will render. Handing it
 * the merged catalogue put all thirteen namespaces — 86 116 B, 46 % of the home
 * document — into every page of the site. Each route now declares its own
 * subtree's namespaces and mounts this instead (`.debug/008`).
 *
 * **Replacing, not merging, is what makes this checkable**: the messages a
 * client component can see are the ones its nearest enclosing provider names,
 * with no inheritance to reason about. `tests/unit/i18n/client-namespaces.test.ts`
 * walks each route's client module graph and fails if a component could read a
 * namespace its provider was not given.
 */
export async function ClientMessages({
  locale,
  namespaces,
  children,
}: ClientMessagesProps): Promise<React.JSX.Element> {
  return (
    <NextIntlClientProvider messages={await loadClientMessages(locale, namespaces)}>
      {children}
    </NextIntlClientProvider>
  );
}
