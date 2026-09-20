"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { SummarySection } from "@/lib/checkup/selectors";
import type { CheckStepRef } from "@/lib/checkup/types";
import { cn } from "@/lib/utils";

/** What the counts line says — a subset of `progressOf`'s result. */
export interface CheckupProgressCounts {
  ok: number;
  ko: number;
  skipped: number;
}

/**
 * What you said, before it becomes a shopping list (§6.5).
 *
 * Grouped by verdict rather than kept in plan order, because the question the
 * visitor has at the end is "what did I find?", not "what did I answer
 * fourteenth". Every line is still editable — "Modifier" jumps back to that
 * question — and changing a verdict re-opens the checkup, so the list that gets
 * created is always the one the visitor last agreed to.
 *
 * "Créer ma liste" is the only way out, and it stays disabled while a question
 * has no verdict: a to-fix list built from half a checkup would quietly claim
 * the other half was fine.
 */
export interface CheckupSummaryProps {
  sections: readonly SummarySection[];
  counts: CheckupProgressCounts;
  /** Questions with no verdict yet — the button stays disabled while there are any. */
  open: readonly CheckStepRef[];
  onEdit: (key: string) => void;
  onCreate: () => void;
  creating: boolean;
  className?: string;
}

export function CheckupSummary({
  sections,
  counts,
  open,
  onEdit,
  onCreate,
  creating,
  className,
}: CheckupSummaryProps): React.JSX.Element {
  const t = useTranslations("checkup");

  return (
    <section
      data-testid="checkup-summary"
      aria-labelledby="checkup-summary-title"
      className={cn("flex flex-col gap-6", className)}
    >
      <header className="flex flex-col gap-1">
        <h2 id="checkup-summary-title" className="font-display text-xl font-semibold text-ink">
          {t("summary.title")}
        </h2>
        <p className="text-ink-muted">{t("summary.intro")}</p>
        <p className="text-sm text-ink-muted" data-testid="summary-counts">
          {t("summary.counts", { ok: counts.ok, ko: counts.ko, skipped: counts.skipped })}
        </p>
      </header>

      {sections.map((section) => (
        <div key={section.group} data-testid={`summary-group-${section.group}`}>
          <h3 className="mb-2 font-medium text-ink">{t(`summary.${section.group}`)}</h3>
          {section.steps.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("summary.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-rule border-y border-rule">
              {section.steps.map((step) => (
                <li
                  key={step.key}
                  data-step-key={step.key}
                  className="flex min-h-[var(--tap-min)] flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="min-w-0 flex-1 text-ink">{step.title}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="tap-target"
                    onClick={() => onEdit(step.key)}
                    data-testid={`summary-edit-${step.key}`}
                  >
                    {t("summary.edit")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {open.length > 0 ? (
        <p className="text-warn-fg" data-testid="summary-open">
          {t("summary.open", { count: open.length })}
        </p>
      ) : counts.ko === 0 ? (
        <p className="text-success-fg" data-testid="summary-nothing-to-do">
          {t("summary.nothingToDo")}
        </p>
      ) : null}

      <Button
        type="button"
        className="tap-target self-start"
        disabled={open.length > 0 || creating}
        onClick={onCreate}
        data-testid="summary-create"
      >
        {t("summary.create")}
      </Button>
    </section>
  );
}
