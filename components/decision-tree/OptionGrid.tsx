"use client";

import { useTranslations } from "next-intl";

import { RadioGroup } from "@/components/ui/radio-group";
import { OptionCard } from "@/components/ui-ext/OptionCard";
import type { DecisionOption } from "@/lib/domain/schema/decision";
import { cn } from "@/lib/utils";

import type { TreeIllustrations } from "./tree-illustrations";

type Translate = (key: string) => string;

export interface OptionGridProps {
  /** The options on screen — `visibleOptions(node, answers)`. */
  options: readonly DecisionOption[];
  /** The checked option id, or `undefined` when nothing is picked yet. */
  value: string | undefined;
  onValueChange: (option: string) => void;
  /** Id of the question heading: the radiogroup's accessible name. */
  labelledBy: string;
  /** Id of an error message to announce with the group, when one is shown. */
  describedBy?: string;
  /** Server-rendered thumbnails (`renderTreeIllustrations`). */
  illustrations: TreeIllustrations;
}

/**
 * The answers of one question as a grid of picture cards (§6.3): a
 * `role="radiogroup"` of `role="radio"` cards with arrow-key navigation and a
 * roving tab stop (Radix, through `OptionCard`), two columns on phones and four
 * from `lg`.
 *
 * Choosing a card only selects it; the visitor moves on with "Continuer".
 * Arrow keys check the card they land on, so advancing on change would make
 * the grid impossible to browse by keyboard — and WCAG 3.2.2 forbids a change
 * of context on input anyway.
 *
 * A thumbnail is shown when the tree gives the option one (nodes with four or
 * more non-numeric options). It arrives already rendered by the server and
 * decorative: the card's label already names the option, and the drawing is
 * only there to recognise it.
 */
export function OptionGrid({
  options,
  value,
  onValueChange,
  labelledBy,
  describedBy,
  illustrations,
}: OptionGridProps): React.JSX.Element {
  const t = useTranslations() as unknown as Translate;
  const hasThumbnails = options.some((option) => option.illustrationId !== undefined);

  return (
    <RadioGroup
      value={value ?? ""}
      onValueChange={onValueChange}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      loop
      data-testid="option-grid"
      className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", !hasThumbnails && "sm:grid-cols-3")}
    >
      {options.map((option) => {
        const thumbnail =
          option.illustrationId === undefined ? undefined : illustrations[option.illustrationId];
        return (
          <OptionCard
            key={option.id}
            value={option.id}
            data-option-id={option.id}
            label={t(option.labelKey)}
            hint={option.descriptionKey === undefined ? undefined : t(option.descriptionKey)}
            illustration={thumbnail ?? undefined}
          />
        );
      })}
    </RadioGroup>
  );
}
