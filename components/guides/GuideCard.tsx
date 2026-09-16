import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { GuideSummary } from "@/lib/content/types";
import { Link } from "@/lib/i18n/navigation";

/**
 * One guide in a list (`/guides`, related guides): kind, title, summary,
 * difficulty and time. The whole card is one link target (the title link is
 * stretched), so a tap anywhere opens the guide.
 *
 * Shared, not client-only: rendered on the server for the static list and by
 * the client filter once it hydrates.
 */
export function GuideCard({
  guide,
  headingLevel = 2,
}: {
  guide: Pick<
    GuideSummary,
    "slug" | "kind" | "title" | "summary" | "difficulty" | "minutes" | "status"
  >;
  headingLevel?: 2 | 3;
}): React.JSX.Element {
  const t = useTranslations("guides");
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <article
      data-guide-slug={guide.slug}
      data-kind={guide.kind}
      className="relative flex h-full flex-col gap-3 rounded-lg border border-rule bg-paper p-4 hover:border-accent focus-within:border-accent"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t(`kinds.${guide.kind}`)}</Badge>
      </div>
      <Heading className="text-lg font-semibold">
        <Link
          href={{ pathname: "/guides/[slug]", params: { slug: guide.slug } }}
          className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none"
        >
          {guide.title}
        </Link>
      </Heading>
      <p className="flex-1 text-sm text-ink-muted">{guide.summary}</p>
      <p className="flex items-center justify-between gap-2 text-sm text-ink-muted">
        <span>
          {t("difficulty.value", { level: String(guide.difficulty) })} ·{" "}
          {t("duration.value", { minutes: guide.minutes })}
        </span>
        <ArrowRight aria-hidden="true" className="size-4 text-accent" />
      </p>
    </article>
  );
}

/** The card grid of `/guides` — the static fallback and the filtered list alike. */
export function GuideGrid({
  guides,
}: {
  guides: ReadonlyArray<Parameters<typeof GuideCard>[0]["guide"]>;
}): React.JSX.Element {
  return (
    <ul data-testid="guide-list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {guides.map((guide) => (
        <li key={guide.slug}>
          <GuideCard guide={guide} />
        </li>
      ))}
    </ul>
  );
}
