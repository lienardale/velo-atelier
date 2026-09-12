/**
 * Render client (and shared) components the way the app does: inside
 * `NextIntlClientProvider` with the REAL merged catalogue from `messages/`
 * (§7.1 — RTL suites never stub translations, so a missing key or a broken ICU
 * message fails the component test, not production).
 *
 *   const { user } = await renderWithIntl(<SiteFooter />);            // French
 *   await renderWithIntl(<SiteFooter />, { locale: "en" });
 *
 * Messages come from `loadMessages()` — the same namespace merge as
 * `lib/i18n/request.ts` — so a namespace added to `lib/i18n/namespaces.ts` is
 * available here with no edit.
 */
import { render } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";

import { loadMessages } from "@/lib/i18n/request";
import type { Locale } from "@/lib/i18n/routing";

const cache = new Map<Locale, Record<string, unknown>>();

/** The merged catalogue for `locale` (memoised per test file). */
export async function messagesFor(locale: Locale): Promise<Record<string, unknown>> {
  let messages = cache.get(locale);
  if (!messages) {
    messages = await loadMessages(locale);
    cache.set(locale, messages);
  }
  return messages;
}

export async function intlWrapper({
  locale = "fr",
}: {
  locale?: Locale;
}): Promise<(props: { children: ReactNode }) => ReactElement> {
  const messages = await messagesFor(locale);
  return function Wrapper({ children }) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Paris">
        {children}
      </NextIntlClientProvider>
    );
  };
}

/** `render()` inside the provider, plus a `user-event` instance: `{ user, ...renderResult }`. */
export async function renderWithIntl(
  ui: ReactElement,
  { locale = "fr" }: { locale?: Locale } = {},
) {
  const wrapper = await intlWrapper({ locale });
  const user: UserEvent = userEvent.setup();
  return { user, ...render(ui, { wrapper }) };
}
