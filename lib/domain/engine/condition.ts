/**
 * Evaluating a {@link SpecCondition} against a built `BikeSpec` (§2.2).
 *
 * Zod-free: exported by `lib/domain/index.ts` and therefore reachable from the
 * client bundle.
 */
import type { SpecCondition, SpecConditionValue } from "../schema/condition";

import { getAtPath } from "./paths";

/**
 * Is `condition` true for `spec`?
 *
 * A leaf that reads `undefined` — every path under a null `eSystem` on a
 * muscular bike — matches no `in` list and every `notIn` list. That asymmetry
 * is deliberate: `{ not: { path: 'eSystem.motorPosition', in: ['mid-drive'] } }`
 * means "not a mid-drive e-bike", which is true of every muscular bike.
 */
export function evalSpecCondition(condition: SpecCondition<string>, spec: unknown): boolean {
  if ("path" in condition) {
    const value = getAtPath(spec, condition.path) as SpecConditionValue | undefined;
    return "in" in condition ? includes(condition.in, value) : !includes(condition.notIn, value);
  }
  if ("all" in condition) return condition.all.every((child) => evalSpecCondition(child, spec));
  if ("any" in condition) return condition.any.some((child) => evalSpecCondition(child, spec));
  return !evalSpecCondition(condition.not, spec);
}

function includes(
  values: readonly SpecConditionValue[],
  value: SpecConditionValue | undefined,
): boolean {
  return value !== undefined && values.includes(value);
}
