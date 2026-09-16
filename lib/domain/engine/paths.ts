/**
 * Dotted paths into a plain object, as a type and as a reader (§2.2).
 *
 * `SpecCondition.path` is typed `Paths<BikeSpec>`, so `{ path: 'brakes.isDsic' }`
 * fails `tsc` in a data file instead of silently evaluating to `false` at
 * runtime. `getAtPath` is the matching reader.
 */

/** Values that end a path: nothing below them is addressable. */
type Leaf = string | number | boolean | bigint | symbol | null | undefined;

/**
 * Every dotted path through `T`, branch nodes included.
 *
 * `Paths<BikeSpec>` is `'version' | 'drive' | … | 'wheel' | 'wheel.label' | …`,
 * and a nullable branch is walked through its non-null shape, so
 * `'eSystem.motorPosition'` is addressable on a muscular bike too (it reads as
 * `undefined`, see {@link getAtPath}).
 */
export type Paths<T> = T extends Leaf
  ? never
  : {
      [K in keyof T & string]: NonNullable<T[K]> extends Leaf
        ? K
        : K | `${K}.${Paths<NonNullable<T[K]>>}`;
    }[keyof T & string];

/**
 * Read `path` out of `value`, or `undefined` when any segment is missing or
 * sits on a non-object (a null `eSystem`, an absent attribute).
 *
 * Prototype keys are never followed: `getAtPath(spec, '__proto__.polluted')`
 * reads `undefined`, so a path that reached this function from user input
 * cannot walk into `Object.prototype`.
 */
export function getAtPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    if (!Object.hasOwn(current, segment)) return undefined;
    // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn above, so prototype keys are unreachable
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
