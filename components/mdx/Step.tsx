"use client";

import { useTranslations } from "next-intl";

import { useActiveStepId } from "./StepScope";

export interface StepProps {
  id: string;
  /** From the frontmatter (`steps[].title`), resolved on the server. */
  title: string;
  /** 1-based position in the guide. */
  number: number;
  /** The step's frontmatter illustration, already rendered on the server. */
  illustration?: React.ReactNode;
  children?: React.ReactNode;
}

/** The DOM id of a step's section — what the table of contents links to. */
export function stepAnchor(id: string): string {
  return `step-${id}`;
}

/**
 * One step of a guide (§5.2): a client leaf, so the wizard can show one step of
 * a server-rendered guide at a time. It renders `null` unless the surrounding
 * `StepScope` shows every step or this one.
 *
 * `title`, `number` and `illustration` are filled in on the server by
 * `GuideContent` from the frontmatter — an MDX author only writes
 * `<Step id="pad-wear">…</Step>`.
 */
export function Step({
  id,
  title,
  number,
  illustration,
  children,
}: StepProps): React.JSX.Element | null {
  const activeStepId = useActiveStepId();
  const t = useTranslations("guides");
  if (activeStepId !== null && activeStepId !== id) return null;

  const headingId = `${stepAnchor(id)}-title`;
  return (
    <section
      id={stepAnchor(id)}
      data-step-id={id}
      aria-labelledby={headingId}
      className="scroll-mt-[calc(var(--header-h)+1rem)] border-t border-rule pt-8 first:border-t-0 first:pt-0"
    >
      <h2 id={headingId} className="flex flex-col gap-1 text-2xl font-semibold">
        <span className="text-sm font-semibold tracking-wide text-accent uppercase">
          {t("step.label", { number })}
        </span>
        <span>{title}</span>
      </h2>
      {illustration ? <div className="mt-4">{illustration}</div> : null}
      <div className="guide-prose mt-4 flex flex-col gap-4 leading-relaxed">{children}</div>
    </section>
  );
}
