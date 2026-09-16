/**
 * `appliesTo` — which bikes a guide, or one of its steps, is for (§5.1, §6.2).
 *
 * Three jobs, all zod-free so the `/guides` "Pour mon vélo" filter can run them
 * in the browser:
 *
 *   1. evaluate a guide or a step against a built `BikeSpec`;
 *   2. know the whole vocabulary a condition may use — every spec path and the
 *      values it can hold — so the content check rejects `brakes.type in
 *      [disk-hydraulic]` instead of shipping a guide that matches no bike;
 *   3. describe a condition as a small tree the `AppliesToBanner` translates,
 *      with message keys derived from the path and the value.
 *
 * Message keys (`messages/<locale>/guides.json`):
 *
 *   guides.appliesTo.paths.<pathKey>              "Freins"
 *   guides.appliesTo.values.<pathKey>.<valueKey>  "Disque hydraulique"
 *
 * `pathKey` is the spec path with `_` for `.` (`brakes_type`) and `valueKey`
 * the value with `_` for `.` (`27_5`): next-intl keys cannot contain dots.
 * Numeric paths (`drivetrain.speeds`, `drivetrain.chainrings`,
 * `wheel.etrtoDiameter`) have no value keys — the number is shown as is.
 */
import {
  BAR_SHAPES,
  BATTERY_POSITIONS,
  BRAKE_MOUNTS,
  BRAKE_TYPES,
  DISCIPLINES,
  DRIVE_KINDS,
  DRIVETRAIN_KINDS,
  ETRTO_DIAMETERS,
  FRAME_STYLES,
  MOTOR_POSITIONS,
  PEDAL_IDS,
  SHIFTER_IDS,
  TIRE_SYSTEMS,
  TRANSMISSIONS,
  WHEEL_LABELS,
} from "@/lib/domain/data/conventions";
import { evalSpecCondition } from "@/lib/domain/engine/condition";
import type { SpecCondition, SpecConditionValue } from "@/lib/domain/schema/condition";
import type { ProcedureStep } from "@/lib/domain/schema/procedure";

type Vocabulary =
  | { kind: "enum"; values: readonly (string | boolean)[] }
  | { kind: "number"; values: readonly number[] };

const enumOf = (values: readonly (string | boolean)[]): Vocabulary => ({ kind: "enum", values });
const BOOLEAN = enumOf([true, false]);
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

/**
 * Every leaf path of a `BikeSpec` a condition may test, with the values it can
 * hold. `version` is deliberately absent: a guide never depends on the schema
 * version.
 */
export const SPEC_VOCABULARY: Readonly<Record<string, Vocabulary>> = {
  drive: enumOf(DRIVE_KINDS),
  discipline: enumOf(DISCIPLINES),
  "wheel.label": enumOf(WHEEL_LABELS),
  "wheel.etrtoDiameter": { kind: "number", values: ETRTO_DIAMETERS },
  "brakes.type": enumOf(BRAKE_TYPES),
  "brakes.isDisc": BOOLEAN,
  "brakes.mount": enumOf(BRAKE_MOUNTS),
  "drivetrain.kind": enumOf(DRIVETRAIN_KINDS),
  "drivetrain.chainrings": { kind: "number", values: [1, 2, 3] },
  "drivetrain.speeds": { kind: "number", values: range(1, 14) },
  "drivetrain.transmission": enumOf(TRANSMISSIONS),
  "drivetrain.shifter": enumOf(SHIFTER_IDS),
  "cockpit.bar": enumOf(BAR_SHAPES),
  pedals: enumOf(PEDAL_IDS),
  "suspension.front": BOOLEAN,
  "suspension.rear": BOOLEAN,
  "seatpost.dropper": BOOLEAN,
  "tires.system": enumOf(TIRE_SYSTEMS),
  "eSystem.motorPosition": enumOf(MOTOR_POSITIONS),
  "eSystem.batteryPosition": enumOf(BATTERY_POSITIONS),
  frameStyle: enumOf(FRAME_STYLES),
};

/** `brakes.type` → `brakes_type` */
export function pathKey(path: string): string {
  return path.replaceAll(".", "_");
}

/** `27.5` → `27_5`, `true` → `true` */
export function valueKey(value: SpecConditionValue): string {
  return String(value).replaceAll(".", "_");
}

