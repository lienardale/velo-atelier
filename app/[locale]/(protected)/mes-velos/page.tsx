import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { currentUser } from "@/lib/actions/with-user";
import { redirect } from "@/lib/i18n/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import type { Locale } from "@/lib/i18n/routing";

/**
 * `/fr/mes-velos` · `/en/my-bikes` — PLACEHOLDER (W1-T3).
 *
 * This is where every successful sign-in lands (`safeCallbackUrl`'s fallback,
 * and `authorized()`'s redirect for a signed-in visitor on the login page), so
 * it has to exist and answer 200 from W1 on, or the auth e2e specs have nowhere
 * to arrive. **W2-T3 replaces the body** with the real bike list, its actions
 * and its empty state (§6.7: illustration + CTA).
 *
 * Two things here are NOT placeholder and should survive that rewrite: the
 * `auth()` call (a layout does not re-run between sibling pages, so each page
 * checks for itself) and `index: false` (§6.6).
 *
 * Its strings live under `account.myBikes.*` because `bike.json` — the namespace
 * Appendix A gives this page — is W2-T3's to create; moving them is part of that
 * task.
 */

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.myBikes" });
  return buildMetadata({
    locale,
    pathname: "/mes-velos",
    title: t("metaTitle"),
    description: t("metaDescription"),
    index: false,
  });
}

export default async function MyBikesPage({ params }: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await currentUser();
  if (!user) return redirect({ href: "/connexion", locale });

  const t = await getTranslations({ locale, namespace: "account.myBikes" });

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl font-semibold text-ink">{t("title")}</h1>
      <p className="text-sm text-ink-muted">{t("placeholder")}</p>
    </div>
  );
}
