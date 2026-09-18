import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { ClientMessages } from "@/components/i18n/ClientMessages";
import { GuideGrid } from "@/components/guides/GuideCard";
import { GuideFilters } from "@/components/guides/GuideFilters";
import { GUIDES } from "@/lib/content/collection";
import { guidesForLocale, toSummary } from "@/lib/content/guides";
import { CLIENT_NAMESPACES } from "@/lib/i18n/client-namespaces";
import { routing } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";

interface GuidesPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: GuidesPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "guides" });
  return buildMetadata({
    locale,
    pathname: "/guides",
    title: t("meta.listTitle"),
    description: t("meta.listDescription"),
  });
}

/**
 * `/guides` — every guide of the locale (§6.2). Static: the list is rendered on
 * the server, and the client filter (`?kind=&system=&bike=`) takes over inside
 * a Suspense boundary whose fallback is that same unfiltered list.
 */
export default async function GuidesPage({ params }: GuidesPageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "guides" });
  const guides = guidesForLocale(GUIDES, locale).map(toSummary);

  return (
    <ClientMessages locale={locale} namespaces={CLIENT_NAMESPACES["app/[locale]/guides/page.tsx"]}>
      <section
        aria-labelledby="guides-title"
        className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:py-12"
      >
        <h1 id="guides-title" className="text-3xl font-semibold sm:text-4xl">
          {t("list.title")}
        </h1>
        <p className="max-w-3xl text-lg text-ink-muted">{t("list.intro")}</p>
        <Suspense fallback={<GuideGrid guides={guides} />}>
          <GuideFilters guides={guides} />
        </Suspense>
      </section>
    </ClientMessages>
  );
}
