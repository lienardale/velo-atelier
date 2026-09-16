import { MDXContent } from "@content-collections/mdx/react";

import type { GuideDocument } from "@/lib/content/types";

import { Illustration } from "./Illustration";
import { Measure } from "./Measure";
import { Step } from "./Step";
import { Tool } from "./Tool";
import { Warning } from "./Warning";

/**
 * The components a guide's MDX body may use — exactly the set
 * `lib/content/check.ts` (`MDX_COMPONENTS`) accepts.
 *
 * `Step` is bound to the guide here, on the server: the author writes
 * `<Step id="pad-wear">`, and the frontmatter supplies the title, the number
 * and the pre-rendered illustration.
 */
export function guideComponents(guide: Pick<GuideDocument, "steps">) {
  const steps = new Map(guide.steps.map((step, index) => [step.id, { step, number: index + 1 }]));

  function GuideStep({ id, children }: { id: string; children?: React.ReactNode }) {
    const entry = steps.get(id);
    return (
      <Step
        id={id}
        title={entry?.step.title ?? id}
        number={entry?.number ?? 0}
        illustration={
          entry?.step.illustration ? <Illustration id={entry.step.illustration} /> : undefined
        }
      >
        {children}
      </Step>
    );
  }

  return { Step: GuideStep, Tool, Warning, Illustration, Measure };
}

/**
 * Render a guide's compiled MDX — in a React Server Component only (§5.2).
 *
 * `MDXContent` resolves to `@content-collections/mdx`'s `react-server` build,
 * which evaluates the compiled code with `new Function` on the server during
 * prerendering. The browser receives the rendered tree and the client leaves
 * (`Step`, `StepScope`, `Measure`), never the guide code: `grep -r "new
 * Function" .next/static` is part of the acceptance.
 */
export function GuideContent({ guide }: { guide: Pick<GuideDocument, "mdx" | "steps"> }) {
  return <MDXContent code={guide.mdx} components={guideComponents(guide)} />;
}
