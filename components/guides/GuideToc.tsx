"use client";

import { ListOrdered } from "lucide-react";
import { useTranslations } from "next-intl";

import { useActiveStepId } from "@/components/mdx/StepScope";
import { stepAnchor } from "@/components/mdx/Step";
import type { GuideTocEntry } from "@/lib/content/types";

/**
 * The table of contents (§6.2): one link per step. Collapsed into a disclosure
 * below 768 px, an open list from `md` up. Rendered only while every step is
 * on screen — inside the checkup wizard (`StepScope` with an active step) it
 * disappears (§5.2).
 */
export function GuideToc({
  entries,
}: {
  entries: readonly GuideTocEntry[];
}): React.JSX.Element | null {
  const t = useTranslations("guides");
  const activeStepId = useActiveStepId();
  if (activeStepId !== null || entries.length === 0) return null;

  const list = (
    <ol className="flex flex-col gap-1">
      {entries.map((entry, index) => (
        <li key={entry.id}>
          <a
            href={`#${stepAnchor(entry.id)}`}
            className="flex min-h-[var(--tap-min)] items-center gap-3 rounded-md px-2 text-sm text-ink hover:bg-paper-2"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-paper-2 text-xs font-semibold text-ink-muted"
            >
              {index + 1}
            </span>
            {entry.title}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <nav aria-label={t("toc.title")} data-testid="guide-toc" className="text-sm">
      <details className="group rounded-md border border-rule md:hidden">
        <summary className="tap-target w-full cursor-pointer list-none justify-start gap-2 px-3 font-medium [&::-webkit-details-marker]:hidden">
          <ListOrdered aria-hidden="true" className="size-4 text-ink-muted" />
          {t("toc.show")}
        </summary>
        <div className="border-t border-rule p-2">{list}</div>
      </details>
      <div className="hidden md:block">
        <p className="mb-2 font-semibold">{t("toc.title")}</p>
        {list}
      </div>
    </nav>
  );
}
