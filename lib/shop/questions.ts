/**
 * "I need a new <part> — what exactly do I buy?" (§5.5).
 *
 * Two shapes, because there are two places that ask:
 *
 *   PART_QUESTIONS      a static table, one entry per part the shop sells:
 *                       the attributes a buyer has to settle, as message KEYS.
 *                       It knows nothing about a particular bike, which is what
 *                       makes it usable on `/acheter` where there may not be
 *                       one, and serialisable into a client component.
 *   shopQuestionsFor()  the same questions for a REAL build, through the
 *                       domain's `buildBuyingGuide`: the options are narrowed
 *                       to what the rest of the bike allows, the other side's
 *                       missing measurements are asked first (`askedBecause`),
 *                       and everything is already in the visitor's language.
 *
 * On top of the part's own attributes there is one synthetic question, the
 * **brand tier** (`entry | mid | high`): what actually changes between a 20 €
 * chain and an 80 € one. Its three values live here because they are a closed
 * vocabulary; the brands each tier stands for are CONTENT
 * (`content/brands.yaml`) and are read by `lib/shop/retailers.ts`, server-side,
 * then handed to `/acheter`. They deliberately do not travel with this module:
 * it is imported by `<RefinementForm>`, and 10 kB of brand names has no
 * business in the build list's bundle.
 *
 * ## Refinements are strings; attributes are not
 *
 * A refinement is what a `<select>` produced, what `localStorage` gave back, or
 * what a `Json` column held — always strings. The domain's attributes are
 * typed (`speeds: 11`, `e-rated: false`), and the rules, the query and
 * `validateBuild` all read them as such. {@link refinementAnswers} is the one
 * place that conversion happens, and everything downstream (`buildQuery`,
 * `refinementIssues`) takes its output rather than the raw map — a value the
 * attribute does not accept is DROPPED there rather than travelling on as a
 * string that happens to stringify the same way.
 *
 * Client-safe: no zod, no `node:fs`.
 */
import { PARTS, partDefinition, type CatalogPart, type PartId } from "@/lib/domain/data/parts";
import type { RuleId } from "@/lib/domain/data/rules";
import { checkCompatibility, type CompatibilityIssue } from "@/lib/domain/engine/compatibility";
import { buildBuyingGuide, type BuyingGuide } from "@/lib/domain/engine/buying-guide";
import { defaultAttributes, findPart } from "@/lib/domain/engine/parts-for-spec";
import type {
  AttributeDef,
  AttributeKind,
  AttributeValue,
  BikeBuild,
  BikePart,
} from "@/lib/domain/schema/part";
import type { Locale } from "@/lib/i18n/routing";

import type { QueryAnswers } from "./query";

/** What separates a cheap one from an expensive one. Ordered cheapest first. */
export const BRAND_TIERS = ["entry", "mid", "high"] as const;

export type BrandTier = (typeof BRAND_TIERS)[number];

/**
 * The key the brand tier is stored under in a refinement. It is not an
 * attribute of any part — no `-` collision with a real attribute key is
 * possible because attribute keys are declared in the catalogue and this one
 * never is (`questions.test.ts` asserts it).
 */
export const BRAND_TIER_KEY = "brand-tier";

export function isBrandTier(value: unknown): value is BrandTier {
  return typeof value === "string" && (BRAND_TIERS as readonly string[]).includes(value);
}

// ── The static table ─────────────────────────────────────────────────────────

/** One question, as data: message keys, not prose (§1.2). */
export interface PartQuestion {
  /** An attribute key of the part, or {@link BRAND_TIER_KEY}. */
  key: string;
  kind: AttributeKind;
  /** `parts.attr.<key>.label`, or `shop.brand.label` for the tier. */
  labelKey: string;
  /** `parts.attr.<key>.help`, when the attribute declares one. */
  helpKey: string | null;
  /** `parts.units.<unit>`, for the numbers that carry one. */
  unit: string | null;
  /** The enum values, cheapest-first for the tier; `null` for numbers and text. */
  values: readonly AttributeValue[] | null;
  min: number | null;
  max: number | null;
}

