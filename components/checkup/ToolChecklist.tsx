"use client";

import { useTranslations } from "next-intl";

import type { ToolId } from "@/lib/domain/data/tools";
import type { ToolRef } from "@/lib/checkup/types";
import { cn } from "@/lib/utils";

/**
 * What this checkup asks you to have, before it asks its first question
 * (§6.5).
 *
 * The honest thing to show someone about to spend twenty minutes on their bike
 * is the whole tool list up front, not a surprise on step 9. Ticking "je n'ai
 * pas cet outil" is not a complaint form: it is remembered in the checkup
 * (`TOOL_MISSING`) and the steps that need that tool then say what to use
 * instead — or say plainly that there is nothing to use instead, which is the
 * answer for a chain whip.
 *
 * A native `<input type="checkbox">` inside a 44 px label: the row is the
 * target (§6.8 AC5), the label is the accessible name, and a screen reader
 * hears a checkbox rather than a button pretending to be one.
 */
export interface ToolChecklistProps {
  tools: readonly ToolRef[];
  missing: readonly ToolId[];
  onToggle: (toolId: ToolId, missing: boolean) => void;
  /** `tools.<id>.label`, resolved by the caller so this owns no namespace. */
  labelOf: (toolId: ToolId) => string;
  className?: string;
}

export function ToolChecklist({
  tools,
  missing,
  onToggle,
  labelOf,
  className,
}: ToolChecklistProps): React.JSX.Element {
  const t = useTranslations("checkup");

  return (
    <section
      data-testid="tool-checklist"
      aria-labelledby="tool-checklist-title"
      className={cn("flex flex-col gap-3", className)}
    >
      <h2 id="tool-checklist-title" className="font-display text-lg font-semibold text-ink">
        {t("tools.title")}
      </h2>

      {tools.length === 0 ? (
        <p className="text-ink-muted">{t("tools.none")}</p>
      ) : (
        <>
          <p className="text-ink-muted">{t("tools.intro")}</p>
          <ul className="flex flex-col gap-1">
            {tools.map((tool) => {
              const isMissing = missing.includes(tool.toolId);
              return (
                <li key={tool.toolId} data-tool-id={tool.toolId}>
                  <label className="tap-target flex cursor-pointer items-center gap-3 rounded-md px-2 py-1 hover:bg-paper-2">
                    <input
                      type="checkbox"
                      className="size-5 accent-accent"
                      checked={isMissing}
                      onChange={(event) => onToggle(tool.toolId, event.currentTarget.checked)}
                      data-testid={`tool-missing-${tool.toolId}`}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-ink">{labelOf(tool.toolId)}</span>
                      <span className="text-sm text-ink-muted">
                        {isMissing ? null : t("tools.missing")}
                      </span>
                    </span>
                  </label>
                  {isMissing ? (
                    <p
                      className="pl-10 text-sm text-warn-fg"
                      data-testid={`tool-alternative-${tool.toolId}`}
                    >
                      {tool.alternatives.length === 0
                        ? t("tools.noAlternative")
                        : t("tools.alternative", {
                            alternatives: tool.alternatives.map(labelOf).join(", "),
                          })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
