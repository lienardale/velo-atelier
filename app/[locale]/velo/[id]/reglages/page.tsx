import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { MeasureCard } from "@/components/bike/MeasureCard";
import { MeasurementForm } from "@/components/bike/MeasurementForm";
import { Button } from "@/components/ui/button";
import { firstValue } from "@/lib/bike3d/query";
import { loadBikeForRequest } from "@/lib/bike/load-bike";
import { measuresForBuild } from "@/lib/bike/queries";
import { resolveBikeRef } from "@/lib/bike/resolve-bike-ref";
import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";

interface FitPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: FitPageProps): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "bike" });
  return buildMetadata({
    locale,
    pathname: { pathname: "/velo/[id]/reglages", params: { id } },
    title: t("fit.metaTitle"),
    description: t("fit.metaDescription"),
    index: false,
  });
}

/**
 * `/velo/[id]/reglages` · `/bike/[id]/fit` — fit and geometry (§5.6).
 *
 * One card per measurement that applies to **this** bike: what it is, the guide
 * that shows how to take it, and the number, remembered. Which cards appear is
 * decided on the server from the spec (`measuresForBuild`: no sag card without
 * suspension, no cleat card on flat pedals); what the numbers are is decided by
 * whichever repo owns the bike — `localStorage` for a guest, `updateBikeFitAction`
 * for a saved one (§6.8 AC12 exercises both).
 *
 * ## `?spec=`
 *
 * A `local` bike has no row to read, so every link into this page from the
 * workspace carries the guest spec in the URL (§5.4) and the server knows which
 * cards to draw. A hand-typed `/velo/local/reglages` cannot be resolved — the
 * server has no access to `localStorage` and will not guess — so it shows the
 * way back to the bike instead of an arbitrary set of cards. An invalid code is
 * treated exactly the same: `decodeAnswers` returns `null` and nothing is
 * trusted.
 */
export default async function BikeFitPage({
  params,
  searchParams,
}: FitPageProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const resolvedLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  setRequestLocale(resolvedLocale);

  const ref = resolveBikeRef(id);
  const specCode = firstValue((await searchParams).spec);
  const bike = await loadBikeForRequest(ref, { specCode });
  const t = await getTranslations({ locale: resolvedLocale, namespace: "bike" });

  if (bike.build === null) {
    return (
      <section className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 py-12">
        <h1 className="font-display text-ink text-2xl font-semibold">{t("fit.title")}</h1>
        <p className="text-ink-muted">{t("fit.needsBike")}</p>
        <Button asChild className="min-h-[var(--tap-min)]">
          <Link
            href={{ pathname: "/velo/[id]", params: { id: bike.param } }}
            data-testid="fit-back-to-bike"
          >
            {t("fit.openBike")}
          </Link>
        </Button>
      </section>
    );
  }

  const measures = measuresForBuild(bike.build);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-ink text-2xl font-semibold">{t("fit.title")}</h1>
        <p className="text-ink-muted">{t("fit.intro")}</p>
        <Link
          href={{ pathname: "/velo/[id]", params: { id: bike.param } }}
          className="text-accent mt-2 flex min-h-[var(--tap-min)] items-center self-start underline"
          data-testid="fit-back-to-bike"
        >
          {t("fit.openBike")}
        </Link>
      </header>

      <div className="grid gap-4 md:grid-cols-2" data-testid="measure-cards">
        {measures.map((measure) => (
          <MeasureCard key={measure.id} measure={measure}>
            <MeasurementForm
              measureId={measure.id}
              build={bike.build!}
              fit={bike.fit}
              refKind={ref.kind}
              bikeId={bike.bikeId}
            />
          </MeasureCard>
        ))}
      </div>
    </div>
  );
}
