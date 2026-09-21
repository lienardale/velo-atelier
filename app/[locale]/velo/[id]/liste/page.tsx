import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BuildList } from "@/components/build-list/BuildList";
import { Button } from "@/components/ui/button";
import { firstValue } from "@/lib/bike3d/query";
import { loadBikeForRequest } from "@/lib/bike/load-bike";
import { resolveBikeRef } from "@/lib/bike/resolve-bike-ref";
import type { BuildListItem } from "@/lib/checkup/types";
import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { buildMetadata } from "@/lib/seo/metadata";

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

  return (
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
        />
      )}
    </div>
  );
}
