import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";

interface HomePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: HomePageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "common" });
  return buildMetadata({
    locale,
    pathname: "/",
    title: { absolute: `${t("site.name")} — ${t("site.tagline")}` },
    description: t("site.description"),
  });
}

/**
 * Home — the static shell (§6.2). W2-T2 adds the decision tree here, inside a
 * `<Suspense fallback={<DecisionTreeSkeleton/>}>` boundary so the route stays
 * static (`○ /[locale]` in the build output).
 */
export default async function HomePage({ params }: HomePageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common" });

  return (
    <section
      aria-labelledby="home-title"
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12 sm:py-20"
    >
      <p className="text-sm font-semibold tracking-wide text-accent uppercase">{t("site.name")}</p>
      <h1 id="home-title" className="max-w-3xl text-4xl font-semibold sm:text-5xl">
        {t("site.tagline")}
      </h1>
      <p className="max-w-2xl text-lg text-ink-muted">{t("site.description")}</p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={{ pathname: "/velo/[id]", params: { id: "demo" } }}
          className="tap-target rounded-md bg-accent px-5 font-medium text-accent-fg hover:opacity-90"
        >
          {t("nav.demoBike")}
        </Link>
        <Link
          href="/guides"
          className="tap-target rounded-md border border-rule px-5 font-medium text-ink hover:bg-paper-2"
        >
          {t("nav.guides")}
        </Link>
      </div>
    </section>
  );
}
