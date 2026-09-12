import { Bike } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/lib/i18n/navigation";

import { LocaleSwitcher } from "./LocaleSwitcher";
import { MobileNav } from "./MobileNav";
import { MyBikeLink } from "./MyBikeLink";

const desktopLink =
  "tap-target rounded-md px-3 text-sm font-medium text-ink-muted hover:bg-paper-2 hover:text-ink";
const sheetLink =
  "flex min-h-[var(--tap-min)] items-center rounded-md px-3 text-base font-medium hover:bg-paper-2";

/**
 * Sticky site header (§6.5).
 *
 * A shared, non-async component rendered on the server by the locale layout:
 * it reads NO request API (no cookies, headers or session), so every static
 * route stays static. The request-dependent pieces are client islands:
 * `MyBikeLink` (local or demo bike, from localStorage), `LocaleSwitcher`, and
 * the account menu W1-T3 adds next to the switcher.
 *
 * ≥ lg: logo, inline nav, switcher. < lg: 44×44 menu button opening the
 * `MobileNav` sheet, logo, switcher — never wider than 320 px.
 */
export function SiteHeader(): React.JSX.Element {
  const t = useTranslations("common");

  const links = (className: string) => (
    <>
      <li>
        <Link href="/guides" className={className}>
          {t("nav.guides")}
        </Link>
      </li>
      <li>
        <Link href="/acheter" className={className}>
          {t("nav.shop")}
        </Link>
      </li>
      <li>
        <MyBikeLink className={className}>{t("nav.myBike")}</MyBikeLink>
      </li>
    </>
  );

  return (
    <header
      data-site-header
      className="sticky top-0 z-40 h-[var(--header-h)] border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85"
    >
      <div className="mx-auto flex h-full max-w-6xl items-center gap-1 px-3 sm:gap-2 sm:px-4">
        <MobileNav
          title={t("nav.menu")}
          openLabel={t("nav.openMenu")}
          closeLabel={t("nav.closeMenu")}
        >
          <ul className="flex flex-col gap-1">
            <li>
              <Link href="/" className={sheetLink}>
                {t("nav.home")}
              </Link>
            </li>
            {links(sheetLink)}
          </ul>
        </MobileNav>

        <Link
          href="/"
          aria-label={t("site.homeLink")}
          className="flex min-h-[var(--tap-min)] shrink-0 items-center gap-2 rounded-md px-1 font-display text-base font-semibold tracking-tight text-ink sm:text-lg"
        >
          <Bike aria-hidden="true" className="size-6 text-accent" />
          <span>{t("site.name")}</span>
        </Link>

        <nav aria-label={t("nav.label")} className="ml-4 hidden lg:block">
          <ul className="flex items-center gap-1">{links(desktopLink)}</ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}
