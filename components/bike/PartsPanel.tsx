"use client";

import { useTranslations } from "next-intl";

import { useViewerStore } from "@/components/bike3d/store";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PartStatusValue } from "@/lib/bike/load-bike";
import type { GuideRef } from "@/lib/bike/queries";
import type { BikeRepo } from "@/lib/bike/repo";
import type { PartId } from "@/lib/domain/data/parts";
import type { BikeBuild } from "@/lib/domain/schema/part";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

import { PartInfo } from "./PartInfo";
import { PartsList } from "./PartsList";

/**
 * The side panel of the workspace (§6.4): **Pièces**, **Infos**, **Actions**.
 *
 * The same three tabs on desktop (docked in a 22 rem column) and on mobile
 * (inside the bottom sheet), because they are the same three questions — what
 * is on this bike, what is this part, what do I do now — and a second layout
 * would be a second set of bugs.
 *
 * ## Which tab is showing, and who decides
 *
 * Clicking a **row** opens Infos: the visitor asked about that part. Tapping a
 * **mesh** does not: §6.4 wants the row scrolled into view, and a row inside a
 * hidden tab cannot be scrolled to. So the canvas only ever moves the
 * selection, never the tab, and the parts list keeps `aria-current` on the row
 * it selected.
 */
export interface PartsPanelProps {
  build: BikeBuild;
  repo: BikeRepo;
  guides: readonly GuideRef[];
  statuses?: Partial<Record<string, PartStatusValue>>;
  bikeParam: string;
  specCode?: string | null;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onInspect?: (partId: PartId) => void;
  onSaved?: (build: BikeBuild) => void;
  onFork?: () => void;
  className?: string;
}

export const PANEL_TABS = ["parts", "info", "actions"] as const;

export type PanelTab = (typeof PANEL_TABS)[number];

export function PartsPanel({
  build,
  repo,
  guides,
  statuses,
  bikeParam,
  specCode,
  tab,
  onTabChange,
  onInspect,
  onSaved,
  onFork,
  className,
}: PartsPanelProps): React.JSX.Element {
  const t = useTranslations("bike");
  const selectedPartId = useViewerStore((state) => state.selectedPartId);
  const picked = useViewerStore((state) => state.pickedPartIds);
  const query = specCode ? { spec: specCode } : undefined;

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as PanelTab)}
      className={cn("flex min-h-0 flex-col", className)}
      data-testid="parts-panel"
    >
      {/*
       * `text-ink-muted` on every trigger, replacing shadcn's `text-foreground/60`
       * (components/ui/tabs.tsx, generated — not hand-edited). Sixty percent of
       * `--color-ink` over `--color-paper-2` lands around 3.9:1 and axe reports
       * the two inactive tabs as a serious `color-contrast` violation on
       * /velo/demo (§6.8 AC4). `--color-ink-muted` is the token
       * `tests/unit/tokens-contrast.test.ts` holds at ≥ 4.5:1 against both
       * papers in both schemes, and it flips with the scheme on its own — so no
       * `dark:` variant is needed and the active tab still wins through
       * `data-[state=active]:text-foreground`.
       */}
      <TabsList className="shrink-0">
        <TabsTrigger value="parts" className="min-h-[var(--tap-min)] text-ink-muted">
          {t("workspace.partsTab")}
        </TabsTrigger>
        <TabsTrigger value="info" className="min-h-[var(--tap-min)] text-ink-muted">
          {t("workspace.infoTab")}
        </TabsTrigger>
        <TabsTrigger value="actions" className="min-h-[var(--tap-min)] text-ink-muted">
          {t("workspace.actionsTab")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="parts" className="min-h-0">
        <PartsList
          build={build}
          statuses={statuses}
          onInspect={(partId) => {
            onInspect?.(partId);
            onTabChange("info");
          }}
        />
      </TabsContent>

      <TabsContent value="info" className="min-h-0">
        <PartInfo
          build={build}
          partId={selectedPartId}
          repo={repo}
          guides={guides}
          statuses={statuses}
          bikeParam={bikeParam}
          specCode={specCode}
          onSaved={onSaved}
          onFork={onFork}
        />
      </TabsContent>

      <TabsContent value="actions" className="min-h-0">
        <nav aria-label={t("workspace.actionsTab")} className="flex flex-col gap-2">
          <Button asChild className="min-h-[var(--tap-min)] justify-start">
            <Link
              href={{
                pathname: "/velo/[id]/controle",
                params: { id: bikeParam },
                ...(query === undefined ? {} : { query }),
              }}
              prefetch={false}
              data-testid="action-full-checkup"
            >
              {t("actions.fullCheckup")}
            </Link>
          </Button>

          <Button
            asChild={picked.size > 0}
            variant="outline"
            disabled={picked.size === 0}
            className="min-h-[var(--tap-min)] justify-start"
          >
            {picked.size > 0 ? (
              <Link
                href={{
                  pathname: "/velo/[id]/controle",
                  params: { id: bikeParam },
                  query: { ...(query ?? {}), parts: [...picked].join(",") },
                }}
                prefetch={false}
                data-testid="action-partial-checkup"
              >
                {t("actions.partialCheckup", { count: picked.size })}
              </Link>
            ) : (
              <span data-testid="action-partial-checkup-disabled">
                {t("actions.partialCheckup", { count: 0 })}
              </span>
            )}
          </Button>

          <Button asChild variant="outline" className="min-h-[var(--tap-min)] justify-start">
            <Link
              href={{
                pathname: "/velo/[id]/reglages",
                params: { id: bikeParam },
                ...(query === undefined ? {} : { query }),
              }}
              prefetch={false}
              data-testid="action-fit"
            >
              {t("actions.fit")}
            </Link>
          </Button>

          <Button asChild variant="outline" className="min-h-[var(--tap-min)] justify-start">
            <Link
              href={{
                pathname: "/velo/[id]/liste",
                params: { id: bikeParam },
                ...(query === undefined ? {} : { query }),
              }}
              prefetch={false}
              data-testid="action-build-list"
            >
              {t("actions.buildList")}
            </Link>
          </Button>
        </nav>
      </TabsContent>
    </Tabs>
  );
}
