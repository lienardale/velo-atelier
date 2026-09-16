/**
 * Builders for the part catalogue (§2.3).
 *
 * Every message key of a part is derived from its id, and every key of an
 * attribute from its attribute key — the same trick `decision-tree.ts` uses —
 * so a data file cannot spell one wrong and `checkPartCatalog` never has to
 * catch it:
 *
 *   `parts.<id>.label` `parts.<id>.description`
 *   `parts.attr.<key>.label` `parts.attr.<key>.help`
 *
 * `part()` keeps the literal type of `id` (a `const` type parameter), which is
 * how `PartId` in `./index.ts` becomes a union of 48 literals rather than
 * `string` without a hand-maintained list next to the data.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import type { SpecPath } from "../../schema/bike-spec";
import type { SpecCondition, SpecConditionValue } from "../../schema/condition";
import type {
  AttributeDef,
  AttributeDefault,
  AttributeValue,
  PartDefinition,
} from "../../schema/part";

/** A condition over a `BikeSpec`, path-checked by `tsc`. */
export type Condition = SpecCondition<SpecPath>;

/** `path` holds one of `values`. */
export const is = (path: SpecPath, ...values: SpecConditionValue[]): Condition => ({
  path,
  in: values,
});

/** `path` holds none of `values` (true on an absent leaf, see `evalSpecCondition`). */
export const isNot = (path: SpecPath, ...values: SpecConditionValue[]): Condition => ({
  path,
  notIn: values,
});

export const allOf = (...conditions: Condition[]): Condition => ({ all: conditions });

export const not = (condition: Condition): Condition => ({ not: condition });

/** One conditional default: "on bikes where `when` holds, the value is `value`". */
export type DefaultRule = AttributeDefault["when"][number];

/** A complete default — what `attr()` spreads in. */
export type Default = { fallback: AttributeValue | null; when?: readonly DefaultRule[] };

/** `value` whenever `condition` holds. */
export const whenThen = (condition: Condition, value: AttributeValue): DefaultRule => ({
  when: condition,
  value,
});

/**
 * Copy a spec leaf into an attribute, one rule per value:
 * `copyOf('drivetrain.speeds', [11, 12])` → 11 on an 11-speed bike, 12 on a 12-speed one.
 */
export function copyOf(path: SpecPath, values: readonly AttributeValue[]): DefaultRule[] {
  return values.map((value) => whenThen(is(path, value), value));
}

type AttributeInput = Omit<AttributeDef, "key" | "labelKey" | "helpKey" | "default"> & Default;

/** An attribute, its message keys derived from `key`. Every attribute carries help text. */
export function attr(key: string, input: AttributeInput): AttributeDef {
  const { fallback, when, ...rest } = input;
  return {
    key,
    ...rest,
    default: { fallback, when: when ?? [] },
    labelKey: `parts.attr.${key}.label`,
    helpKey: `parts.attr.${key}.help`,
  };
}

type PartInput<Id extends string> = Omit<PartDefinition, "id" | "labelKey" | "descriptionKey"> & {
  id: Id;
};

/** A part, its message keys derived from `id`, its id kept as a literal type. */
export function part<const Id extends string>(input: PartInput<Id>): PartDefinition & { id: Id } {
  return {
    ...input,
    labelKey: `parts.${input.id}.label`,
    descriptionKey: `parts.${input.id}.description`,
  };
}
