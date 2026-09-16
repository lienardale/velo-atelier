/**
 * The buying guide (§2.5): "I need a new <part> — what exactly do I buy?".
 *
 * `buildBuyingGuide(build, partId, locale)` answers with
 *
 *   - `constraints` — what the rest of the bike already decides, read from
 *     every compatibility rule whose **other** side is known ("corps de roue
 *     libre : Shimano HG", "diamètre : 160 mm au plus");
 *   - `questions` — what is still open: first the other-side measurements the
 *     rules could not read (tagged `askedBecause`), then the part's own editable
 *     attributes that the constraints do not already pin to one value;
 *   - `candidateTemplate` — the part as it would be bought: its current (or
 *     default) attributes, moved inside the constraints — it passes
 *     `checkCompatibility` whenever the constraints can be met;
 *   - `searchQueries` — one query per retailer:
 *     `[partLabel, speeds, range, freehub, …].filter(Boolean).join(' ')`, with a
 *     brand appended only when the owner picked one (§2.5).
 *
 * Zod-free: reachable from the barrel.
 */
import { partDefinition, type PartId } from "../data/parts";
import { RETAILER_ORDER } from "../data/retailers";
import { RULES, type RuleId } from "../data/rules";
import { attributeLabel, domainMessage, partLabel, valueLabel, type DomainLocale } from "../i18n";
import type { RetailerId } from "../schema/retailer";
import type {
  AttributeDef,
  AttributeKind,
  AttributeValue,
  BikeBuild,
  BikePart,
} from "../schema/part";
import type { CompatibilityRule, RuleSeverity } from "../schema/rule";

import { missingAttributes, refsOf } from "./compatibility";
import { evalSpecCondition } from "./condition";
import { defaultAttributes, findPart, isAttributePresent } from "./parts-for-spec";

/** What one rule, with its other side known, requires of the part being bought. */
export interface BuyingConstraint {
  ruleId: RuleId;
  severity: RuleSeverity;
  /** The attribute of the part being bought. */
  attribute: string;
  /** The values it may take, or `null` when the rule bounds a number instead. */
  allowed: AttributeValue[] | null;
  min: number | null;
  max: number | null;
  /** The other side's value that decided it; `null` for a `flag` rule. */
  because: { partId: string; attribute: string; value: AttributeValue } | null;
  /** The constraint as a sentence in `locale`. */
  label: string;
}

export interface BuyingOption {
  value: AttributeValue;
  label: string;
}

/** Something the owner still has to answer (or measure) before buying. */
export interface BuyingQuestion {
  partId: string;
  attribute: string;
  kind: AttributeKind;
  label: string;
  help: string | null;
  unit: string | null;
  /** Enum choices still possible, `null` for booleans, numbers and text. */
  options: BuyingOption[] | null;
  min: number | null;
  max: number | null;
  /** The rule that needs this answer; `null` for the part's own attributes. */
  askedBecause: RuleId | null;
}

export interface BuyingGuide {
  partId: PartId;
  label: string;
  constraints: BuyingConstraint[];
  questions: BuyingQuestion[];
  candidateTemplate: BikePart;
  searchQueries: Record<RetailerId, string>;
}

export interface BuyingGuideOptions {
  /** A brand or tier the owner picked; appended to every query. */
  brand?: string;
}

// ── Constraints ──────────────────────────────────────────────────────────────

const same = (left: AttributeValue, right: AttributeValue) => String(left) === String(right);

/** Keep the attribute's own spelling of each value (`11`, not `"11"`). */
function asValues(attribute: AttributeDef, raw: readonly (string | number)[]): AttributeValue[] {
  const values = attribute.values;
  if (values === undefined) return [...raw];
  return values.filter((value) => raw.some((entry) => same(entry, value)));
}

function ownValue(part: BikePart | undefined, key: string): AttributeValue | undefined {
  if (part === undefined || !Object.hasOwn(part.attributes, key)) return undefined;
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn above
  return part.attributes[key];
}

function tableEntry<T>(table: Record<string, T>, key: AttributeValue): T | undefined {
  return Object.hasOwn(table, String(key)) ? table[String(key)] : undefined;
}

