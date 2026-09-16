"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

export interface OptionCardProps extends Omit<
  React.ComponentProps<typeof RadioGroupPrimitive.Item>,
  "children"
> {
  /** The option's name — the card's accessible name. */
  label: React.ReactNode;
  /** One line of clarification under the label. Optional. */
  hint?: React.ReactNode;
  /**
   * The picture that lets someone recognise the option on their own bike
   * (§6.3). Pass an illustration component; it is rendered as given, so a
   * decorative one should carry `aria-hidden` and an informative one a
   * `role="img"` with a `<title>`.
   */
  illustration?: React.ReactNode;
}

/**
 * One answer in the decision tree: a big, picture-first radio button (§6.3).
 *
 * Built on Radix's `RadioGroup.Item`, so it MUST be rendered inside a
 * `<RadioGroup>` (`@/components/ui/radio-group`): the group is what gives the
 * set its `role="radiogroup"`, its arrow-key navigation and its roving
 * tabindex, which is exactly the behaviour §6.3 asks for and exactly the
 * behaviour that is tedious and easy to get wrong by hand.
 *
 * `role="radio"` ends up on the card itself — a real 44 px+ target, not a
 * hidden input next to a label — which is what the mobile audit measures
 * (§6.8 AC5).
 *
 * Presentational: every string arrives as a prop, so it owns no message
 * namespace and no domain type.
 */
export function OptionCard({
  label,
  hint,
  illustration,
  className,
  ...props
}: OptionCardProps): React.JSX.Element {
  return (
    <RadioGroupPrimitive.Item
      data-slot="option-card"
      className={cn(
        "tap-target h-full w-full rounded-lg border border-rule bg-paper p-3 text-ink transition-colors",
        "hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent/10",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="flex w-full flex-col items-center gap-2 text-center">
        {illustration === undefined ? null : (
          <span data-slot="option-card-illustration" className="block w-full">
            {illustration}
          </span>
        )}
        <span data-slot="option-card-label" className="text-sm font-medium">
          {label}
        </span>
        {hint === undefined ? null : (
          <span data-slot="option-card-hint" className="text-xs text-ink-muted">
            {hint}
          </span>
        )}
      </span>
    </RadioGroupPrimitive.Item>
  );
}
