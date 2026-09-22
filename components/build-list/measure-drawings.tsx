import { useTranslations } from "next-intl";
import { createElement, type ReactNode } from "react";

import { illustrationComponent } from "@/components/illustrations";
import { illustrationDefinition } from "@/lib/content/illustrations";
import { measureDrawingFor } from "@/lib/shop/measure-drawings";

/**
 * The build list's "Comment mesurer" drawings, rendered on the SERVER and
 * handed to the client form as nodes — the `tree-illustrations.tsx` pattern
 * (§5.3): the illustration barrel never reaches a client bundle, and nothing
 * is fetched.
 *
 * **Decorative, with the legend.** The same node can land in several cards
 * (the chain's and the cassette's `speeds`), and an informative drawing names
 * itself through a `<title id>` — twice on one page is a duplicate id. The
 * question's own help text already says what to read off the bike, so the
 * drawing is `aria-hidden` and its numbered callouts keep their legend
 * (`illustrations.<id>.callouts.<n>`), which is what makes a "1" on the frame
 * mean something.
 *
 * Never import this module from a `"use client"` file.
 */
function MeasureFigure({ id }: { id: string }): ReactNode {
  const t = useTranslations("illustrations");
  const definition = illustrationDefinition(id);
  const Drawing = definition ? illustrationComponent(definition.component) : undefined;
  if (Drawing === undefined) return null;

  // Data-driven keys, validated by `npm run content:check`, not by the message types.
  const translate = t as unknown as ((key: string) => string) & { has: (key: string) => boolean };
  const callouts: string[] = [];
  for (let n = 1; translate.has(`${id}.callouts.${n}`); n++) {
    callouts.push(translate(`${id}.callouts.${n}`));
  }

  return (
    <figure data-measure-drawing={id} className="mt-2 flex flex-col gap-2">
      {/* createElement: the component is looked up in a static registry, not created here. */}
      {createElement(Drawing, {
        className: "mx-auto h-auto w-full max-w-xs text-ink",
        decorative: true,
      })}
      {callouts.length === 0 ? null : (
        <figcaption>
          <ol className="grid gap-1 text-xs text-ink-muted">
            {callouts.map((text, index) => (
              <li key={text} className="flex items-baseline gap-2">
                <span
                  aria-hidden="true"
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-ink-muted font-semibold"
                >
                  {index + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </figcaption>
      )}
    </figure>
  );
}

/** One drawing per attribute key that has one, keyed by the attribute. */
export function renderMeasureDrawings(keys: Iterable<string>): Record<string, ReactNode> {
  const nodes: Record<string, ReactNode> = {};
  for (const key of new Set(keys)) {
    const id = measureDrawingFor(key);
    // eslint-disable-next-line security/detect-object-injection -- `key` is an attribute key of the catalogue, into a fresh literal
    if (id !== undefined) nodes[key] = createElement(MeasureFigure, { id });
  }
  return nodes;
}