type Bounds = Pick<BuyingConstraint, "allowed" | "min" | "max">;

function constraintLabel(locale: DomainLocale, attribute: AttributeDef, bounds: Bounds): string {
  const name = attributeLabel(locale, attribute.key);
  const format = (value: AttributeValue) =>
    valueLabel(locale, attribute.key, value, attribute.unit);
  if (bounds.allowed !== null) {
    return domainMessage(locale, "parts.constraints.oneOf", {
      attribute: name,
      values: bounds.allowed.map(format).join(" / "),
    });
  }
  if (bounds.min !== null && bounds.max !== null) {
    return domainMessage(locale, "parts.constraints.between", {
      attribute: name,
      min: format(bounds.min),
      max: format(bounds.max),
    });
  }
  return bounds.max !== null
    ? domainMessage(locale, "parts.constraints.atMost", {
        attribute: name,
        value: format(bounds.max),
      })
    : domainMessage(locale, "parts.constraints.atLeast", {
        attribute: name,
        value: format(bounds.min as number),
      });
}

/** The bounds one rule puts on `partId`, or `null` when it says nothing about it. */
export function ruleBounds(
  rule: CompatibilityRule,
  build: BikeBuild,
  partId: string,
): { key: string; bounds: Bounds; because: BuyingConstraint["because"] } | null {
  if (rule.when !== undefined && !evalSpecCondition(rule.when, build.spec)) return null;
  const check = rule.check;
  const refs = refsOf(check);
  const mine = refs.filter((ref) => ref.partId === partId);
  // Not about this part, or about this part on both sides: nothing to learn from the bike.
  if (mine.length !== 1) return null;
  const attribute = partDefinition(partId)!.attributes.find((entry) => entry.key === mine[0].key)!;

  if (check.kind === "flag") {
    return {
      key: mine[0].key,
      bounds: { allowed: [check.mustBe], min: null, max: null },
      because: null,
    };
  }

  const candidateIsA = refs[0].partId === partId;
  const otherRef = candidateIsA ? refs[1] : refs[0];
  const other = ownValue(findPart(build, otherRef.partId), otherRef.key);
  if (other === undefined) return null;
  const because = { partId: otherRef.partId, attribute: otherRef.key, value: other };
  const key = mine[0].key;
  const none = { allowed: null, min: null, max: null };

  switch (check.kind) {
    case "equal":
      return {
        key,
        bounds: { ...none, allowed: asValues(attribute, [other as string | number]) },
        because,
      };
    case "allowed": {
      const raw = candidateIsA
        ? Object.keys(check.table).filter((entry) =>
            tableEntry(check.table, entry)!.some((v) => same(v, other)),
          )
        : tableEntry(check.table, other);
      return raw === undefined
        ? null
        : { key, bounds: { ...none, allowed: asValues(attribute, raw) }, because };
    }
    case "lte": {
      const margin = check.margin ?? 0;
      const bounds = candidateIsA
        ? { ...none, max: Number(other) + margin }
        : { ...none, min: Number(other) - margin };
      return { key, bounds, because };
    }
    case "range": {
      if (candidateIsA) {
        const raw = Object.keys(check.table).filter((entry) => {
          const [min, max] = tableEntry(check.table, entry)!;
          return Number(other) >= min && Number(other) <= max;
        });
        return { key, bounds: { ...none, allowed: asValues(attribute, raw) }, because };
      }
      const range = tableEntry(check.table, other);
      return range === undefined
        ? null
        : { key, bounds: { ...none, min: range[0], max: range[1] }, because };
    }
  }
}

/** Every constraint the rest of `build` puts on `partId`. */
export function constraintsFor(
  build: BikeBuild,
  partId: PartId,
  locale: DomainLocale,
): BuyingConstraint[] {
  const definition = partDefinition(partId)!;
  const constraints: BuyingConstraint[] = [];
  for (const rule of RULES) {
    const found = ruleBounds(rule, build, partId);
    if (found === null) continue;
    const attribute = definition.attributes.find((entry) => entry.key === found.key)!;
    constraints.push({
      ruleId: rule.id,
      severity: rule.severity,
      attribute: found.key,
      ...found.bounds,
      because: found.because,
      label: constraintLabel(locale, attribute, found.bounds),
    });
  }
  return constraints;
}

