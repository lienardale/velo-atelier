/**
 * `SpecCondition` — a predicate over a built `BikeSpec` (§2.2).
 *
 * Used wherever a piece of data applies to some bikes only: `includeWhen` on a
 * part, `presentWhen` on an attribute, `when` on a compatibility rule,
 * `appliesTo` on a guide or one of its steps.
 *
 * Evaluation lives in `engine/condition.ts` (zod-free, so the barrel can export
 * it); this file is the parser and the types.
 */
import * as z from "zod";

import type { SpecPath } from "./bike-spec";

/** What a spec leaf can hold, and therefore what a condition can compare against. */
export type SpecConditionValue = string | number | boolean;

/**
 * `{ path, in }` / `{ path, notIn }` test one leaf; `all` / `any` / `not`
 * combine. `path` is typed, so `{ path: 'brakes.isDsic', in: [true] }` fails
 * `tsc`.
 *
 * A path that reads `undefined` (a leaf under a null `eSystem`) is **not** in
 * any list and **is** in every `notIn`, which is what makes
 * `{ not: { path: 'eSystem.motorPosition', in: ['mid-drive'] } }` true on a
 * muscular bike (§2.2).
 */
export type SpecCondition<P extends string = SpecPath> =
  | { path: P; in: readonly SpecConditionValue[] }
  | { path: P; notIn: readonly SpecConditionValue[] }
  | { all: readonly SpecCondition<P>[] }
  | { any: readonly SpecCondition<P>[] }
  | { not: SpecCondition<P> };

const SpecConditionValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** A dotted path: at least one segment, segments are identifiers. */
// eslint-disable-next-line security/detect-unsafe-regex -- the inner group is anchored and cannot backtrack: a segment never matches a dot
export const SPEC_PATH_PATTERN = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/;

const SpecPathSchema = z.string().regex(SPEC_PATH_PATTERN);

/**
 * The runtime parser. It validates the shape and the path syntax; that the path
 * exists on a `BikeSpec` is a compile-time guarantee of {@link SpecCondition}
 * (and, for data files, of the catalogue tests).
 */
export const SpecConditionSchema: z.ZodType<SpecCondition<string>> = z.lazy(() =>
  z.union([
    z.strictObject({ path: SpecPathSchema, in: z.array(SpecConditionValueSchema).min(1) }),
    z.strictObject({ path: SpecPathSchema, notIn: z.array(SpecConditionValueSchema).min(1) }),
    z.strictObject({ all: z.array(SpecConditionSchema).min(1) }),
    z.strictObject({ any: z.array(SpecConditionSchema).min(1) }),
    z.strictObject({ not: SpecConditionSchema }),
  ]),
);
