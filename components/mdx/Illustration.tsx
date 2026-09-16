import { useTranslations } from "next-intl";
import { createElement } from "react";

import { illustrationComponent } from "@/components/illustrations";
import { illustrationDefinition } from "@/lib/content/illustrations";
import { cn } from "@/lib/utils";

/**
 * A registered drawing with its numbered legend (§5.3) — used for a step's
 * frontmatter `illustration` and for `<Illustration id caption?>` in a body.
 *
 * Server-rendered: it imports the illustration barrel, which must never land in
 * a client bundle. The wizard receives it as an already-rendered node.
 *
 * The drawing names itself (`<title>` from `illustrations.<id>.alt`); the
 * legend reads `illustrations.<id>.callouts.<n>` for n = 1, 2, … until a key is
 * missing — the content check guarantees the count matches the drawing.
 */
export function Illustration({
  id,
  caption,
  className,
}: {
  id: string;
  caption?: string;
  className?: string;
}): React.JSX.Element | null {
  const t = useTranslations("illustrations");
  const definition = illustrationDefinition(id);
  const Drawing = definition ? illustrationComponent(definition.component) : undefined;
  if (!Drawing) return null;

  // Keys are data-driven here: `illustrations.<id>.callouts.<n>` is validated
  // by `npm run content:check`, not by the message types.
  const translate = t as unknown as ((key: string) => string) & { has: (key: string) => boolean };
  const callouts: string[] = [];
  for (let n = 1; translate.has(`${id}.callouts.${n}`); n++) {
    callouts.push(translate(`${id}.callouts.${n}`));
  }

  return (
    <figure
      data-illustration-figure={id}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-rule bg-paper-2/50 p-3",
        className,
      )}
    >
      {/* createElement: the component is looked up in a static registry, not created here. */}
      {createElement(Drawing, { className: "mx-auto h-auto w-full max-w-md text-ink" })}
      {callouts.length > 0 || caption ? (
        <figcaption className="flex flex-col gap-2 text-sm text-ink-muted">
          {caption ? <p>{caption}</p> : null}
          {callouts.length > 0 ? (
            <ol className="grid gap-1 sm:grid-cols-2">
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
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