const BRAND_QUESTION: PartQuestion = {
  key: BRAND_TIER_KEY,
  kind: "enum",
  labelKey: "shop.brand.label",
  helpKey: "shop.brand.help",
  unit: null,
  values: BRAND_TIERS,
  min: null,
  max: null,
};

function questionOf(attribute: AttributeDef): PartQuestion {
  return {
    key: attribute.key,
    kind: attribute.kind,
    labelKey: attribute.labelKey,
    helpKey: attribute.helpKey ?? null,
    unit: attribute.unit ?? null,
    values: attribute.values ?? null,
    min: attribute.min ?? null,
    max: attribute.max ?? null,
  };
}

/**
 * The buyer's questions for one part: every attribute its owner may change,
 * then the brand tier.
 *
 * `editable` is the filter, and it is the right one: a non-editable attribute
 * is decided by the bike (a frame's brake mount), so it is a CONSTRAINT to
 * show, never a question to ask — `buildBuyingGuide` reports those separately.
 */
function questionsFor(definition: CatalogPart): readonly PartQuestion[] {
  return [
    ...definition.attributes.filter((attribute) => attribute.editable).map(questionOf),
    BRAND_QUESTION,
  ];
}

/**
 * Every part, with the questions a buyer must answer for it.
 *
 * Built once from the catalogue rather than written out: a part that gains an
 * editable attribute gains the question, and `questions.test.ts` holds the two
 * to each other.
 */
export const PART_QUESTIONS: Partial<Record<PartId, readonly PartQuestion[]>> = Object.freeze(
  Object.fromEntries(PARTS.map((definition) => [definition.id, questionsFor(definition)])),
) as Partial<Record<PartId, readonly PartQuestion[]>>;

/** The questions for `partId`, or `[]` for an id the catalogue does not know. */
export function partQuestions(partId: string): readonly PartQuestion[] {
  return Object.hasOwn(PART_QUESTIONS, partId)
    ? (PART_QUESTIONS[partId as PartId] as readonly PartQuestion[])
    : [];
}

// ── The live version ─────────────────────────────────────────────────────────

/** One question, resolved against a bike and a language. */
export interface ShopQuestion {
  /** An attribute key, or {@link BRAND_TIER_KEY}. */
  key: string;
  /** The part it is about — an `askedBecause` question names ANOTHER part. */
  partId: string;
  kind: AttributeKind;
  label: string;
  help: string | null;
  unit: string | null;
  /** The choices still possible; `null` for numbers, booleans and text. */
  options: readonly { value: string; label: string }[] | null;
  min: number | null;
  max: number | null;
  /** The rule that needs this answer, for "on vous le demande parce que…". */
  askedBecause: RuleId | null;
}

/**
 * The buying guide for one part of one bike, plus the brand tier.
 *
 * Straight from `buildBuyingGuide`, which already narrows every option to what
 * the rest of the bike allows and drops an attribute the constraints pin to a
 * single value. `tierLabels` comes from the caller because the three tier names
 * are UI strings (`shop.tiers.*`) and this module translates nothing itself.
 */
export function shopQuestionsFor(
  build: BikeBuild,
  partId: PartId,
  locale: Locale,
  tierLabels?: Readonly<Record<BrandTier, string>>,
  brandLabel?: { label: string; help: string | null },
): ShopQuestion[] {
  const guide = buildBuyingGuide(build, partId, locale);
  const questions: ShopQuestion[] = guide.questions.map((question) => ({
    key: question.attribute,
    partId: question.partId,
    kind: question.kind,
    label: question.label,
    help: question.help,
    unit: question.unit,
    options:
      question.options === null
        ? null
        : question.options.map((option) => ({
            value: String(option.value),
            label: option.label,
          })),
    min: question.min,
    max: question.max,
    askedBecause: question.askedBecause,
  }));

  if (tierLabels !== undefined) {
    questions.push({
      key: BRAND_TIER_KEY,
      partId,
      kind: "enum",
      label: brandLabel?.label ?? BRAND_QUESTION.labelKey,
      help: brandLabel?.help ?? null,
      unit: null,
      options: BRAND_TIERS.map((tier) => ({ value: tier, label: tierLabels[tier] })),
      min: null,
      max: null,
      askedBecause: null,
    });
  }
  return questions;
}

