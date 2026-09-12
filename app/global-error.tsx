"use client";
/* eslint-disable security/detect-object-injection -- `locale` is validated against routing.locales first */

import { NextIntlClientProvider, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect } from "react";

import { routing, type Locale } from "@/lib/i18n/routing";
import enCommon from "@/messages/en/common.json";
import frCommon from "@/messages/fr/common.json";

import "@/styles/globals.css";

const MESSAGES: Record<Locale, { common: typeof frCommon }> = {
  fr: { common: frCommon },
  en: { common: enCommon },
};

/**
 * Last-resort error page: the locale layout itself failed, so there is no
 * `<html>`, no provider and no request config — this renders all three. The
 * two small `common` catalogues are bundled statically; the locale comes from
 * the route params, French when they are unavailable.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  const params = useParams<{ locale?: string }>();
  const locale: Locale = routing.locales.find((l) => l === params?.locale) ?? routing.defaultLocale;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang={locale}>
      <body className="flex min-h-dvh flex-col">
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Paris">
          <GlobalErrorContent locale={locale} digest={error.digest} reset={reset} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

function GlobalErrorContent({
  locale,
  digest,
  reset,
}: {
  locale: Locale;
  digest?: string;
  reset: () => void;
}): React.JSX.Element {
  const t = useTranslations("common");

  return (
    <main
      role="alert"
      aria-labelledby="global-error-title"
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center"
    >
      <p className="text-sm font-semibold tracking-wide text-danger-fg uppercase">
        {t("error.code")}
      </p>
      <h1 id="global-error-title" className="text-3xl font-semibold">
        {t("error.title")}
      </h1>
      <p className="text-ink-muted">{t("error.description")}</p>
      {digest ? <p className="text-sm text-ink-muted">{t("error.reference", { digest })}</p> : null}
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="tap-target rounded-md bg-accent px-5 font-medium text-accent-fg hover:opacity-90"
        >
          {t("error.retry")}
        </button>
        {/* A full page load on purpose: the router state is what just failed. */}
        <a
          href={`/${locale}`}
          className="tap-target rounded-md border border-rule px-5 font-medium text-ink hover:bg-paper-2"
        >
          {t("error.backHome")}
        </a>
      </div>
    </main>
  );
}
