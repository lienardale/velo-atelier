import { Wrench } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ToolId } from "@/lib/domain/data/tools";
import type { ProcedureTool } from "@/lib/domain/schema/procedure";

/**
 * "Outils nécessaires" (§6.2): every tool of a guide with what can stand in
 * for it. The checkup's `ToolChecklist` (W3-T1) builds on the same data.
 */
export function ToolsList({
  tools,
  headingLevel = 2,
}: {
  tools: readonly ProcedureTool[];
  headingLevel?: 2 | 3;
}): React.JSX.Element {
  const t = useTranslations("guides");
  const tt = useTranslations("tools");
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const label = (id: string) => tt(`${id as ToolId}.label`);

  return (
    <section aria-labelledby="tools-title" data-testid="tools-list" className="flex flex-col gap-3">
      <Heading id="tools-title" className="text-xl font-semibold">
        {t("tools.title")}
      </Heading>
      {tools.length === 0 ? (
        <p className="text-ink-muted">{t("tools.none")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {tools.map((tool) => (
            <li
              key={tool.toolId}
              data-tool-id={tool.toolId}
              className="flex items-start gap-3 rounded-md border border-rule px-3 py-2"
            >
              <Wrench aria-hidden="true" className="mt-1 size-4 shrink-0 text-ink-muted" />
              <div className="min-w-0">
                <p className="font-medium">{label(tool.toolId)}</p>
                {tool.alternatives.length > 0 ? (
                  <p className="text-sm text-ink-muted" data-testid="tool-alternatives">
                    {t("tools.alternatives", {
                      tools: tool.alternatives.map(label).join(` ${t("tools.separator")} `),
                    })}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