/** The constraints the rest of the bike already puts on this part (§2.5). */
export function shopConstraintsFor(
  build: BikeBuild,
  partId: PartId,
  locale: Locale,
): BuyingGuide["constraints"] {
  return buildBuyingGuide(build, partId, locale).constraints;
}

// ── Refinements ──────────────────────────────────────────────────────────────

/** What a visitor answered, exactly as a form or a JSON column gives it back. */
export type Refinement = Readonly<Record<string, string>>;

/**
 * Put one stored string back into the type its attribute declares.
 *
 * An enum keeps the catalogue's own spelling (`11`, not `"11"`), which is what
 * makes `parts.units.speeds` fire in the query and what the rules compare on.
 * A number is parsed and must be finite; anything that does not match is
 * dropped rather than guessed at — a refinement is user input.
 */
export function coerceAttributeValue(
  attribute: AttributeDef,
  raw: string,
): AttributeValue | undefined {
  const values = attribute.values;
  if (values !== undefined) return values.find((value) => String(value) === raw);
  if (attribute.kind === "boolean") {
    return raw === "true" ? true : raw === "false" ? false : undefined;
  }
  if (attribute.kind === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return raw;
}

/**
 * The part as it would be bought: the bike's current attributes (or the
 * defaults, for a part it does not carry), with the visitor's refinement
 * applied on top.
 *
 * Unknown keys — including {@link BRAND_TIER_KEY}, which is not an attribute —
 * are skipped, so a refinement saved before a taxonomy change degrades to the
 * attributes that still exist instead of poisoning the query.
 */
export function refinementAnswers(
  build: BikeBuild,
  partId: PartId,
  refinement: Refinement = {},
): QueryAnswers {
  const definition = partDefinition(partId);
  if (definition === undefined) return {};
  const base = findPart(build, partId)?.attributes ?? defaultAttributes(definition, build.spec);
  const answers: Record<string, AttributeValue> = { ...base };
  for (const attribute of definition.attributes) {
    if (!Object.hasOwn(refinement, attribute.key)) continue;

    const value = coerceAttributeValue(attribute, refinement[attribute.key]);
    if (value !== undefined) answers[attribute.key] = value;
  }
  return answers;
}

/** The part with the refinement applied, ready for `checkCompatibility`. */
export function refinedPart(
  build: BikeBuild,
  partId: PartId,
  refinement: Refinement = {},
): BikePart {
  return { partId, attributes: { ...refinementAnswers(build, partId, refinement) } };
}

/**
 * What the rest of the bike says about this refinement — the `<Callout
 * tone="warning" role="alert">` of §6.5.
 *
 * Only the rules that touch this part are evaluated (`checkCompatibility`), so
 * a bike that is already odd somewhere else does not shout at someone buying a
 * chain. Errors first: a hard incompatibility outranks a warning.
 */
export function refinementIssues(
  build: BikeBuild,
  partId: PartId,
  refinement: Refinement = {},
): CompatibilityIssue[] {
  const report = checkCompatibility(build, refinedPart(build, partId, refinement));
  return [...report.issues].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1,
  );
}

/** The brand the query should carry: the tier's first brand, when one was picked. */
export function brandFromRefinement(
  refinement: Refinement,
  brandsByTier: Readonly<Partial<Record<BrandTier, readonly string[]>>> | null,
): string | undefined {
  const tier = Object.hasOwn(refinement, BRAND_TIER_KEY)
    ? // eslint-disable-next-line security/detect-object-injection -- a literal key
      refinement[BRAND_TIER_KEY]
    : undefined;
  if (!isBrandTier(tier) || brandsByTier === null) return undefined;
  // eslint-disable-next-line security/detect-object-injection -- `tier` is a BrandTier, a key of the table
  const brands = brandsByTier[tier];
  return brands === undefined || brands.length === 0 ? undefined : brands[0];
}
