"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui-ext/Callout";
import { translateMessageKey } from "@/lib/actions/result";
import type { BuildListItem } from "@/lib/checkup/types";
import { partLabel } from "@/lib/domain/i18n";
import type { BikeBuild } from "@/lib/domain/schema/part";
import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";
import { buildQuery } from "@/lib/shop/query";
import { refinementAnswers, refinementIssues } from "@/lib/shop/questions";
import { cn } from "@/lib/utils";

import { RefinementForm } from "./RefinementForm";
import { VendorButtons } from "./VendorButtons";

/**
 * One line of the build list (§6.5).
 *
 * Part, why it is on the list, the guide that shows how to do it, what still
 * has to be decided before buying, whether that decision fits the rest of the
 * bike, where to buy it, and a checkbox.
 *
 * ## The compatibility callout
 *
 * `role="alert"` on purpose (§6.8 AC7): it appears in response to something the
 * visitor just chose in the refinement form, so a screen reader must interrupt
 * — unlike `<Callout>`'s default, which is a quiet notice that is simply part
 * of the page. `<Callout>` sets no role itself precisely so each consumer can
 * make that call.
 *
 * ## A done line stays on the list
 *
 * Ticking the box does not remove it: "Retirer ce qui est fait" does, and the
 * hide filter makes it invisible without losing it. A line the engine itself
 * closed — a later partial checkup answering OK on the part (`doneReason:
 * "recheck-ok"`, §5.4) — says so, because a box that ticks itself while you
 * were not looking needs an explanation.
 */
export interface BuildItemCardProps {
  item: BuildListItem;
  /** The bike, for the refinement questions. `null` when the server could not resolve it. */
  build: BikeBuild | null;
  locale: Locale;
  bikeParam: string;
  onChange: (item: BuildListItem) => void;
  className?: string;
}

export function BuildItemCard({
  item,
  build,
  locale,
  bikeParam,
  onChange,
  className,
}: BuildItemCardProps): React.JSX.Element {
  const t = useTranslations("shop");
  const tRoot = useTranslations();

  // Memoised because it feeds two `useMemo` dependency lists: `?? {}` would be
  // a new object on every render, and both would recompute for nothing.
  const refinement = useMemo(() => item.refinement ?? {}, [item.refinement]);
  const answers = useMemo(
    () => (build === null ? {} : refinementAnswers(build, item.partId, refinement)),
    [build, item.partId, refinement],
  );
  const issues = useMemo(
    () => (build === null ? [] : refinementIssues(build, item.partId, refinement)),
    [build, item.partId, refinement],
  );
  const query = buildQuery(item.partId, answers, locale);

  return (
    <Card
      className={cn("h-full", className)}
      data-testid="build-item"
      data-item-id={item.id}
      data-part-id={item.partId}
      data-action={item.action}
      data-done={item.done}
      data-print-card
    >
      <CardHeader className="gap-1">
        <CardTitle className="text-lg">{partLabel(locale, item.partId)}</CardTitle>
        <p className="text-ink-muted text-sm" data-testid="build-item-reason">
          {translateMessageKey(tRoot, `guides.reasons.${item.reasonKey}`)}
        </p>
        <label className="tap-target text-ink flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={item.done}
            onChange={(event) =>
              onChange({
                ...item,
                done: event.currentTarget.checked,
                doneReason: event.currentTarget.checked ? "manual" : undefined,
              })
            }
            data-testid="build-item-done"
          />
          {t("list.done.label")}
        </label>
        {item.done && item.doneReason === "recheck-ok" ? (
          <p className="text-success-fg text-xs">{t("list.done.auto")}</p>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {item.guideSlug === undefined ? null : (
          <p>
            <Link
              href={{ pathname: "/guides/[slug]", params: { slug: item.guideSlug } }}
              className="text-accent flex min-h-[var(--tap-min)] w-fit items-center underline"
              data-testid="build-item-guide"
            >
              {t("list.item.guide")}
            </Link>
          </p>
        )}

        {item.chosenProduct === undefined ? null : (
          <p className="text-ink-muted text-sm" data-testid="build-item-chosen">
            {t("list.item.chosen", {
              brand: item.chosenProduct.brand,
              model: item.chosenProduct.model,
            })}
          </p>
        )}

        {build === null ? null : (
          <RefinementForm
            build={build}
            partId={item.partId}
            refinement={refinement}
            locale={locale}
            itemId={item.id}
            onChange={(next) => onChange({ ...item, refinement: next })}
          />
        )}

        {issues.length === 0 ? null : (
          <Callout
            tone={issues[0].severity === "error" ? "danger" : "warning"}
            role="alert"
            title={t("list.compat.title")}
            data-testid="build-item-compat"
          >
            <ul className="list-disc pl-4">
              {issues.map((issue) => (
                <li key={issue.ruleId}>
                  {translateMessageKey(tRoot, issue.messageKey)}{" "}
                  {issue.fixHintKey === undefined ? null : (
                    <span className="text-ink-muted">
                      {translateMessageKey(tRoot, issue.fixHintKey)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Callout>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-ink text-sm font-semibold">{t("list.item.vendors")}</h3>
          <VendorButtons
            partId={item.partId}
            query={query}
            locale={locale}
            testId={`vendor-buttons-${item.partId}`}
          />
          <p data-print="hide">
            <Link
              href={{
                pathname: "/acheter",
                query: { part: item.partId, bike: bikeParam, item: item.id },
              }}
              className="text-accent flex min-h-[var(--tap-min)] w-fit items-center underline"
              data-testid="build-item-buying-guide"
            >
              {t("list.item.buyingGuide")}
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
