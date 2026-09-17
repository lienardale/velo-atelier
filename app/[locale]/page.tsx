import { ClipboardCheck, ListChecks, Wrench } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { DecisionTree } from "@/components/decision-tree/DecisionTree";
import { DecisionTreeSkeleton } from "@/components/decision-tree/DecisionTreeSkeleton";
import { renderTreeIllustrations } from "@/components/decision-tree/tree-illustrations";
import { GuideCard } from "@/components/guides/GuideCard";
import { GUIDES } from "@/lib/content/collection";
import { guidesForLocale, GUIDE_KIND_ORDER, toSummary } from "@/lib/content/guides";
import type { GuideSummary } from "@/lib/content/types";
import { Link } from "@/lib/i18n/navigation";
import { routing, type Locale } from "@/lib/i18n/routing";
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

/** How many guides the home page features: the first full guide of each kind, in `/guides` order. */
const FEATURED_GUIDES = 3;

function featuredGuides(locale: Locale): GuideSummary[] {
  const guides = guidesForLocale(GUIDES, locale)
    .filter((guide) => guide.status === "full")
    .map(toSummary);
  return GUIDE_KIND_ORDER.flatMap(
    (kind) => guides.find((guide) => guide.kind === kind) ?? [],
  ).slice(0, FEATURED_GUIDES);
}

const FEATURES = [
  { id: "describe", Icon: ListChecks },
  { id: "inspect", Icon: ClipboardCheck },
  { id: "repair", Icon: Wrench },
] as const;

/**
 * Home (§6.2): the decision tree, then — below the fold — what the site does,
 * a few guides, and the no-account note.
 *
 * Static (`○ /[locale]` in the build output, §6.8 AC2). The tree reads the
 * query string with `useSearchParams`, which on a static route must sit under a
 * `<Suspense>` boundary: the prerendered HTML carries the skeleton (with the
 * page's real `<h1>`), and the client renders the question the URL asks for.
 * Nothing here reads a request API, and nothing imports three.js (bundle budget
 * `/[locale]`, `forbidWebgl`).
 */
export default async function HomePage({ params }: HomePageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "decision-tree" });
  const guides = featuredGuides(locale);

  return (
    <>
      <Suspense fallback={<DecisionTreeSkeleton />}>
        <DecisionTree illustrations={renderTreeIllustrations()} />
      </Suspense>

      <div className="border-t border-rule bg-paper-2/50">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-12">
          <section aria-labelledby="home-features" className="flex flex-col gap-4">
            <h2 id="home-features" className="text-2xl font-semibold">
              {t("home.featuresTitle")}
            </h2>
            <ul className="grid gap-4 md:grid-cols-3">
              {FEATURES.map(({ id, Icon }) => (
                <li
                  key={id}
                  className="flex flex-col gap-2 rounded-lg border border-rule bg-paper p-4"
                >
                  <Icon aria-hidden="true" className="size-6 text-accent" />
                  <h3 className="text-lg font-semibold">{t(`home.features.${id}.title`)}</h3>
                  <p className="text-sm text-ink-muted">{t(`home.features.${id}.text`)}</p>
                </li>
              ))}
            </ul>
          </section>

          {guides.length === 0 ? null : (
            <section aria-labelledby="home-guides" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="home-guides" className="text-2xl font-semibold">
                  {t("home.latestGuides")}
                </h2>
                <Link
                  href="/guides"
                  className="inline-flex min-h-[var(--tap-min)] items-center font-medium text-accent underline underline-offset-4 hover:no-underline"
                >
                  {t("home.allGuides")}
                </Link>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {guides.map((guide) => (
                  <li key={guide.slug}>
                    <GuideCard guide={guide} headingLevel={3} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            aria-labelledby="home-guest"
            className="flex flex-col items-start gap-3 rounded-lg border border-rule bg-paper p-5"
          >
            <h2 id="home-guest" className="text-xl font-semibold">
              {t("home.guest.title")}
            </h2>
            <p className="max-w-2xl text-ink-muted">{t("home.guest.text")}</p>
            <Link
              href="/inscription"
              className="tap-target rounded-md border border-rule px-5 font-medium text-ink hover:bg-paper-2"
            >
              {t("home.guest.signUp")}
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