/** All constraints on one attribute, intersected. */
export function mergeBounds(constraints: readonly BuyingConstraint[]): Bounds {
  let allowed: AttributeValue[] | null = null;
  let min: number | null = null;
  let max: number | null = null;
  for (const constraint of constraints) {
    if (constraint.allowed !== null) {
      const next = constraint.allowed;
      allowed =
        allowed === null
          ? [...next]
          : allowed.filter((value) => next.some((entry) => same(entry, value)));
    }
    if (constraint.min !== null)
      min = min === null ? constraint.min : Math.max(min, constraint.min);
    if (constraint.max !== null)
      max = max === null ? constraint.max : Math.min(max, constraint.max);
  }
  return { allowed, min, max };
}

/** Does `value` meet the merged bounds? */
export function satisfies(bounds: Bounds, value: AttributeValue): boolean {
  if (bounds.allowed !== null && !bounds.allowed.some((entry) => same(entry, value))) return false;
  if (bounds.min !== null && Number(value) < bounds.min) return false;
  return bounds.max === null || Number(value) <= bounds.max;
}

/**
 * The value to buy: the current one when it already fits; otherwise the
 * largest fitting value under a ceiling, the smallest one otherwise; a number
 * is clamped into its range.
 */
export function pickValue(
  attribute: AttributeDef,
  current: AttributeValue | undefined,
  bounds: Bounds,
): AttributeValue | undefined {
  if (current !== undefined && satisfies(bounds, current)) return current;
  const pool = attribute.values ?? bounds.allowed ?? [];
  const fitting = pool.filter((value) => satisfies(bounds, value));
  if (fitting.length > 0) {
    return bounds.max !== null && bounds.min === null ? fitting[fitting.length - 1] : fitting[0];
  }
  if (typeof current !== "number") return current;
  return Math.min(Math.max(current, bounds.min ?? -Infinity), bounds.max ?? Infinity);
}

// ── Search ───────────────────────────────────────────────────────────────────

/** Attributes that belong in a shop search, in the order they are typed. */
const SEARCH_ATTRIBUTES: Partial<Record<PartId, readonly string[]>> = {
  chain: ["speeds"],
  cassette: ["speeds", "range", "freehub"],
  freewheel: ["speeds"],
  "rear-derailleur": ["speeds"],
  "shifter-right": ["speeds"],
  "internal-gear-hub": ["speeds"],
  chainring: ["teeth"],
  crankset: ["spindle"],
  "bottom-bracket": ["bb-shell", "spindle"],
  "tire-front": ["etrto-width", "etrto-diameter"],
  "tire-rear": ["etrto-width", "etrto-diameter"],
  "tube-front": ["etrto-diameter", "valve"],
  "tube-rear": ["etrto-diameter", "valve"],
  "rotor-front": ["diameter", "interface"],
  "rotor-rear": ["diameter", "interface"],
  "brake-caliper-front": ["mount"],
  "brake-caliper-rear": ["mount"],
  handlebar: ["bar-clamp"],
  stem: ["stem-length", "bar-clamp"],
  seatpost: ["seatpost-diameter"],
  "seat-clamp": ["seat-clamp-diameter"],
  "pedal-left": ["pedal-type"],
  "pedal-right": ["pedal-type"],
};

/** Parts searched by one of their values rather than their label ("guidoline", not "guidoline ou poignées"). */
const LABEL_ATTRIBUTE: Partial<Record<PartId, string>> = { "grips-or-tape": "cover" };

/**
 * `[label, speeds, range, freehub, …, brand].filter(Boolean).join(' ')` —
 * `cassette 11 vitesses 11-34 hg` (§5.8). Speeds are spelled with the unit
 * (`11 vitesses` / `11 speed`), every other value is typed as the shops list it.
 */
