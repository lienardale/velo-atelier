"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Link } from "@/lib/i18n/navigation";

/**
 * Error boundary for every page under `/[locale]` (the layout, header and
 * footer keep rendering around it). Errors in the locale layout itself fall
 * through to `app/global-error.tsx`.
 *
 * The message never shows `error.message` — in production it is replaced by a
 * generic string anyway, and in development it may leak internals into a
 * screenshot. The `digest` is the correlation id of the server-side log.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  const t = useTranslations("common");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section
      role="alert"
      aria-labelledby="error-title"
      className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-4 py-16 text-center sm:py-24"
    >
      <p className="text-sm font-semibold tracking-wide text-danger-fg uppercase">
        {t("error.code")}
      </p>
      <h1 id="error-title" className="text-3xl font-semibold sm:text-4xl">
        {t("error.title")}
      </h1>
      <p className="text-ink-muted">{t("error.description")}</p>
      {error.digest ? (
        <p className="text-sm text-ink-muted">{t("error.reference", { digest: error.digest })}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="tap-target rounded-md bg-accent px-5 font-medium text-accent-fg hover:opacity-90"
        >
          {t("error.retry")}
        </button>
        <Link
          href="/"
          className="tap-target rounded-md border border-rule px-5 font-medium text-ink hover:bg-paper-2"
        >
          {t("error.backHome")}
        </Link>
      </div>
    </section>
  );
}
