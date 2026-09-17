import { useTranslations } from "next-intl";

import { Disclosure } from "@/components/ui-ext/Disclosure";
import type { GeometryMeasure } from "@/lib/domain/data/geometry-measures";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * One card of `/velo/[id]/reglages` (§5.6): what the measurement is, the guide
 * that shows how to take it, and the form that remembers it.
 *
 * The **how** is a link, not a paragraph. Every measure points at a `measure`
 * or `adjust` guide that is `status: full` in both locales
 * (`lib/domain/data/geometry-measures.ts` and the W1 test that pins it), so the
 * card can stay a card: a title, a sentence of help, and the number.
 *
 * Shared, not client-only — the form inside it is the client part. That keeps
 * the titles, the help text and the guide links in the server payload, where
 * they cost no JavaScript.
 */
export interface MeasureCardProps {
  measure: GeometryMeasure;
  /** The measurement form for this measure, built by the page. */
  children: React.ReactNode;
  className?: string;
}

export function MeasureCard({ measure, children, className }: MeasureCardProps): React.JSX.Element {
  const t = useTranslations("bike");
  const tRoot = useTranslations();

  return (
    <section
      aria-labelledby={`measure-${measure.id}`}
      data-measure={measure.id}
      className={cn("border-rule bg-paper rounded-lg border p-4", className)}
    >
      <h2 id={`measure-${measure.id}`} className="font-display text-ink text-lg font-semibold">
        {tRoot(measure.labelKey as never)}
      </h2>
      <p className="text-ink-muted mt-1 text-sm">{tRoot(measure.helpKey as never)}</p>

      <Disclosure summary={t("fit.howTo")} persistKey={`fit-how-${measure.id}`} className="mt-3">
        <Link
          href={{ pathname: "/guides/[slug]", params: { slug: measure.guideSlug } }}
          prefetch={false}
          className="text-accent flex min-h-[var(--tap-min)] items-center underline"
          data-measure-guide={measure.id}
        >
          {t("fit.openGuide")}
        </Link>
      </Disclosure>

      <div className="mt-3">{children}</div>
    </section>
  );
}
