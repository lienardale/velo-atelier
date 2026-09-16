/**
 * Brakes (§2.3), front and rear: lever, caliper (or rim-brake arms), rotor,
 * pads and the cable or hose between lever and caliper.
 *
 * Every bike has **both** levers and both calipers, whatever the brake type
 * (§2.6). Rotors exist on disc bikes only. Pads are clicked through their
 * caliper and the line through its lever (`hostPartId`); the French/continental
 * convention puts the front brake on the left lever (`BRAKE_SIDE`).
 *
 * A caliper's `rotor-size` follows its `mount` and `adapter`
 * ({@link rotorSizeFor}); the default bike gets the adapter that matches its
 * default rotor, so the two never disagree out of the box.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import { BRAKE_TYPES, type Position } from "../conventions";

import { allOf, attr, copyOf, is, part, whenThen, type Default, type DefaultRule } from "./define";
import {
  BRAKE_ACTUATION_DEFAULT,
  BRAKE_ACTUATIONS,
  DISC,
  DROP_BAR,
  FRONT_ROTOR_DEFAULT,
  HYDRAULIC_DISC,
  MECHANICAL_DISC,
  MTB,
  PULLS,
  REAR_ROTOR_DEFAULT,
  REAR_SUSPENSION,
  ROAD,
  ROTOR_INTERFACE_DEFAULT,
  ROTOR_INTERFACES,
  ROTOR_SIZES,
  V_BRAKE,
} from "./standards";

/** Caliper body mounts; an IS frame takes a post-mount caliper on an adapter. */
export const CALIPER_MOUNTS = ["flat-mount", "post-mount"] as const;

export const ADAPTERS = [
  "none",
  "+20",
  "+40",
  "is-to-post",
  "is-to-post-180",
  "is-to-post-203",
  "is-to-flat",
] as const;

/**
 * Rotor diameter a caliper sits at, from its mount and adapter: flat mount is
 * native 140, post mount native 160, each `+20` step is one size up. `null`
 * for a combination nobody makes.
 */
export const ROTOR_SIZE_BY_MOUNT: Partial<Record<string, Partial<Record<string, number>>>> = {
  "flat-mount": { none: 140, "+20": 160, "+40": 180, "is-to-flat": 140 },
  "post-mount": {
    none: 160,
    "+20": 180,
    "+40": 203,
    "is-to-post": 160,
    "is-to-post-180": 180,
    "is-to-post-203": 203,
  },
};

export function rotorSizeFor(mount: unknown, adapter: unknown): number | null {
  const sizes = new Map(Object.entries(ROTOR_SIZE_BY_MOUNT[String(mount)] ?? {}));
  return sizes.get(String(adapter)) ?? null;
}

const LEVER_PULL_DEFAULT: Default = {
  fallback: "short-road",
  when: [
    whenThen(HYDRAULIC_DISC, "hydraulic"),
    whenThen(V_BRAKE, "long-v-brake"),
    whenThen(allOf(MECHANICAL_DISC, DROP_BAR), "short-road"),
    whenThen(MECHANICAL_DISC, "long-v-brake"),
  ],
};

/**
 * The adapter that puts the default caliper at the default rotor size: one
 * step up per size above the mount's native one ({@link ROTOR_SIZE_BY_MOUNT}).
 * A flat mount stops at 180 (a 203 rotor on flat mount is only a warning,
 * `rotor-caliper-mount`).
 */
function adapterDefaults(side: Position): DefaultRule[] {
  const IS = is("brakes.mount", "is-mount");
  const FLAT = is("brakes.mount", "flat-mount");
  const BIGGEST = allOf(MTB, REAR_SUSPENSION);
  const front = side === "front";
  return [
    ...(front ? [whenThen(allOf(IS, BIGGEST), "is-to-post-203")] : []),
    whenThen(allOf(IS, MTB), "is-to-post-180"),
    whenThen(IS, "is-to-post"),
    whenThen(allOf(FLAT, MTB), "+40"),
    whenThen(FLAT, "+20"),
    ...(front ? [whenThen(BIGGEST, "+40")] : []),
    whenThen(MTB, "+20"),
  ];
}

