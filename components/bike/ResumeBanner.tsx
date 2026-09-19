"use client";

import { useTranslations, useFormatter } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * "You left a checkup unfinished" (§6.2), on top of the workspace.
 *
 * Purely presentational: what counts as "in progress" is the server's business
 * for a saved bike (`loadBikeForRequest` reads the `IN_PROGRESS` row) and the
 * guest store's for `demo`/`local` (`va:checkup:<ref>`, W3-T1). The banner only
 * ever renders what it is handed, which is why W3 can change how a checkup is
 * stored without touching this file.
 *
 * `role="status"`, not `role="alert"`: an unfinished checkup is information the
 * visitor came back for, not something that interrupts them.
 */
export interface ResumeBannerProps {
  bikeParam: string;
  /** ISO 8601 — when the checkup was started. */
  startedAt: string;
  scope: "FULL" | "PARTIAL";
  /** How many steps already have a verdict, when that is known. */
  answered?: number;
  /**
   * The parts a PARTIAL checkup was scoped to, so "reprendre" comes back to the
   * same questions instead of re-planning a full one (W3-T1). Absent for a full
   * checkup, and for a saved bike, whose row records the scope but not the set.
   */
  partIds?: readonly string[];
  specCode?: string | null;
  className?: string;
}

export function ResumeBanner({
  bikeParam,
  startedAt,
  scope,
  answered,
  partIds,
  specCode,
  className,
}: ResumeBannerProps): React.JSX.Element {
  const t = useTranslations("bike");
  const format = useFormatter();
  const started = new Date(startedAt);
  const query = {
    ...(specCode ? { spec: specCode } : {}),
    ...(partIds && partIds.length > 0 ? { parts: partIds.join(",") } : {}),
  };
  const search = Object.keys(query).length > 0 ? query : undefined;

  return (
    <div
      role="status"
      data-testid="resume-banner"
      className={cn(
        "border-rule bg-paper-2 flex flex-wrap items-center gap-3 rounded-lg border p-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-ink font-medium">{t("resume.title")}</p>
        <p className="text-ink-muted text-sm">
          {t("resume.body", {
            scope: t(scope === "FULL" ? "resume.scopeFull" : "resume.scopePartial"),
            date: Number.isNaN(started.getTime())
              ? ""
              : format.dateTime(started, { dateStyle: "medium" }),
            answered: answered ?? 0,
          })}
        </p>
      </div>
      <Button asChild className="min-h-[var(--tap-min)]">
        <Link
          href={{
            pathname: "/velo/[id]/controle",
            params: { id: bikeParam },
            ...(search === undefined ? {} : { query: search }),
          }}
          prefetch={false}
          data-testid="resume-cta"
        >
          {t("resume.cta")}
        </Link>
      </Button>
    </div>
  );
}
