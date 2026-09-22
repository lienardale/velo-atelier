import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BuildList } from "@/components/build-list/BuildList";
import { renderMeasureDrawings } from "@/components/build-list/measure-drawings";
import { ClientMessages } from "@/components/i18n/ClientMessages";
import { Button } from "@/components/ui/button";
import { firstValue } from "@/lib/bike3d/query";
import { loadBikeForRequest } from "@/lib/bike/load-bike";
import { resolveBikeRef } from "@/lib/bike/resolve-bike-ref";
import type { BuildListItem } from "@/lib/checkup/types";
import { partDefinition } from "@/lib/domain/data/parts";
import type { BikeBuild } from "@/lib/domain/schema/part";
import { CLIENT_NAMESPACES } from "@/lib/i18n/client-namespaces";
import { Link } from "@/lib/i18n/navigation";
import { routing, type Locale } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";
import type { BrandTier } from "@/lib/shop/questions";
import { brandsFor } from "@/lib/shop/retailers";

interface BuildListPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: BuildListPageProps): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "shop" });
  return buildMetadata({
    locale,
    pathname: { pathname: "/velo/[id]/liste", params: { id } },
    title: t("list.meta.title"),
    description: t("list.meta.description"),
    index: false,
  });
}

/**
 * `/velo/[id]/liste` · `/bike/[id]/build-list` — the to-fix list (§5.5, §6.5).
 *
 * What a checkup produced, as work: one line per part, grouped by what has to
 * be done to it, with what still has to be decided before buying and where to
 * buy it.
 *
 * ## Where the list comes from depends on the bike, and only here
 *
 *   demo / local  `localStorage` (`va:buildlist:<ref>`). The server cannot read
 *                 it, so it hands `<BuildList>` `initialItems: null` and the
 *                 component reads storage after hydration.
 *   db            three queries — the bike and its in-progress checkup
 *                 (`loadBikeForRequest`, which is also the ownership check),
 *                 then its open list (`./load`).
 *
 * ## The brand tiers come from here
 *
 * `content/brands.yaml` is read by `lib/shop/retailers.ts` on the server; the
 * form is a client component (a guest's list lives in `localStorage`), so the
 * tiers of THIS bike's parts are handed down as props — the ~25-part file
 * never reaches the browser, and the build list's bundle never carries it.
 * This route is dynamic, so the read happens per request: the file is in the
 * route's traced output (`page.js.nft.json`), which is what makes that safe on
 * a deployment (`.debug/013` §5).
 *
 * The "Comment mesurer" drawings travel the same way, rendered here
 * (`renderMeasureDrawings`), for the attributes this bike's parts can be asked
 * about: the illustration barrel is server-only (CLAUDE.md).
 *
 * ## `?spec=`
 *
 * The refinement questions are built against the BIKE: which options a cassette
 * still has depends on the hub it goes on. A `local` bike has no row, so every
 * link into this page from the workspace carries the guest spec in the URL
 * (§5.4). Without it the server cannot resolve the bike and the page says so
 * rather than asking questions against a bike it invented — the same contract
 * the fit page keeps.
 */
export default async function BuildListPage({
  params,
  searchParams,
}: BuildListPageProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const resolvedLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  setRequestLocale(resolvedLocale);

  const ref = resolveBikeRef(id);
  const specCode = firstValue((await searchParams).spec);
  const bike = await loadBikeForRequest(ref, { specCode });
  const t = await getTranslations({ locale: resolvedLocale, namespace: "shop" });

  let initialItems: BuildListItem[] | null = null;
  let buildListId: string | null = null;
  if (ref.kind === "db" && bike.bikeId !== null) {
    // Dynamic, like the checkup page's: `server-only` and the Prisma client
    // stay out of the module graph of the `demo` and `local` branches.
    const [{ loadBuildList }, { currentUser }] = await Promise.all([
      import("./load"),
      import("@/lib/actions/with-user"),
    ]);
    const user = await currentUser();
    if (user !== null) {
      const loaded = await loadBuildList(bike.bikeId, user.id);
      buildListId = loaded.buildListId;
      initialItems = loaded.items;
    } else {
      initialItems = [];
    }
  }

  // Its own provider: the list reads catalogues (`shop`, `rules`, `guides`) the
  // rest of the segment never needs (lib/i18n/client-namespaces.ts).
  return (
    <ClientMessages
      locale={resolvedLocale as Locale}
      namespaces={CLIENT_NAMESPACES["app/[locale]/velo/[id]/liste/page.tsx"]}
    >
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-ink text-2xl font-semibold">{t("list.title")}</h1>
          <p className="text-ink-muted">{t("list.intro")}</p>
          <Link
            href={{ pathname: "/velo/[id]", params: { id: bike.param } }}
            className="text-accent mt-2 flex min-h-[var(--tap-min)] items-center self-start underline"
            data-testid="build-list-back-to-bike"
            data-print="hide"
          >
            {t("list.openBike")}
          </Link>
        </header>

        {bike.build === null ? (
          <section className="flex flex-col items-start gap-4" data-testid="build-list-needs-bike">
            <p className="text-ink-muted">{t("list.needsBike")}</p>
            <Button asChild className="min-h-[var(--tap-min)]">
              <Link href={{ pathname: "/velo/[id]", params: { id: bike.param } }}>
                {t("list.openBike")}
              </Link>
            </Button>
          </section>
        ) : (
          <BuildList
            bikeRef={ref}
            bikeParam={bike.param}
            build={bike.build}
            locale={resolvedLocale}
            initialItems={initialItems}
            buildListId={buildListId}
            brandsByPart={brandTiersOf(bike.build)}
            drawings={renderMeasureDrawings(askedAttributes(bike.build))}
          />
        )}
      </div>
    </ClientMessages>
  );
}

/** Brands per tier for the parts of this build that `content/brands.yaml` covers. */
function brandTiersOf(
  build: BikeBuild,
): Record<string, Readonly<Record<BrandTier, readonly string[]>>> {
  const tiers: Record<string, Readonly<Record<BrandTier, readonly string[]>>> = {};
  for (const part of build.parts) {
    const brands = brandsFor(part.partId);
    if (brands !== null) tiers[part.partId] = brands.tiers;
  }
  return tiers;
}

/** Every attribute a refinement form on this bike could ask about. */
function askedAttributes(build: BikeBuild): string[] {
  return build.parts.flatMap(
    (part) =>
      partDefinition(part.partId)
        ?.attributes.filter((attribute) => attribute.editable)
        .map((attribute) => attribute.key) ?? [],
  );
}
