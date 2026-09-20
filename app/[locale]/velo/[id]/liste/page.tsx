import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BuildList } from "@/components/build-list/BuildList";
import { Button } from "@/components/ui/button";
import { firstValue } from "@/lib/bike3d/query";
import { loadBikeForRequest } from "@/lib/bike/load-bike";
import { resolveBikeRef } from "@/lib/bike/resolve-bike-ref";
import type { BuildAction, BuildListItem, ChosenProduct } from "@/lib/checkup/types";
import { isPartId, type PartId } from "@/lib/domain/data/parts";
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

/** The Prisma enum, as the checkup contract spells it (`KoAction`, §1.2). */
const ACTION_OF: Readonly<Record<string, BuildAction>> = {
  REPLACE: "replace",
  FIX: "fix",
  CLEAN: "clean",
  ADJUST: "adjust",
  INSPECT_SHOP: "inspect-shop",
};

interface BuildListRow {
  id: string;
  partId: string;
  action: string;
  reasonKey: string;
  guideSlug: string | null;
  refinement: unknown;
  chosenProduct: unknown;
  done: boolean;
  sortOrder: number;
  checkupItem: { stepKey: string } | null;
}

/** A `Json` column is a shape we WROTE, not a shape we can assume on read. */
function asRefinement(value: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(
    ([key, entry]) => typeof entry === "string" && key.length <= 64 && entry.length <= 64,
  );
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as Record<string, string>);
}

function asChosenProduct(value: unknown): ChosenProduct | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const fields = ["brand", "model", "size", "vendor", "url"] as const;
  /* eslint-disable security/detect-object-injection -- `field` iterates the literal tuple above */
  if (!fields.every((field) => typeof record[field] === "string")) return undefined;
  return Object.fromEntries(fields.map((f) => [f, record[f]])) as unknown as ChosenProduct;
  /* eslint-enable security/detect-object-injection */
}

function toItem(row: BuildListRow): BuildListItem | null {
  const action = Object.hasOwn(ACTION_OF, row.action) ? ACTION_OF[row.action] : undefined;
  if (action === undefined || !isPartId(row.partId)) return null;
  const stepKey = row.checkupItem?.stepKey ?? row.id;
  return {
    id: row.id,
    stepKey,
    sourceKeys: [stepKey],
    partId: row.partId as PartId,
    action,
    reasonKey: row.reasonKey,
    ...(row.guideSlug === null ? {} : { guideSlug: row.guideSlug }),
    done: row.done,
    ...(row.refinement === null ? {} : { refinement: asRefinement(row.refinement) }),
    ...(row.chosenProduct === null ? {} : { chosenProduct: asChosenProduct(row.chosenProduct) }),
    sortOrder: row.sortOrder,
  };
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
 *   db            two queries — the bike (`loadBikeForRequest`, which is also
 *                 the ownership check) and its open list.
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
    const [{ prisma }, { currentUser }] = await Promise.all([
      import("@/lib/db/prisma"),
      import("@/lib/actions/with-user"),
    ]);
    const user = await currentUser();
    const list =
      user === null
        ? null
        : await prisma.buildList.findFirst({
            // The owner is in the `where` as well as in `loadBikeForRequest`:
            // one predicate per query, never "the previous one covered it".
            where: { bikeId: bike.bikeId, bike: { userId: user.id }, status: "OPEN" },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              items: {
                orderBy: { sortOrder: "asc" },
                select: {
                  id: true,
                  partId: true,
                  action: true,
                  reasonKey: true,
                  guideSlug: true,
                  refinement: true,
                  chosenProduct: true,
                  done: true,
                  sortOrder: true,
                  checkupItem: { select: { stepKey: true } },
                },
              },
            },
          });
    buildListId = list?.id ?? null;
    initialItems = (list?.items ?? [])
      .map((row) => toItem(row as BuildListRow))
      .filter((item): item is BuildListItem => item !== null);
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