export function buildSearchQuery(
  partId: PartId,
  attributes: Record<string, AttributeValue>,
  locale: DomainLocale,
  brand?: string,
): string {
  const part: BikePart = { partId, attributes };
  // eslint-disable-next-line security/detect-object-injection -- `partId` is a PartId, a key of our own table
  const labelKey = LABEL_ATTRIBUTE[partId];
  const labelValue = labelKey === undefined ? undefined : ownValue(part, labelKey);
  const label =
    labelValue === undefined
      ? partLabel(locale, partId)
      : valueLabel(locale, labelKey as string, labelValue);

  // eslint-disable-next-line security/detect-object-injection -- `partId` is a PartId, a key of our own table
  const terms = (SEARCH_ATTRIBUTES[partId] ?? []).map((key) => {
    const value = ownValue(part, key);
    if (value === undefined) return "";
    if (key !== "speeds") return String(value);
    return typeof value === "number"
      ? domainMessage(locale, "parts.units.speeds", { value })
      : valueLabel(locale, key, value);
  });

  return [label.toLocaleLowerCase(locale), ...terms, brand ?? ""].filter(Boolean).join(" ");
}

// ── The guide ────────────────────────────────────────────────────────────────

export function buyingQuestion(
  locale: DomainLocale,
  partId: string,
  attribute: AttributeDef,
  bounds: Bounds,
  askedBecause: RuleId | null,
): BuyingQuestion {
  const values = attribute.values;
  return {
    partId,
    attribute: attribute.key,
    kind: attribute.kind,
    label: attributeLabel(locale, attribute.key),
    help: attribute.helpKey === undefined ? null : domainMessage(locale, attribute.helpKey),
    unit: attribute.unit ?? null,
    options:
      values === undefined
        ? null
        : values
            .filter((value) => satisfies(bounds, value))
            .map((value) => ({
              value,
              label: valueLabel(locale, attribute.key, value, attribute.unit),
            })),
    min: bounds.min ?? attribute.min ?? null,
    max: bounds.max ?? attribute.max ?? null,
    askedBecause,
  };
}

const OPEN: Bounds = { allowed: null, min: null, max: null };

export function buildBuyingGuide(
  build: BikeBuild,
  partId: PartId,
  locale: DomainLocale,
  options: BuyingGuideOptions = {},
): BuyingGuide {
  const definition = partDefinition(partId)!;
  const constraints = constraintsFor(build, partId, locale);
  const present = definition.attributes.filter((attribute) =>
    isAttributePresent(attribute, build.spec),
  );

  const base = findPart(build, partId)?.attributes ?? defaultAttributes(definition, build.spec);
  const attributes: Record<string, AttributeValue> = { ...base };
  const boundsByKey = new Map<string, Bounds>();
  for (const attribute of present) {
    const onKey = constraints.filter((constraint) => constraint.attribute === attribute.key);
    if (onKey.length === 0) continue;
    const bounds = mergeBounds(onKey);
    boundsByKey.set(attribute.key, bounds);
    const picked = pickValue(attribute, ownValue({ partId, attributes }, attribute.key), bounds);
    if (picked !== undefined) attributes[attribute.key] = picked;
  }
  const candidateTemplate: BikePart = { partId, attributes };

  const questions: BuyingQuestion[] = [];
  for (const missing of missingAttributes(build, candidateTemplate)) {
    if (missing.part === partId) continue;
    const other = partDefinition(missing.part)!;
    const attribute = other.attributes.find((entry) => entry.key === missing.attr)!;
    questions.push(buyingQuestion(locale, missing.part, attribute, OPEN, missing.askedBecause));
  }
  for (const attribute of present) {
    if (!attribute.editable) continue;
    const bounds = boundsByKey.get(attribute.key) ?? OPEN;
    const choices = (attribute.values ?? bounds.allowed ?? []).filter((value) =>
      satisfies(bounds, value),
    );
    const pinned = bounds.allowed !== null && choices.length === 1;
    if (!pinned) questions.push(buyingQuestion(locale, partId, attribute, bounds, null));
  }

  const query = buildSearchQuery(partId, attributes, locale, options.brand);
  const searchQueries = Object.fromEntries(RETAILER_ORDER.map((id) => [id, query])) as Record<
    RetailerId,
    string
  >;

  return {
    partId,
    label: partLabel(locale, partId),
    constraints,
    questions,
    candidateTemplate,
    searchQueries,
  };
}
