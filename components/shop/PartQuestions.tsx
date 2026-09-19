"use client";

/* eslint-disable security/detect-object-injection -- every index below is an attribute key of our own catalogue, a BrandTier literal, or guarded by Object.hasOwn */

import { useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { VendorButtons } from "@/components/build-list/VendorButtons";
import { Callout } from "@/components/ui-ext/Callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bikeRefParam, parseBikeRef } from "@/lib/bike/resolve-bike-ref";
import { isPartId, type PartId } from "@/lib/domain/data/parts";
import { attributeLabel, domainMessage, partLabel, valueLabel } from "@/lib/domain/i18n";
import type { AttributeValue } from "@/lib/domain/schema/part";
import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";
import { buildQuery } from "@/lib/shop/query";
import {
  BRAND_TIERS,
  BRAND_TIER_KEY,
  isBrandTier,
  partQuestions,
  type BrandTier,
  type PartQuestion,
} from "@/lib/shop/questions";
import { cn } from "@/lib/utils";

/**
 * The buying guide of `/acheter?part=<id>` (§5.5).
 *
 * What the page shows when a visitor arrives from a build-list item, or clicks
 * a category title: the questions that decide WHICH one to buy, the brands each
 * price range stands for, and the three shops with the answers already in the
 * search.
 *
 * ## Why it reads the URL instead of the page
 *
 * `/acheter` is a **static** route. Its category grid and its brand tables come
 * from `content/**` YAML, read at build time (`lib/shop/retailers.ts` says why
 * that read cannot happen per request), so the page is prerendered once and the
 * part-specific panel is chosen in the browser. That is the whole reason this
 * component is a client one and sits inside the page's `<Suspense>` boundary —
 * a `useSearchParams` consumer without one makes the route dynamic and the
 * prerender is lost.
 *
 * ## Why the questions are the bike-free ones
 *
 * `PART_QUESTIONS`, not `buildBuyingGuide`: this page may be reached with no
 * bike at all, and the two bikes that live in the browser cannot be read on the
 * server. So the questions here are the part's own — every attribute its owner
 * may change — with nothing narrowed by compatibility. When `?bike=` names one,
 * the panel says so and links to the build list, where the same questions ARE
 * narrowed by the actual build (`<RefinementForm>`).
 *
 * ## Labels come from the domain, not from `useTranslations`
 *
 * Part, attribute and value names are DATA — the same strings the search query
 * is assembled from — and `lib/domain/i18n.ts` resolves them with an explicit
 * locale and a documented fallback for a key the catalogue has not got. Reading
 * them through next-intl instead would mean this route declaring the whole
 * `parts` namespace and rendering a raw key whenever the catalogue grows a
 * value the message file has not caught up with.
 *
 * `?part=`, `?bike=` and `?item=` all arrive from a URL and are all untrusted:
 * an unknown part renders nothing, an unparseable bike ref simply drops the
 * back-link.
 */
export interface PartQuestionsProps {
  locale: Locale;
  /**
   * Brand tiers per part, already in this locale — from `content/brands.yaml`,
   * read on the server and serialised into the prerendered page.
   */
  brandsByPart: Readonly<Record<string, { note: string; tiers: Record<BrandTier, string[]> }>>;
  className?: string;
}

/** The catalogue's own spelling of a value a control returned. */
export function typedValue(question: PartQuestion, raw: string): AttributeValue | undefined {
  if (raw === "") return undefined;
  if (question.values !== null) return question.values.find((value) => String(value) === raw);
  if (question.kind === "boolean") {
    return raw === "true" ? true : raw === "false" ? false : undefined;
  }
  if (question.kind === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return raw;
}

export function PartQuestions({
  locale,
  brandsByPart,
  className,
}: PartQuestionsProps): React.JSX.Element | null {
  const t = useTranslations("shop");
  const fieldPrefix = useId();
  const params = useSearchParams();
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const raw = params.get("part");
  const partId: PartId | null = raw !== null && raw.length <= 64 && isPartId(raw) ? raw : null;
  const bikeRef = parseBikeRef(params.get("bike"));

  if (partId === null) return null;

  const questions = partQuestions(partId);
  const brands = Object.hasOwn(brandsByPart, partId) ? brandsByPart[partId] : null;

  const chosenTier = answers[BRAND_TIER_KEY];
  const tier = isBrandTier(chosenTier) ? chosenTier : null;
  const brand = tier === null || brands === null ? undefined : brands.tiers[tier][0];

  const typed: Record<string, AttributeValue> = {};
  for (const question of questions) {
    if (question.key === BRAND_TIER_KEY) continue;
    const answer = answers[question.key];
    const value = answer === undefined ? undefined : typedValue(question, answer);
    if (value !== undefined) typed[question.key] = value;
  }
  const query = buildQuery(partId, typed, locale, { brand });

  return (
    <section
      className={cn("flex flex-col gap-4", className)}
      aria-labelledby="part-questions-title"
      data-testid="part-questions"
      data-part-id={partId}
    >
      <header className="flex flex-col gap-1">
        <h2 id="part-questions-title" className="font-display text-ink text-xl font-semibold">
          {t("part.title", { part: partLabel(locale, partId) })}
        </h2>
        <p className="text-ink-muted text-sm">{t("part.intro")}</p>
      </header>

      {bikeRef === null ? null : (
        <Callout tone="info">
          <p>{t("part.needsBike")}</p>
          <p className="mt-2">
            <Link
              href={{ pathname: "/velo/[id]/liste", params: { id: bikeRefParam(bikeRef) } }}
              className="text-accent flex min-h-[var(--tap-min)] items-center underline"
              data-testid="part-questions-back"
            >
              {t("part.backToList")}
            </Link>
          </p>
        </Callout>
      )}

      <div className="flex flex-col gap-3">
        <h3 className="text-ink text-sm font-semibold">{t("part.questions")}</h3>
        {questions.map((question) => {
          const fieldId = `${fieldPrefix}-${question.key}`;
          const isTier = question.key === BRAND_TIER_KEY;
          return (
            <div key={question.key} className="flex max-w-md flex-col gap-1">
              <Label htmlFor={fieldId}>
                {isTier ? t("brand.label") : attributeLabel(locale, question.key)}
              </Label>
              <QuestionControl
                id={fieldId}
                question={question}
                value={answers[question.key] ?? ""}
                anyLabel={t("brand.any")}
                optionLabel={(value) =>
                  isTier
                    ? t(`tiers.${value as BrandTier}`)
                    : valueLabel(locale, question.key, value, question.unit ?? undefined)
                }
                onChange={(next) => setAnswers((current) => ({ ...current, [question.key]: next }))}
              />
              <p className="text-ink-muted text-xs">
                {isTier
                  ? t("brand.help")
                  : question.helpKey === null
                    ? ""
                    : domainMessage(locale, question.helpKey)}
              </p>
            </div>
          );
        })}
      </div>

      {brands === null ? null : (
        <div className="flex flex-col gap-2" data-testid="brand-tiers">
          <h3 className="text-ink text-sm font-semibold">{t("brand.title")}</h3>
          <p className="text-ink-muted text-sm">{brands.note}</p>
          <dl className="grid gap-2 sm:grid-cols-3">
            {BRAND_TIERS.map((entry) => (
              <div key={entry} className="border-rule rounded-md border p-3" data-tier={entry}>
                <dt className="text-ink text-sm font-medium">{t(`tiers.${entry}`)}</dt>
                <dd className="text-ink-muted text-sm">{brands.tiers[entry].join(", ")}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-ink text-sm font-semibold">{t("part.vendors")}</h3>
        <p className="text-ink-muted text-sm" data-testid="part-query">
          {t("part.query", { query })}
        </p>
        <VendorButtons partId={partId} query={query} locale={locale} testId="part-vendor-buttons" />
      </div>
    </section>
  );
}

function QuestionControl({
  id,
  question,
  value,
  anyLabel,
  optionLabel,
  onChange,
}: {
  id: string;
  question: PartQuestion;
  value: string;
  anyLabel: string;
  optionLabel: (value: string) => string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const selectClass =
    "border-rule bg-paper text-ink min-h-[var(--tap-min)] rounded-md border px-2 text-base";
  const choices =
    question.values !== null
      ? question.values.map(String)
      : question.kind === "boolean"
        ? ["true", "false"]
        : null;

  if (choices !== null) {
    return (
      <select
        id={id}
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        data-question={question.key}
      >
        <option value="">{anyLabel}</option>
        {choices.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <Input
      id={id}
      type={question.kind === "number" ? "number" : "text"}
      inputMode={question.kind === "number" ? "decimal" : undefined}
      min={question.min ?? undefined}
      max={question.max ?? undefined}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="min-h-[var(--tap-min)] text-base md:text-base"
      data-question={question.key}
    />
  );
}
