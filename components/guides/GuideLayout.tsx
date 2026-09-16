import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { MyBikeLink } from "@/components/layout/MyBikeLink";
import { Callout } from "@/components/ui-ext/Callout";
import { tocOf } from "@/lib/content/guides";
import type { GuideDocument, GuideSummary } from "@/lib/content/types";
import { Link } from "@/lib/i18n/navigation";

import { AppliesToBanner } from "./AppliesToBanner";
import { GuideCard } from "./GuideCard";
import { GuideHeader } from "./GuideHeader";
import { GuideToc } from "./GuideToc";
import { PrevNext } from "./PrevNext";
import { ToolsList } from "./ToolsList";

type Neighbour = Pick<GuideSummary, "slug" | "title"> | null;

/**
 * The anatomy of a guide page (§6.2): breadcrumb, header, stub banner, safety
 * notes, "which bikes", tools, table of contents, the steps (`children` — the
 * server-rendered MDX), related guides, "see it on my bike", previous / next.
 *
 * A server component with no request API: guide pages stay static.
 */
export function GuideLayout({
  guide,
  related,
  previous,
  next,
  children,
}: {
  guide: Pick<
    GuideDocument,
    | "kind"
    | "title"
    | "summary"
    | "difficulty"
    | "minutes"
    | "status"
    | "safety"
    | "appliesTo"
    | "tools"
    | "steps"
  >;
  related: ReadonlyArray<
    Pick<GuideSummary, "slug" | "kind" | "title" | "summary" | "difficulty" | "minutes" | "status">
  >;
  previous: Neighbour;
  next: Neighbour;
  children: React.ReactNode;
}): React.JSX.Element {
  const t = useTranslations("guides");

  return (
    <article className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:py-12">
      <nav aria-label={t("breadcrumb.label")} className="text-sm text-ink-muted">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="hover:text-ink hover:underline">
              {t("breadcrumb.home")}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/guides" className="hover:text-ink hover:underline">
              {t("breadcrumb.guides")}
            </Link>
          </li>
        </ol>
      </nav>

      <GuideHeader guide={guide} />

      {guide.status === "stub" ? (
        <Callout tone="info" data-testid="stub-banner">
          <p>{t("stubBanner")}</p>
        </Callout>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <AppliesToBanner appliesTo={guide.appliesTo} />
        {guide.safety ? (
          <Callout
            tone="danger"
            title={t("safety.title")}
            icon={<ShieldAlert className="size-4" />}
            data-testid="safety-notes"
          >
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {guide.safety.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Callout>
        ) : null}
      </div>

      <ToolsList tools={guide.tools} />

      <div className="grid gap-8 md:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="md:sticky md:top-[calc(var(--header-h)+1rem)] md:self-start">
          <GuideToc entries={tocOf(guide)} />
        </div>
        <div className="flex min-w-0 flex-col gap-10" data-testid="guide-steps">
          {children}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <MyBikeLink className="tap-target rounded-md bg-accent px-5 font-medium text-accent-fg hover:opacity-90">
          {t("seeOnMyBike")}
        </MyBikeLink>
      </div>

      {related.length > 0 ? (
        <section aria-labelledby="related-title" className="flex flex-col gap-4">
          <h2 id="related-title" className="text-xl font-semibold">
            {t("related.title")}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((item) => (
              <li key={item.slug}>
                <GuideCard guide={item} headingLevel={3} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PrevNext previous={previous} next={next} />
    </article>
  );
}
