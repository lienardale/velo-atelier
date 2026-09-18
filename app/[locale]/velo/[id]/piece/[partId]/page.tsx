import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BikeWorkspace } from "@/components/bike/BikeWorkspace";
import { describe } from "@/lib/bike/describe";
import { loadBikeForRequest } from "@/lib/bike/load-bike";
import { actionGuideRefs, isPartOnBike } from "@/lib/bike/queries";
import { resolveBikeRef } from "@/lib/bike/resolve-bike-ref";
import { GUIDES } from "@/lib/content/collection";
import { toSummary } from "@/lib/content/guides";
import { isPartId } from "@/lib/domain/data/parts";
import { firstValue, parseViewerQuery } from "@/lib/bike3d/query";
import { routing, type Locale } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";

interface PartPageProps {
  params: Promise<{ locale: string; id: string; partId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/velo/[id]/piece/[partId]` — the workspace with one part already selected
 * (§6.2).
 *
 * A real page, not an intercepting route. This URL is what a rider sends a
 * friend ("look at my rear derailleur") and what the part panel's permalink
 * points at, so it has to survive a cold load, a share and a bookmark. In-app
 * selection stays on `/velo/[id]` and only rewrites `?part=`
 * (`history.replaceState`, §3.3) — navigating for every click would fetch an
 * RSC payload per part.
 *
 * A part that is not on this bike is a 404 (§6.7), which is also what makes
 * `partId` safe: it is checked against the *built* bike, never used to look
 * anything up on disk.
 */
export async function generateMetadata({ params }: PartPageProps): Promise<Metadata> {
  const { locale, id, partId } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const [t, tParts] = await Promise.all([
    getTranslations({ locale, namespace: "bike" }),
    getTranslations({ locale, namespace: "parts" }),
  ]);
  const part = isPartId(partId) ? tParts(`${partId}.label` as never) : partId;
  return buildMetadata({
    locale,
    pathname: { pathname: "/velo/[id]/piece/[partId]", params: { id, partId } },
    title: t("part.metaTitle", { part }),
    index: false,
  });
}

export default async function BikePartPage({
  params,
  searchParams,
}: PartPageProps): Promise<React.JSX.Element> {
  const { locale, id, partId } = await params;
  const resolvedLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  setRequestLocale(resolvedLocale);

  const ref = resolveBikeRef(id);
  if (!isPartId(partId)) notFound();

  const query = await searchParams;
  const bike = await loadBikeForRequest(ref, { specCode: firstValue(query.spec) });
  const picked = parseViewerQuery(query).parts;
  // A `local` bike without `?spec=` is unknown here; the client checks instead.
  if (bike.build !== null && !isPartOnBike(bike.build, partId)) notFound();

  const guides = actionGuideRefs(
    GUIDES.filter((guide) => guide.locale === resolvedLocale).map(toSummary),
    bike.build,
  );

  return (
    <BikeWorkspace
      locale={resolvedLocale as Locale}
      refKind={ref.kind}
      bikeParam={bike.param}
      bikeId={bike.bikeId}
      name={bike.name}
      build={bike.build}
      answers={bike.answers}
      statuses={bike.statuses}
      guides={guides}
      resume={bike.resume}
      description={bike.build === null ? null : describe(bike.build.spec, resolvedLocale as Locale)}
      initialPartId={partId}
      initialPickedIds={picked}
    />
  );
}