/** Is there no condition, or does `spec` satisfy it? */
export function matchesSpec(condition: SpecCondition<string> | undefined, spec: unknown): boolean {
  return condition === undefined || evalSpecCondition(condition, spec);
}

/** The steps of a guide that apply to `spec`, in document order. */
export function stepsForSpec<S extends Pick<ProcedureStep<string>, "appliesTo">>(
  steps: readonly S[],
  spec: unknown,
): S[] {
  return steps.filter((step) => matchesSpec(step.appliesTo, spec));
}

// ── Validation ───────────────────────────────────────────────────────────────

/** One problem with a condition, and where in it (`all.1.in`). */
export interface ConditionProblem {
  path: Array<string | number>;
  message: string;
}

/** Unknown paths and out-of-vocabulary values, located inside the condition. */
export function conditionProblems(
  condition: SpecCondition<string>,
  at: Array<string | number> = [],
): ConditionProblem[] {
  if ("all" in condition || "any" in condition) {
    const key = "all" in condition ? "all" : "any";
    const children = "all" in condition ? condition.all : condition.any;
    return children.flatMap((child, index) => conditionProblems(child, [...at, key, index]));
  }
  if ("not" in condition) return conditionProblems(condition.not, [...at, "not"]);

  const vocabulary = Object.hasOwn(SPEC_VOCABULARY, condition.path)
    ? SPEC_VOCABULARY[condition.path]
    : undefined;
  if (!vocabulary) {
    return [{ path: [...at, "path"], message: `"${condition.path}" is not a BikeSpec path` }];
  }
  const listKey = "in" in condition ? "in" : "notIn";
  const values = "in" in condition ? condition.in : condition.notIn;
  return values.flatMap((value, index) =>
    (vocabulary.values as readonly SpecConditionValue[]).includes(value)
      ? []
      : [
          {
            path: [...at, listKey, index],
            message: `${JSON.stringify(value)} is not a possible value of "${condition.path}"`,
          },
        ],
  );
}

/** Every `(path, value)` leaf of a condition, for message-key checks. */
export function conditionLeaves(
  condition: SpecCondition<string>,
): Array<{ path: string; value: SpecConditionValue }> {
  if ("all" in condition) return condition.all.flatMap(conditionLeaves);
  if ("any" in condition) return condition.any.flatMap(conditionLeaves);
  if ("not" in condition) return conditionLeaves(condition.not);
  const values = "in" in condition ? condition.in : condition.notIn;
  return values.map((value) => ({ path: condition.path, value }));
}

/** Whether `path` holds numbers (shown as is) rather than labelled values. */
export function isNumericPath(path: string): boolean {
  // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn
  return Object.hasOwn(SPEC_VOCABULARY, path) && SPEC_VOCABULARY[path].kind === "number";
}

/**
 * The message keys (relative to the `guides` namespace) a condition needs:
 * one label per path, one label per non-numeric value.
 */
export function conditionMessageKeys(condition: SpecCondition<string>): string[] {
  const keys = new Set<string>();
  for (const leaf of conditionLeaves(condition)) {
    keys.add(`appliesTo.paths.${pathKey(leaf.path)}`);
    if (!isNumericPath(leaf.path)) {
      keys.add(`appliesTo.values.${pathKey(leaf.path)}.${valueKey(leaf.value)}`);
    }
  }
  return [...keys];
}

// ── Description ──────────────────────────────────────────────────────────────

/** A condition as the banner reads it. */
export type AppliesToNode =
  | {
      kind: "leaf";
      pathKey: string;
      negated: boolean;
      values: Array<{ key: string; raw: string; numeric: boolean }>;
    }
  | { kind: "all" | "any"; children: AppliesToNode[] }
  | { kind: "not"; child: AppliesToNode };

export function describeCondition(condition: SpecCondition<string>): AppliesToNode {
  if ("all" in condition) return { kind: "all", children: condition.all.map(describeCondition) };
  if ("any" in condition) return { kind: "any", children: condition.any.map(describeCondition) };
  if ("not" in condition) return { kind: "not", child: describeCondition(condition.not) };

  const negated = "notIn" in condition;
  const values = "in" in condition ? condition.in : condition.notIn;
  const numeric = isNumericPath(condition.path);
  return {
    kind: "leaf",
    pathKey: pathKey(condition.path),
    negated,
    values: values.map((value) => ({ key: valueKey(value), raw: String(value), numeric })),
  };
}
