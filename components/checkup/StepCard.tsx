"use client";

import { useTranslations } from "next-intl";

import { Callout } from "@/components/ui-ext/Callout";
import { Stepper } from "@/components/ui-ext/Stepper";
import { StepScope } from "@/components/mdx/StepScope";
import type { CheckStepRef } from "@/lib/checkup/types";
import type { ToolId } from "@/lib/domain/data/tools";
import type { ToolRef } from "@/lib/checkup/types";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * One question, with the guide's own words above it (§5.2, §6.5).
 *
 * `guideNode` is the guide's ENTIRE compiled tree, rendered once on the server
 * and handed down as a node. Wrapping it in `<StepScope activeStepId>` is what
 * shows one step of it: `<Step>` is a client leaf that renders `null` unless
 * the scope names it. Nothing is re-fetched between questions of the same
 * guide, no guide code reaches the browser, and the static CSP of §1.3 holds.
 *
 * Above the guide's text sit the two things the guide cannot know: where the
 * visitor is in THIS checkup (the stepper), and which of the tools it asks for
 * they said they do not have — with the stand-in, or with the plain admission
 * that there isn't one.
 */
export interface StepCardProps {
  step: CheckStepRef;
  index: number;
  total: number;
  /** The whole guide, pre-rendered on the server; `null` if it is missing. */
  guideNode: React.ReactNode;
  /** The step's tools the visitor ticked as missing. */
  substitutions: readonly ToolRef[];
  labelOf: (toolId: ToolId) => string;
  children?: React.ReactNode;
  className?: string;
}

export function StepCard({
  step,
  index,
  total,
  guideNode,
  substitutions,
  labelOf,
  children,
  className,
}: StepCardProps): React.JSX.Element {
  const t = useTranslations("checkup");
  const position = t("step.progress", { current: index + 1, total });

  return (
    <section
      data-testid="step-card"
      data-step-key={step.key}
      data-guide-slug={step.guideSlug}
      aria-live="polite"
      className={cn("flex flex-col gap-4", className)}
    >
      <Stepper
        current={index + 1}
        total={total}
        label={position}
        countLabel={t("step.counter", { current: index + 1, total })}
        title={step.title}
      />

      {step.stub === true ? (
        <p className="text-sm text-ink-muted" data-testid="step-stub-badge">
          {t("stubBadge")}
        </p>
      ) : null}

      {substitutions.length > 0 ? (
        <Callout tone="warning" title={t("step.substitutionTitle")} data-testid="tool-substitution">
          <ul className="flex flex-col gap-1">
            {substitutions.map((tool) => (
              <li key={tool.toolId} data-tool-id={tool.toolId}>
                {tool.alternatives.length === 0
                  ? t("step.substitutionNone", { tool: labelOf(tool.toolId) })
                  : t("step.substitution", {
                      tool: labelOf(tool.toolId),
                      alternatives: tool.alternatives.map(labelOf).join(", "),
                    })}
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <div data-testid="step-body" className="min-w-0">
        <StepScope activeStepId={step.stepId}>{guideNode}</StepScope>
      </div>

      <Link
        href={{ pathname: "/guides/[slug]", params: { slug: step.guideSlug } }}
        prefetch={false}
        className="tap-target inline-flex items-center self-start text-accent underline"
        data-testid="step-guide-link"
      >
        {t("step.guide")}
      </Link>

      {children}
    </section>
  );
}
