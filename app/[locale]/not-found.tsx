import { useTranslations } from "next-intl";

import { Link } from "@/lib/i18n/navigation";

/**
 * Localized 404 for everything under `/[locale]` — unknown paths reach it
 * through `[...rest]/page.tsx`, and any page may call `notFound()` (another
 * user's bike is a 404, never a 403). Rendered inside the locale layout, so the
 * header, the switcher and the locale are all there. Next adds
 * `<meta name="robots" content="noindex">` and the 404 status itself.
 */
export default function LocaleNotFound(): React.JSX.Element {
  const t = useTranslations("common");

  return (
    <section
      aria-labelledby="not-found-title"
      className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-4 py-16 text-center sm:py-24"
    >
      <p className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
        {t("notFound.code")}
      </p>
      <h1 id="not-found-title" className="text-3xl font-semibold sm:text-4xl">
        {t("notFound.title")}
      </h1>
      <p className="text-ink-muted">{t("notFound.description")}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="tap-target rounded-md bg-accent px-5 font-medium text-accent-fg hover:opacity-90"
        >
          {t("notFound.backHome")}
        </Link>
        <Link
          href="/guides"
          className="tap-target rounded-md border border-rule px-5 font-medium text-ink hover:bg-paper-2"
        >
          {t("notFound.guides")}
        </Link>
      </div>
    </section>
  );
}
