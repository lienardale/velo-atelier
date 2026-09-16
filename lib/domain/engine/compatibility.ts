/**
 * The compatibility engine (§2.4).
 *
 * Semantics, in the order they are applied to one rule:
 *
 *   1. a rule whose `when` is false for the bike does not apply;
 *   2. a rule that reads a part the build does not have does not apply (a rotor
 *      rule on a bike without rotors is not "unknown", it is irrelevant);
 *   3. a referenced attribute that is **unset** skips the rule, and
 *      `missingAttributes()` reports it — that is how the buying guide knows
 *      what to ask;
 *   4. a table lookup (`allowed`, `range`) uses `String(value)` on both sides;
 *      a table without the key skips the rule (nothing to compare against);
 *   5. otherwise the check passes or produces an issue; `ok` means "no issue of
 *      severity `error`" — warnings inform, they do not block.
 *
 * Zod-free: reachable from the barrel (the build list recomputes compatibility
 * on every refinement change, §6.5).
 */
import { RULES, type CatalogRule, type RuleId } from "../data/rules";
import type { AttributeValue, BikeBuild, BikePart } from "../schema/part";
import type { RuleCheck, RuleSeverity } from "../schema/rule";

import { evalSpecCondition } from "./condition";

/** One broken rule on one build. */
export interface CompatibilityIssue {
  ruleId: RuleId;
  severity: RuleSeverity;
  /** The parts the issue is about (the rule's `appliesTo`). */
  partIds: readonly string[];
  messageKey: string;
  fixHintKey?: string;
  /** The values that were compared, `a` then `b` (one entry for a `flag`). */
  values: AttributeValue[];
}

export interface CompatibilityReport {
  /** No issue of severity `error`. */
  ok: boolean;
  issues: CompatibilityIssue[];
}

/** An attribute a rule needed and did not find. */
export interface MissingAttribute {
  part: string;
  attr: string;
  /** The first rule that needs it. */
  askedBecause: RuleId;
}

/** `<partId>.<attributeKey>`, split. */
export interface ParsedRef {
  partId: string;
  key: string;
}

export function parseRef(ref: string): ParsedRef {
  const dot = ref.indexOf(".");
  return { partId: ref.slice(0, dot), key: ref.slice(dot + 1) };
}

/** The references a check reads, `a` first. */
export function refsOf(check: RuleCheck): ParsedRef[] {
  return check.kind === "flag" ? [parseRef(check.a)] : [parseRef(check.a), parseRef(check.b)];
}

type Evaluation =
  | { status: "not-applicable" }
  | { status: "missing"; missing: ParsedRef[] }
  | { status: "skipped" }
  | { status: "pass" }
  | { status: "fail"; values: AttributeValue[] };

const tableHas = (values: readonly (string | number)[], value: AttributeValue) =>
  values.some((entry) => String(entry) === String(value));

/**
 * Compare the values of a check: `true`/`false`, or `null` when a table has no
 * entry for the left-hand value.
 */
export function compareValues(check: RuleCheck, values: readonly AttributeValue[]): boolean | null {
  const [a, b] = values;
  switch (check.kind) {
    case "equal":
      return String(a) === String(b);
    case "allowed": {
      const allowed = lookup(check.table, a);
      return allowed === undefined ? null : tableHas(allowed, b);
    }
    case "lte":
      return Number(a) <= Number(b) + (check.margin ?? 0);
    case "range": {
      const bounds = lookup(check.table, a);
      return bounds === undefined ? null : Number(b) >= bounds[0] && Number(b) <= bounds[1];
    }
    case "flag":
      return a === check.mustBe;
  }
}

/** `table[String(key)]`, own keys only — a value of `"__proto__"` finds nothing. */
function lookup<T>(table: Record<string, T>, key: AttributeValue): T | undefined {
  const name = String(key);
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn: prototype keys never resolve
  return Object.hasOwn(table, name) ? table[name] : undefined;
}

