import { useTranslations } from "next-intl";
import { createElement, type ReactNode } from "react";

import { illustrationComponent } from "@/components/illustrations";
import { DECISION_TREE } from "@/lib/domain/data/decision-tree";
import { ILLUSTRATIONS, type IllustrationId } from "@/lib/domain/data/illustrations";

/** Every drawing the tree can show, already rendered, keyed by illustration id. */
export type TreeIllustrations = Readonly<Partial<Record<IllustrationId, ReactNode>>>;

/** Class names of the two uses, shared with the tests. */
export const HELP_ILLUSTRATION_CLASS =
  "mx-auto h-auto w-full max-w-xs shrink-0 text-ink sm:mx-0 sm:w-56";
export const THUMBNAIL_ILLUSTRATION_CLASS = "mx-auto h-auto w-full max-w-[8rem]";

function render(id: IllustrationId, props: { className: string; decorative: boolean }): ReactNode {
  // eslint-disable-next-line security/detect-object-injection -- `id` is an IllustrationId, a key of the manifest
  const Drawing = illustrationComponent(ILLUSTRATIONS[id].component);
  // createElement: the component comes from a static registry, it is not created here.
  return Drawing === undefined ? null : createElement(Drawing, props);
}

/**
 * A help drawing with the legend for its numbered callouts — the same contract
 * `components/mdx/Illustration.tsx` gives a guide's drawings, because a "1"
 * inked on a frame is meaningless without the line that names it.
 *
 * A server component so the barrel and the message catalogue stay out of the
 * client bundle: `renderTreeIllustrations` returns the element, and the client
 * tree receives it already rendered.
 *
 * Keys are read `illustrations.<id>.callouts.<n>` for n = 1, 2, … until one is
 * missing; `npm run content:check --strict` guarantees the count matches the
 * `data-callout` attributes in the drawing.
 */
function HelpFigure({ id, drawing }: { id: IllustrationId; drawing: ReactNode }): ReactNode {
  const t = useTranslations("illustrations");
  // Data-driven keys: validated by the content check, not by the message types.
  const translate = t as unknown as ((key: string) => string) & { has: (key: string) => boolean };
  const callouts: string[] = [];
  for (let n = 1; translate.has(`${id}.callouts.${n}`); n++) {
    callouts.push(translate(`${id}.callouts.${n}`));
  }
  if (callouts.length === 0) return drawing;

  return (
    <figure data-illustration-figure={id} className="flex shrink-0 flex-col gap-2 sm:w-56">
      {drawing}
      <figcaption>
        <ol className="grid gap-1 text-sm text-ink-muted">
          {callouts.map((text, index) => (
            <li key={text} className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-ink-muted text-xs font-semibold"
              >
                {index + 1}
              </span>
              <span>
                <span className="sr-only">{index + 1}. </span>
                {text}
              </span>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}

/**
 * The decision tree's drawings, rendered on the SERVER and handed to the client
 * tree as React nodes — a help drawing inside `HelpFigure`, so its numbered
 * callouts arrive with the legend that names them (§5.3: the registry is
 * RSC-rendered and
 * ships zero client JS; `components/mdx/Illustration.tsx` follows the same
 * rule). The home page calls this and passes the result as a prop, so the SVG
 * markup travels in the RSC payload and none of the ~70 illustration
 * components lands in the `/[locale]` bundle.
 *
 * - each question's help drawing is **informative** (`role="img"` + `<title>`
 *   from `illustrations.<id>.alt`): it is what the help paragraph describes;
 * - option thumbnails are **decorative**: the card's label names the option.
 *
 * Whatever the registry holds is rendered — placeholders today, the finished
 * drawings once W2-T4c lands them.
 *
 * Never import this module from a `"use client"` file.
 */
export function renderTreeIllustrations(): TreeIllustrations {
  const nodes: Partial<Record<IllustrationId, ReactNode>> = {};
  for (const node of DECISION_TREE) {
    const id = node.help.illustrationId;
    // eslint-disable-next-line security/detect-object-injection -- `id` is an IllustrationId from the decision tree, not input
    nodes[id] = createElement(HelpFigure, {
      id,
      drawing: render(id, { className: HELP_ILLUSTRATION_CLASS, decorative: false }),
    });
    for (const option of node.options) {
      if (option.illustrationId === undefined) continue;
      nodes[option.illustrationId] = render(option.illustrationId, {
        className: THUMBNAIL_ILLUSTRATION_CLASS,
        decorative: true,
      });
    }
  }
  return nodes;
}
