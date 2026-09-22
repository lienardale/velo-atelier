"use client";

import { useId, useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Disclosure } from "@/components/ui-ext/Disclosure";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BikeBuild } from "@/lib/domain/schema/part";
import type { Locale } from "@/lib/i18n/routing";
import {
  shopConstraintsFor,
  shopQuestionsFor,
  type BrandTier,
  type Refinement,
} from "@/lib/shop/questions";
import { cn } from "@/lib/utils";

/**
 * "Préciser la pièce" — the questions that turn "a new chain" into the chain
 * you can actually order (§6.5, §5.5).
 *
 * The questions come from the domain's buying guide against THIS bike
 * (`shopQuestionsFor`), which is what makes them worth answering: a cassette's
 * number of speeds is already decided by the chain, so it is shown as a
 * constraint rather than asked, and the freehub options are narrowed to the two
 * the hub can take. The questions the compatibility rules could not answer on
 * their own come first, tagged with why they are being asked.
 *
 * Each control writes the whole refinement back on `change` — a build list is
 * consulted in a bike shop, on a phone, and a submit button to find is a
 * refinement lost. The answers are plain strings (what the control produced);
 * `refinementAnswers` is what puts them back into the attributes' own types
 * before the query and the rules see them.
 *
 * ## "Comment mesurer"
 *
 * Every attribute that carries a `helpKey` gets a `<Disclosure>` with it: what
 * the measurement is and where to read it off the bike. It is collapsed by
 * default — most of the time the visitor already knows — and it is the same
 * text the part panel shows, resolved through `lib/domain/i18n.ts` rather than
 * next-intl so a catalogue that grows an attribute before the message file
 * catches up degrades to the key instead of throwing.
 *
 * ## The brand tier (§6.5)
 *
 * Entry / mid / high — what actually changes between a 20 € chain and an 80 €
 * one — is asked when the page handed this part's `brandTiers` down (the
 * brands come from `content/brands.yaml`, which only the server reads). A part
 * the file does not cover has no tier to ask about: choosing one would change
 * nothing in the search.
 *
 * ## The drawings in "Comment mesurer"
 *
 * Where an existing drawing shows how to read the attribute off the bike
 * (`lib/shop/measure-drawings.ts`), the page renders it on the server and hands
 * it down in `drawings`, keyed by attribute: a client module may not import the
 * illustration barrel (CLAUDE.md), and this form is one.
 */
export interface RefinementFormProps {
  build: BikeBuild;
  partId: string;
  refinement: Refinement;
  locale: Locale;
  /** Scopes the field ids, so two cards for the same part do not collide. */
  itemId: string;
  /** This part's brands per tier, from the server; `null` / absent: no tier question. */
  brandTiers?: Readonly<Record<BrandTier, readonly string[]>> | null;
  /** Server-rendered "Comment mesurer" drawings, keyed by attribute (`renderMeasureDrawings`). */
  drawings?: Readonly<Record<string, ReactNode>>;
  onChange: (refinement: Refinement) => void;
  className?: string;
}

export function RefinementForm({
  build,
  partId,
  refinement,
  locale,
  itemId,
  brandTiers = null,
  drawings = {},
  onChange,
  className,
}: RefinementFormProps): React.JSX.Element | null {
  const t = useTranslations("shop");
  const prefix = useId();

  const hasTiers = brandTiers !== null;
  const questions = useMemo(
    () =>
      hasTiers
        ? shopQuestionsFor(
            build,
            partId as never,
            locale,
            { entry: t("tiers.entry"), mid: t("tiers.mid"), high: t("tiers.high") },
            { label: t("brand.label"), help: t("brand.help") },
          )
        : shopQuestionsFor(build, partId as never, locale),
    [build, partId, locale, hasTiers, t],
  );
  const constraints = useMemo(
    () => shopConstraintsFor(build, partId as never, locale),
    [build, partId, locale],
  );

  if (questions.length === 0 && constraints.length === 0) return null;

  const set = (key: string, value: string): void => {
    const next: Record<string, string> = { ...refinement };
    /* eslint-disable security/detect-object-injection -- `key` is an attribute key of our own catalogue, and `next` is a fresh literal */
    if (value === "") delete next[key];
    else next[key] = value;
    /* eslint-enable security/detect-object-injection */
    onChange(next);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="refinement-form">
      {constraints.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <h3 className="text-ink text-sm font-semibold">{t("part.constraints")}</h3>
          <ul
            className="text-ink-muted list-disc pl-4 text-sm"
            data-testid="refinement-constraints"
          >
            {constraints.map((constraint) => (
              <li key={`${constraint.ruleId}-${constraint.attribute}`}>{constraint.label}</li>
            ))}
          </ul>
        </div>
      )}

      {questions.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          <h3 className="text-ink text-sm font-semibold">{t("list.item.refine")}</h3>
          <p className="text-ink-muted text-xs">{t("list.item.refineHelp")}</p>
          {questions.map((question) => {
            const fieldId = `${prefix}-${itemId}-${question.partId}-${question.key}`;
            const value = Object.hasOwn(refinement, question.key) ? refinement[question.key] : "";
            return (
              <div key={`${question.partId}.${question.key}`} className="flex flex-col gap-1">
                <Label htmlFor={fieldId}>{question.label}</Label>
                {question.options === null ? (
                  <Input
                    id={fieldId}
                    type={question.kind === "number" ? "number" : "text"}
                    inputMode={question.kind === "number" ? "decimal" : undefined}
                    min={question.min ?? undefined}
                    max={question.max ?? undefined}
                    value={value}
                    onChange={(event) => set(question.key, event.currentTarget.value)}
                    className="min-h-[var(--tap-min)] max-w-xs text-base md:text-base"
                    data-question={question.key}
                  />
                ) : (
                  <select
                    id={fieldId}
                    className="border-rule bg-paper text-ink min-h-[var(--tap-min)] max-w-xs rounded-md border px-2 text-base"
                    value={value}
                    onChange={(event) => set(question.key, event.currentTarget.value)}
                    data-question={question.key}
                  >
                    <option value="">{t("brand.any")}</option>
                    {question.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
                {question.askedBecause === null ? null : (
                  <p className="text-ink-muted text-xs" data-testid="refinement-asked-because">
                    {t("list.item.askedBecause")}
                  </p>
                )}
                {question.help === null ? null : (
                  <Disclosure
                    summary={t("list.item.howToMeasure")}
                    className="text-ink-muted text-xs"
                  >
                    <p>{question.help}</p>
                    {Object.hasOwn(drawings, question.key) ? drawings[question.key] : null}
                  </Disclosure>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
