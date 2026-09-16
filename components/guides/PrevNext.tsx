import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import type { GuideSummary } from "@/lib/content/types";
import { Link } from "@/lib/i18n/navigation";

type Neighbour = Pick<GuideSummary, "slug" | "title"> | null;

/** "Guide précédent / suivant" in the sorted list of the locale. */
export function PrevNext({
  previous,
  next,
}: {
  previous: Neighbour;
  next: Neighbour;
}): React.JSX.Element | null {
  const t = useTranslations("guides");
  if (!previous && !next) return null;

  const linkClass =
    "flex min-h-[var(--tap-min)] flex-1 flex-col gap-1 rounded-lg border border-rule px-4 py-3 hover:border-accent";

  return (
    <nav aria-label={t("prevNext.label")} className="flex flex-col gap-3 sm:flex-row">
      {previous ? (
        <Link
          href={{ pathname: "/guides/[slug]", params: { slug: previous.slug } }}
          rel="prev"
          className={linkClass}
        >
          <span className="flex items-center gap-1 text-sm text-ink-muted">
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("prevNext.previous")}
          </span>
          <span className="font-medium">{previous.title}</span>
        </Link>
      ) : (
        <span className="hidden flex-1 sm:block" />
      )}
      {next ? (
        <Link
          href={{ pathname: "/guides/[slug]", params: { slug: next.slug } }}
          rel="next"
          className={`${linkClass} sm:items-end sm:text-right`}
        >
          <span className="flex items-center gap-1 text-sm text-ink-muted">
            {t("prevNext.next")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </span>
          <span className="font-medium">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}
