"use client";

import { useTranslations } from "next-intl";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { SymptomOption } from "@/lib/checkup/selectors";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * "Ça ne marche pas" — but what, exactly (§6.5)?
 *
 * The radios are the step's own `checkQuestion.ko[]`, grouped by reason. This
 * is the difference between a to-fix list with one line on it and a to-fix list
 * with four: picking "garniture trop fine" replaces the pads, picking "trace de
 * gras" cleans them, and the visitor is the only one who can tell which.
 *
 * Each option carries the guide that fixes it, so the answer to "and now what?"
 * is one click away rather than a search. A reason only a shop can settle
 * (`inspect-shop`) says so instead of linking nowhere.
 *
 * The note is free text and deliberately separate from the verdict: typing "2"
 * in it must not answer the question (§6.8 AC6), which is why the keyboard
 * shortcuts live on the verdict bar and stop at the first form field.
 */
export interface SymptomPickerProps {
  stepKey: string;
  options: readonly SymptomOption[];
  /** The reason currently ticked, or `null`. */
  value: string | null;
  onPick: (reasonKey: string) => void;
  note: string;
  onNoteChange: (note: string) => void;
  /** `guides.reasons.<reasonKey>`, resolved by the caller. */
  reasonLabel: (reasonKey: string) => string;
  /** Guide titles and stub flags, for the "voir le guide" links. */
  guideTitle: (slug: string) => string | null;
  isStub: (slug: string) => boolean;
  className?: string;
}

export function SymptomPicker({
  stepKey,
  options,
  value,
  onPick,
  note,
  onNoteChange,
  reasonLabel,
  guideTitle,
  isStub,
  className,
}: SymptomPickerProps): React.JSX.Element {
  const t = useTranslations("checkup");
  const noteId = `checkup-note-${stepKey.replace(/[^a-z0-9-]/gi, "-")}`;

  return (
    <div
      data-testid="symptom-picker"
      className={cn("flex flex-col gap-4 rounded-lg border border-rule bg-paper-2 p-4", className)}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium text-ink">{t("symptom.legend")}</legend>
        <RadioGroup
          value={value ?? ""}
          onValueChange={onPick}
          className="flex flex-col gap-2"
          aria-label={t("symptom.legend")}
        >
          {options.map((option) => (
            <div key={option.reasonKey} className="flex items-start gap-3">
              <RadioGroupItem
                id={`${noteId}-${option.reasonKey}`}
                value={option.reasonKey}
                data-testid={`symptom-${option.reasonKey}`}
                className="tap-target mt-0.5 shrink-0"
              />
              {/* The guide links sit OUTSIDE the label: a link inside one is
                  also a click on the radio, and following it would tick a
                  symptom the visitor never chose. */}
              <div className="flex min-w-0 flex-col">
                <label
                  htmlFor={`${noteId}-${option.reasonKey}`}
                  className="flex min-h-[var(--tap-min)] cursor-pointer items-center text-ink"
                >
                  {reasonLabel(option.reasonKey)}
                </label>
                <SymptomTargets option={option} guideTitle={guideTitle} isStub={isStub} />
              </div>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={noteId} className="text-sm font-medium text-ink">
          {t("symptom.note")}
        </label>
        <textarea
          id={noteId}
          data-testid="symptom-note"
          value={note}
          onChange={(event) => onNoteChange(event.currentTarget.value)}
          placeholder={t("symptom.notePlaceholder")}
          rows={2}
          maxLength={2000}
          // 16 px or Safari zooms the page on focus (§6.8 AC5).
          className="w-full rounded-md border border-rule bg-paper p-2 text-base text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>
    </div>
  );
}

function SymptomTargets({
  option,
  guideTitle,
  isStub,
}: {
  option: SymptomOption;
  guideTitle: (slug: string) => string | null;
  isStub: (slug: string) => boolean;
}): React.JSX.Element {
  const t = useTranslations("checkup");
  const links = option.guideSlugs.flatMap((slug) => {
    const title = guideTitle(slug);
    return title === null ? [] : [{ slug, title }];
  });

  if (links.length === 0) {
    return <span className="text-sm text-ink-muted">{t("symptom.inspectShop")}</span>;
  }

  return (
    <span className="flex flex-wrap items-center gap-x-3 text-sm">
      {links.map((link) => (
        <Link
          key={link.slug}
          href={{ pathname: "/guides/[slug]", params: { slug: link.slug } }}
          prefetch={false}
          className="text-accent underline"
          data-testid={`symptom-guide-${link.slug}`}
        >
          {link.title}
          {isStub(link.slug) ? (
            <span className="ml-1 text-ink-muted">({t("stubBadge")})</span>
          ) : null}
        </Link>
      ))}
    </span>
  );
}