function brakeParts<S extends Position>(side: S) {
  const rotorDefault = side === "front" ? FRONT_ROTOR_DEFAULT : REAR_ROTOR_DEFAULT;
  const leverId = `brake-lever-${side}` as const;
  const caliperId = `brake-caliper-${side}` as const;
  const priority = side === "front" ? 10 : 11;
  const checks = { check: ["check-brakes-rim", "check-brakes-disc"] };

  return [
    part({
      id: leverId,
      system: "brakes",
      optional: false,
      position: side,
      meshId: leverId,
      attributes: [
        attr("actuation", {
          kind: "enum",
          values: BRAKE_ACTUATIONS,
          editable: true,
          ...BRAKE_ACTUATION_DEFAULT,
        }),
        attr("pull", { kind: "enum", values: PULLS, editable: true, ...LEVER_PULL_DEFAULT }),
        attr("integrated", {
          kind: "boolean",
          editable: true,
          fallback: false,
          when: [whenThen(is("drivetrain.shifter", "sti-integrated"), true)],
        }),
      ],
      procedures: { ...checks, adjust: ["adjust-brake-lever-reach"] },
      checkupPriority: priority,
      wearItem: false,
    }),

    part({
      id: caliperId,
      system: "brakes",
      optional: false,
      position: side,
      meshId: caliperId,
      attributes: [
        attr("brake-type", {
          kind: "enum",
          values: BRAKE_TYPES,
          editable: false,
          fallback: "v-brake",
          when: copyOf("brakes.type", BRAKE_TYPES),
        }),
        attr("mount", {
          kind: "enum",
          values: CALIPER_MOUNTS,
          editable: true,
          presentWhen: DISC,
          fallback: "post-mount",
          when: [whenThen(is("brakes.mount", "flat-mount"), "flat-mount")],
        }),
        attr("adapter", {
          kind: "enum",
          values: ADAPTERS,
          editable: true,
          presentWhen: DISC,
          fallback: "none",
          when: adapterDefaults(side),
        }),
        attr("rotor-size", {
          kind: "enum",
          values: ROTOR_SIZES,
          editable: true,
          presentWhen: DISC,
          ...rotorDefault,
        }),
        attr("actuation", {
          kind: "enum",
          values: BRAKE_ACTUATIONS,
          editable: true,
          ...BRAKE_ACTUATION_DEFAULT,
        }),
        attr("pull", {
          kind: "enum",
          values: ["short-road", "long-v-brake"],
          editable: true,
          presentWhen: MECHANICAL_DISC,
          fallback: "long-v-brake",
          when: [whenThen(DROP_BAR, "short-road")],
        }),
        attr("pad-type", {
          kind: "enum",
          values: ["resin", "sintered", "rim-cartridge", "rim-molded"],
          editable: true,
          fallback: "rim-molded",
          when: [
            whenThen(DISC, "resin"),
            whenThen(allOf(ROAD, is("brakes.type", "rim-caliper")), "rim-cartridge"),
          ],
        }),
        attr("piston-count", {
          kind: "number",
          unit: "count",
          min: 1,
          max: 6,
          editable: true,
          presentWhen: DISC,
          fallback: 2,
        }),
        attr("fluid", {
          kind: "enum",
          values: ["mineral", "dot"],
          editable: true,
          presentWhen: HYDRAULIC_DISC,
          fallback: "mineral",
        }),
      ],
      procedures: {
        ...checks,
        adjust: ["adjust-disc-caliper-alignment", "adjust-rim-brake-centering"],
      },
      checkupPriority: priority,
      wearItem: false,
    }),

    part({
      id: `rotor-${side}` as const,
      system: "brakes",
      includeWhen: DISC,
      optional: false,
      position: side,
      meshId: `rotor-${side}`,
      attributes: [
        attr("diameter", { kind: "enum", values: ROTOR_SIZES, editable: true, ...rotorDefault }),
        attr("interface", {
          kind: "enum",
          values: ROTOR_INTERFACES,
          editable: true,
          ...ROTOR_INTERFACE_DEFAULT,
        }),
      ],
      procedures: {
        check: ["check-brakes-disc"],
        replace: ["replace-rotor"],
        clean: ["clean-disc-rotors-pads"],
      },
      checkupPriority: priority,
      wearItem: true,
    }),

    part({
      id: `brake-pads-${side}` as const,
      system: "brakes",
      optional: false,
      position: side,
      meshId: null,
      hostPartId: caliperId,
      attributes: [
        attr("pad-model", { kind: "text", editable: true, fallback: null }),
        attr("pad-thickness", {
          kind: "number",
          unit: "mm",
          min: 0,
          max: 10,
          editable: true,
          fallback: null,
        }),
      ],
      procedures: {
        ...checks,
        replace: ["replace-brake-pads-disc", "replace-brake-pads-rim"],
        clean: ["clean-disc-rotors-pads", "clean-rim-braking-surface"],
      },
      checkupPriority: priority,
      wearItem: true,
    }),

    part({
      id: `brake-line-${side}` as const,
      system: "brakes",
      optional: false,
      position: side,
      meshId: null,
      hostPartId: leverId,
      attributes: [
        attr("kind", {
          kind: "enum",
          values: ["cable", "hose"],
          editable: true,
          fallback: "cable",
          when: [whenThen(HYDRAULIC_DISC, "hose")],
        }),
      ],
      procedures: { check: ["check-cables-hoses"], replace: ["replace-brake-cable"] },
      checkupPriority: priority + 2,
      wearItem: true,
    }),
  ] as const;
}

export const BRAKE_PARTS = [...brakeParts("front"), ...brakeParts("rear")] as const;