function evaluate(rule: CatalogRule, build: BikeBuild): Evaluation {
  if (rule.when !== undefined && !evalSpecCondition(rule.when, build.spec)) {
    return { status: "not-applicable" };
  }
  const sides = refsOf(rule.check).map((ref) => ({
    ref,
    part: build.parts.find((part) => part.partId === ref.partId),
  }));
  if (sides.some((side) => side.part === undefined)) return { status: "not-applicable" };

  const read = sides.map((side) => ({
    ref: side.ref,
    value: readAttribute(side.part as BikePart, side.ref.key),
  }));
  const missing = read.filter((side) => side.value === undefined).map((side) => side.ref);
  if (missing.length > 0) return { status: "missing", missing };

  const values = read.map((side) => side.value as AttributeValue);
  const verdict = compareValues(rule.check, values);
  if (verdict === null) return { status: "skipped" };
  return verdict ? { status: "pass" } : { status: "fail", values };
}

function readAttribute(part: BikePart, key: string): AttributeValue | undefined {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn: prototype keys never resolve
  return Object.hasOwn(part.attributes, key) ? part.attributes[key] : undefined;
}

function toIssue(rule: CatalogRule, values: AttributeValue[]): CompatibilityIssue {
  return {
    ruleId: rule.id,
    severity: rule.severity,
    partIds: rule.appliesTo,
    messageKey: rule.messageKey,
    fixHintKey: rule.fixHintKey,
    values,
  };
}

function report(rules: readonly CatalogRule[], build: BikeBuild): CompatibilityReport {
  const issues: CompatibilityIssue[] = [];
  for (const rule of rules) {
    const evaluation = evaluate(rule, build);
    if (evaluation.status === "fail") issues.push(toIssue(rule, evaluation.values));
  }
  return { ok: issues.every((issue) => issue.severity !== "error"), issues };
}

/** Does this rule read `partId`? */
export function ruleTouches(rule: CatalogRule, partId: string): boolean {
  return refsOf(rule.check).some((ref) => ref.partId === partId);
}

/** The build with `candidate` fitted in place of the part with the same id (or added). */
export function withCandidate(build: BikeBuild, candidate: BikePart): BikeBuild {
  const present = build.parts.some((part) => part.partId === candidate.partId);
  const parts = present
    ? build.parts.map((part) => (part.partId === candidate.partId ? candidate : part))
    : [...build.parts, candidate];
  return { spec: build.spec, parts };
}

/** Every rule, on the whole build. */
export function checkBuild(build: BikeBuild): CompatibilityReport {
  return report(RULES, build);
}

/** The rules that read `candidate`'s part, with `candidate` fitted in its place. */
export function checkCompatibility(build: BikeBuild, candidate: BikePart): CompatibilityReport {
  return report(
    RULES.filter((rule) => ruleTouches(rule, candidate.partId)),
    withCandidate(build, candidate),
  );
}

/**
 * The attributes the rules touching `candidate` could not read, on either
 * side, first-needed first; one entry per `(part, attr)`.
 */
export function missingAttributes(build: BikeBuild, candidate: BikePart): MissingAttribute[] {
  const fitted = withCandidate(build, candidate);
  const seen = new Set<string>();
  const missing: MissingAttribute[] = [];
  for (const rule of RULES) {
    if (!ruleTouches(rule, candidate.partId)) continue;
    const evaluation = evaluate(rule, fitted);
    if (evaluation.status !== "missing") continue;
    for (const ref of evaluation.missing) {
      const id = `${ref.partId}.${ref.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      missing.push({ part: ref.partId, attr: ref.key, askedBecause: rule.id });
    }
  }
  return missing;
}

/** Why a rule did or did not fire — exported for the buying guide and the tests. */
export function ruleStatus(rule: CatalogRule, build: BikeBuild): Evaluation["status"] {
  return evaluate(rule, build).status;
}
