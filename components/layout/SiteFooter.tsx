import { useTranslations } from "next-intl";

import { Link } from "@/lib/i18n/navigation";

import { LocaleSwitcher } from "./LocaleSwitcher";

/** The public repository (MIT code, CC BY-SA 4.0 guides). */
export const REPOSITORY_URL = "https://github.com/lienardale/velo-atelier";

const footerLink =
  "inline-flex min-h-[var(--tap-min)] items-center rounded-md px-2 text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline";

/**
 * Site footer (§6.5): legal notice, privacy, source code, and a second locale
 * switcher at the end of the page. Shared, non-async, request-API-free — like
 * the header, it never makes a static route dynamic.
 */
export function SiteFooter(): React.JSX.Element {
  const t = useTranslations("common");

  return (
    <footer data-site-footer className="mt-auto border-t border-rule bg-paper-2">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:flex-row md:items-center md:justify-between">
        <nav aria-label={t("footer.label")}>
          <ul className="-mx-2 flex flex-wrap items-center gap-x-1">
            <li>
              <Link href="/mentions-legales" className={footerLink}>
                {t("footer.legal")}
              </Link>
            </li>
            <li>
              <Link href="/confidentialite" className={footerLink}>
                {t("footer.privacy")}
              </Link>
            </li>
            <li>
              <a
                href={REPOSITORY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={footerLink}
              >
                {t("footer.sourceCode")} <span className="sr-only">{t("footer.newTab")}</span>
              </a>
            </li>
          </ul>
        </nav>
        <div className="flex flex-col gap-3 md:items-end">
          <LocaleSwitcher className="self-start md:self-end" />
          <p className="text-sm text-ink-muted">{t("footer.license")}</p>
        </div>
      </div>
    </footer>
  );
}
