import { Clock, Gauge } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { GuideFrontmatter } from "@/lib/content/types";

/**
 * The top of a guide page (§6.2): kind badge, `<h1>`, summary, difficulty and
 * time. Difficulty is written out ("Intermédiaire"), never shown as dots only.
 */
export function GuideHeader({
  guide,
}: {
  guide: Pick<GuideFrontmatter, "kind" | "title" | "summary" | "difficulty" | "minutes">;
}): React.JSX.Element {
  const t = useTranslations("guides");

  return (
    <header className="flex flex-col gap-4">
      <Badge data-kind={guide.kind} className="px-2.5 py-1 text-sm">
        {t(`kinds.${guide.kind}`)}
      </Badge>
      <h1 className="text-3xl font-semibold sm:text-4xl">{guide.title}</h1>
      <p className="max-w-3xl text-lg text-ink-muted">{guide.summary}</p>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2" data-testid="guide-difficulty">
          <Gauge aria-hidden="true" className="size-4 text-ink-muted" />
          <dt className="text-ink-muted">{t("difficulty.label")}</dt>
          <dd className="font-medium">
            {t("difficulty.value", { level: String(guide.difficulty) })}
          </dd>
        </div>
        <div className="flex items-center gap-2" data-testid="guide-duration">
          <Clock aria-hidden="true" className="size-4 text-ink-muted" />
          <dt className="text-ink-muted">{t("duration.label")}</dt>
          <dd className="font-medium">{t("duration.value", { minutes: guide.minutes })}</dd>
        </div>
      </dl>
    </header>
  );
}
