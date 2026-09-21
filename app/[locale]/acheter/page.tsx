/* eslint-disable security/detect-object-injection -- every index below is a `Locale` from routing.locales or a BrandTier literal, never user input */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { loadBuildListItemAction } from "@/app/[locale]/velo/[id]/liste/actions";
import { ClientMessages } from "@/components/i18n/ClientMessages";
import { CategoryGrid, type CategoryCard } from "@/components/shop/CategoryGrid";
import { PartQuestions } from "@/components/shop/PartQuestions";
import { VendorSearch } from "@/components/shop/VendorSearch";
import { CLIENT_NAMESPACES } from "@/lib/i18n/client-namespaces";
import { routing, type Locale } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";
import type { BrandTier } from "@/lib/shop/questions";
import { BRANDS, SHOP_CATEGORIES } from "@/lib/shop/retailers";

interface ShopPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: ShopPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "shop" });
  return buildMetadata({
    locale,
    pathname: "/acheter",
    title: t("meta.title"),
    description: t("meta.description"),
  });
}

/** The categories, already in one language — the grid renders strings, not `Localized`. */
function cardsFor(locale: Locale): CategoryCard[] {
  return SHOP_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label[locale],
    hint: category.hint[locale],
    query: category.query[locale],
    partId: category.partIds[0],
    retailers: category.retailers,
  }));
}

/** The brand tiers, flattened to this locale, for the client-side part panel. */
function brandsFor(
  locale: Locale,
): Record<string, { note: string; tiers: Record<BrandTier, string[]> }> {
  return Object.fromEntries(
    Object.entries(BRANDS).map(([partId, brands]) => [
      partId,
      {
        note: brands.note[locale],
        tiers: {
          entry: [...brands.tiers.entry],
          mid: [...brands.tiers.mid],
          high: [...brands.tiers.high],
        },
      },
    ]),
  );
}

/**
 * `/acheter` · `/shop` — where to buy a part, and what to ask for (§5.5).
 *
 * Three things on one page: the category grid (`content/shop/categories.yaml`),
 * a free-text box for someone who already knows what they want, and — when the
 * URL names one — a part panel with the buying questions and the brand tiers.
 *
 * ## It is a STATIC route, and that is what shapes it
 *
 * Both YAML files are read by `lib/shop/retailers.ts` with `readFileSync` at
 * module scope. On a prerendered route that happens once, at build time, and
 * the data ends up inside the HTML; on a route that runs per request it would
 * be a file Next's tracing never copied into the deployment — green locally,
 * a crash in production. So this page reads no request API at all, and the
 * part-specific panel reads `?part=` in the browser instead, inside a
 * `<Suspense>` boundary (a `useSearchParams` consumer without one opts the
 * whole route out of static rendering — the W2 lesson).
 *
 * The brand tables are therefore serialised into the payload rather than
 * fetched: ~25 parts × 3 tiers, in one language. It is the page whose entire
 * job is "which one do I buy", and it is not one of the routes the bundle
 * ratchet guards.
 */
export default async function ShopPage({ params }: ShopPageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "shop" });

  return (
    <ClientMessages locale={locale} namespaces={CLIENT_NAMESPACES["app/[locale]/acheter/page.tsx"]}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:py-12">
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-ink text-3xl font-semibold sm:text-4xl">{t("title")}</h1>
          <p className="text-ink-muted max-w-3xl text-lg">{t("intro")}</p>
          <p className="text-ink-muted text-sm">{t("outbound.disclosure")}</p>
        </header>

        {/*
         * The panel is null until `?part=` names a part, so the fallback is
         * nothing: there is no layout to hold open, and a skeleton where most
         * visits show nothing at all would be a flash of furniture.
         */}
        {/*
         * `readItem` is the owner-scoped read behind `?item=` on a saved bike
         * (§5.5). A server action passed as a prop is a reference: the panel
         * calls it after hydration, and this page stays static.
         */}
        <Suspense fallback={null}>
          <PartQuestions
            locale={locale}
            brandsByPart={brandsFor(locale)}
            readItem={loadBuildListItemAction}
          />
        </Suspense>

        <section aria-labelledby="shop-search-title" className="flex flex-col gap-3">
          <h2 id="shop-search-title" className="font-display text-ink text-xl font-semibold">
            {t("search.title")}
          </h2>
          <VendorSearch locale={locale} />
        </section>

        <section aria-labelledby="shop-categories-title" className="flex flex-col gap-3">
          <h2 id="shop-categories-title" className="font-display text-ink text-xl font-semibold">
            {t("categories.title")}
          </h2>
          <p className="text-ink-muted">{t("categories.intro")}</p>
          <CategoryGrid categories={cardsFor(locale)} locale={locale} />
        </section>
      </div>
    </ClientMessages>
  );
}
