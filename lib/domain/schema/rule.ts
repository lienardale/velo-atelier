/**
 * Compatibility rules (§2.4) — "will this part work on this bike?".
 *
 * A rule compares two attribute references (`<partId>.<attributeKey>`) with one
 * of five checks. The catalogue lives in `lib/domain/data/rules.ts` (W1-T2) and
 * the engine in `engine/compatibility.ts`; this file is the contract.
 *
 * Semantics the engine implements, stated here because they shape the data:
 * table lookups use `String(value)`, and an unset attribute or a table without
 * the key means the rule is **skipped** (and reported by `missingAttributes`),
 * never silently failed.
 */
import * as z from "zod";

import { ID_PATTERN } from "../data/conventions";

import type { SpecPath } from "./bike-spec";
import { SpecConditionSchema, type SpecCondition } from "./condition";

export const RULE_SEVERITIES = ["error", "warning"] as const;

export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

/**
 * `<partId>.<attributeKey>` — the left and right side of a check.
 * `{side}` is allowed so one template can be expanded into its front and rear
 * instances by `pairFrontRear()`.
 */
export const ATTRIBUTE_REF_PATTERN = /^[a-z0-9-]+(\{side\})?[a-z0-9-]*\.[a-z0-9-]+$/;

export type AttributeRef = string;

export type RuleCheck =
  /** The two sides must be equal (`String(a) === String(b)`). */
  | { kind: "equal"; a: AttributeRef; b: AttributeRef }
  /** `b` must be one of `table[String(a)]`. */
  | {
      kind: "allowed";
      a: AttributeRef;
      b: AttributeRef;
      table: Record<string, (string | number)[]>;
    }
  /** `a ≤ b` (+ `margin`), both numbers — rotor bigger than the frame allows, … */
  | { kind: "lte"; a: AttributeRef; b: AttributeRef; margin?: number }
  /** `b` must fall inside `table[String(a)]` — tyre width for a rim width. */
  | { kind: "range"; a: AttributeRef; b: AttributeRef; table: Record<string, [number, number]> }
  /** A boolean attribute that must hold a given value (tubeless-ready, belt splitter). */
  | { kind: "flag"; a: AttributeRef; mustBe: boolean };

export interface CompatibilityRule<P extends string = SpecPath> {
  id: string;
  severity: RuleSeverity;
  /** The parts this rule talks about; the build list shows it on each of them. */
  appliesTo: readonly string[];
  /** Absent = whatever the bike is. */
  when?: SpecCondition<P>;
  check: RuleCheck;
  /** `rules.<id>.message` */
  messageKey: string;
  /** `rules.<id>.fix` — what to do about it. */
  fixHintKey?: string;
}

const AttributeRefSchema = z.string().regex(ATTRIBUTE_REF_PATTERN);
const TableValueSchema = z.union([z.string(), z.number()]);

export const RuleCheckSchema: z.ZodType<RuleCheck> = z.union([
  z.strictObject({ kind: z.literal("equal"), a: AttributeRefSchema, b: AttributeRefSchema }),
  z.strictObject({
    kind: z.literal("allowed"),
    a: AttributeRefSchema,
    b: AttributeRefSchema,
    table: z.record(z.string(), z.array(TableValueSchema).min(1)),
  }),
  z.strictObject({
    kind: z.literal("lte"),
    a: AttributeRefSchema,
    b: AttributeRefSchema,
    margin: z.number().optional(),
  }),
  z.strictObject({
    kind: z.literal("range"),
    a: AttributeRefSchema,
    b: AttributeRefSchema,
    table: z.record(z.string(), z.tuple([z.number(), z.number()])),
  }),
  z.strictObject({ kind: z.literal("flag"), a: AttributeRefSchema, mustBe: z.boolean() }),
]);

export const CompatibilityRuleSchema: z.ZodType<CompatibilityRule<string>> = z.strictObject({
  id: z.string().regex(ID_PATTERN).max(64),
  severity: z.enum(RULE_SEVERITIES),
  appliesTo: z.array(z.string().regex(ID_PATTERN)).min(1),
  when: SpecConditionSchema.optional(),
  check: RuleCheckSchema,
  messageKey: z.string().regex(/^rules\.[a-z0-9-]+\.message$/),
  fixHintKey: z
    .string()
    .regex(/^rules\.[a-z0-9-]+\.fix$/)
    .optional(),
});

/**
 * Catalogue-wide refinements: ids are unique, and a `range` table never holds an
 * inverted interval (a copy-paste of `[32, 25]` would make every tyre wrong).
 */
export function checkRuleCatalog(rules: readonly CompatibilityRule<string>[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    if (seen.has(rule.id)) errors.push(`${rule.id}: duplicate rule id`);
    seen.add(rule.id);

    if (rule.check.kind === "range") {
      for (const [key, [min, max]] of Object.entries(rule.check.table)) {
        if (min > max) errors.push(`${rule.id}: range for "${key}" is inverted`);
      }
    }
  }

  return errors;
}

export const RuleCatalogSchema = z.array(CompatibilityRuleSchema).check((ctx) => {
  for (const message of checkRuleCatalog(ctx.value)) {
    ctx.issues.push({ code: "custom", message, input: ctx.value });
  }
});
