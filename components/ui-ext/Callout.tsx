import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Tones map onto the status tokens of `styles/globals.css`: the plain colour is
 * the fill (border, tint), the `-fg` colour is the text/icon colour that holds
 * 4.5:1 on both papers in both themes (asserted by
 * `tests/unit/tokens-contrast.test.ts`).
 */
const calloutVariants = cva(
  "flex items-start gap-3 rounded-lg border-l-4 border-y border-r border-y-rule border-r-rule px-4 py-3 text-sm text-ink",
  {
    variants: {
      tone: {
        info: "border-l-accent bg-accent/5 [&>[data-slot=callout-icon]>svg]:text-accent",
        warning: "border-l-warn bg-warn/10 [&>[data-slot=callout-icon]>svg]:text-warn-fg",
        danger: "border-l-danger bg-danger/10 [&>[data-slot=callout-icon]>svg]:text-danger-fg",
        success: "border-l-success bg-success/10 [&>[data-slot=callout-icon]>svg]:text-success-fg",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

export type CalloutTone = NonNullable<VariantProps<typeof calloutVariants>["tone"]>;

// `title` is widened from the DOM's tooltip string to a node: a callout's
// title is rendered, not hovered.
export interface CalloutProps extends Omit<React.ComponentProps<"div">, "title"> {
  tone?: CalloutTone;
  /** Optional bold first line. */
  title?: React.ReactNode;
  /**
   * Replace the tone's default icon, or pass `false` for no icon at all.
   * The icon is always `aria-hidden`: the tone is carried by the text, never
   * by the picture (WCAG 1.4.1).
   */
  icon?: React.ReactNode | false;
}

/**
 * A bordered notice: the "I don't know" explanation of the decision tree
 * (§6.3), the compatibility warning of the build list and the empty-state hints
 * of §6.7.
 *
 * `role` is deliberately NOT set here. A callout that appears in response to
 * something the user just did must interrupt — `<Callout tone="warning"
 * role="alert">` — while one that is simply part of the page must not. The
 * consumer decides; anything passed through lands on the root element.
 *
 * Every string is a prop: this component owns no message namespace.
 */
export function Callout({
  tone = "info",
  title,
  icon,
  className,
  children,
  ...props
}: CalloutProps): React.JSX.Element {
  return (
    <div
      data-slot="callout"
      data-tone={tone}
      className={cn(calloutVariants({ tone }), className)}
      {...props}
    >
      {icon === false ? null : (
        <span data-slot="callout-icon" aria-hidden="true" className="mt-0.5 shrink-0">
          {icon ?? <ToneIcon tone={tone} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title === undefined ? null : (
          <p data-slot="callout-title" className="font-medium text-ink">
            {title}
          </p>
        )}
        <div data-slot="callout-body" className="[&_p]:leading-relaxed [&_p+p]:mt-2">
          {children}
        </div>
      </div>
    </div>
  );
}

function ToneIcon({ tone }: { tone: CalloutTone }): React.JSX.Element {
  const className = "size-4";
  if (tone === "warning") return <TriangleAlert className={className} />;
  if (tone === "danger") return <CircleAlert className={className} />;
  if (tone === "success") return <CircleCheck className={className} />;
  return <Info className={className} />;
}
