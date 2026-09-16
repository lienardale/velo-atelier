import { Wrench } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ToolId } from "@/lib/domain/data/tools";

/**
 * `<Tool id="allen-keys" alt="multi-tool" />` inside a guide: the tool's name as
 * an inline chip, with its stand-in when the author names one. Ids are checked
 * against the tool catalogue by `npm run content:check`.
 */
export function Tool({ id, alt }: { id: string; alt?: string }): React.JSX.Element {
  const t = useTranslations("tools");
  const tg = useTranslations("guides");
  const label = (toolId: string) => t(`${toolId as ToolId}.label`);

  return (
    <span
      data-tool-id={id}
      className="inline-flex items-baseline gap-1 rounded-sm bg-paper-2 px-1.5 font-medium text-ink"
    >
      <Wrench aria-hidden="true" className="size-3.5 self-center text-ink-muted" />
      {label(id)}
      {alt ? (
        <span className="font-normal text-ink-muted">
          {" "}
          ({tg("tools.separator")} {label(alt)})
        </span>
      ) : null}
    </span>
  );
}
