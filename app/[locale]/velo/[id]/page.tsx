import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BikeWorkspace } from "@/components/bike/BikeWorkspace";
import { parseViewerQuery } from "@/lib/bike3d/query";
import { GUIDES } from "@/lib/content/collection";
import { toSummary } from "@/lib/content/guides";
import { describe } from "@/lib/bike/describe";
import { loadBikeForRequest } from "@/lib/bike/load-bike";
import { actionGuideRefs } from "@/lib/bike/queries";
import { resolveBikeRef } from "@/lib/bike/resolve-bike-ref";
import { routing, type Locale } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";

interface BikePageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * No `generateStaticParams`, deliberately — see `.debug/006`.
 *
 * §6.8 AC2 asks for `/[locale]/velo/demo` to come out of `next build`
 * prerendered, and enumerating `[{ id: "demo" }]` does exactly that. But Next
 * 16.3.4 then renders every param the list does NOT contain — every saved
 * bike's UUID — in its on-demand *static* mode, where reading the session is
 * `DYNAMIC_SERVER_USAGE`: `/fr/velo/<uuid>` answers 500 instead of the bike.
 * `await connection()` in the `db` branch does not lift it, and `revalidate = 0`
 * lifts it by making the whole route dynamic again — which is where this ends
 * up anyway, with one fewer moving part.
 *
 * So the demo bike is server-rendered per request. Its first paint is still the
 * server-rendered silhouette and it still reads nothing about the request; what
 * it loses is the CDN prerender, and what it keeps is `/velo/<uuid>` working.
 */

export async function generateMetadata({ params }: BikePageProps): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "bike" });
  return buildMetadata({
    locale,
    pathname: { pathname: "/velo/[id]", params: { id } },
    title: t("metaTitle"),
    description: t("metaDescription"),
    // Never indexed: a bike page is either private or the demo (§6.6).
    index: false,
  });
}

/**
 * `/velo/[id]` — the 3D workspace (§6.2, §6.4).
 *
 * Three bikes, one page:
 *
 *   `demo`   the gravel preset, read-only. Nothing on this path reads the
 *            request, and the first paint is the server-rendered silhouette.
 *   `local`  the server sends the shell; `BikeWorkspace` reads
 *            `va:bike:local` and, finding nothing, goes home (§6.7).
 *   uuid     `loadBikeForRequest` checks the session and the owner inside the
 *            query. Someone else's bike is a 404 (§4.7).
 *
 * `?part=` and `?parts=` are read HERE and handed down (§3.3): the viewer never
 * touches `useSearchParams`, and neither does the workspace — a `<Suspense>`
 * boundary around it hydrates by mounting a second copy of the whole workspace
 * next to the server's for a few hundred milliseconds (`.debug/006`).
 */
export default async function BikePage({
  params,
  searchParams,
}: BikePageProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const resolvedLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  setRequestLocale(resolvedLocale);

  const ref = resolveBikeRef(id);
  const query = parseViewerQuery(await searchParams);
  const bike = await loadBikeForRequest(ref);
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
      initialPartId={query.part}
      initialPickedIds={query.parts}
    />
  );
}
