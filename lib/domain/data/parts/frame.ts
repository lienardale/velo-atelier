/**
 * Frame, fork and headset (§2.3).
 *
 * The frame and the fork carry the "what fits" side of most compatibility
 * rules: dropouts, brake mounts, rotor and tyre clearance, head tube and
 * seat tube bores. Measurements nobody can guess from the decision tree (a seat
 * tube's bore) default to `null`, so the buying guide asks for them instead of
 * inventing a number (§2.4 `missingAttributes`).
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import { attr, part, whenThen } from "./define";
import {
  BB_SHELL_DEFAULT,
  BB_SHELLS,
  BELT,
  BRAKE_MOUNT_DEFAULT,
  CITY,
  DERAILLEUR,
  DISC,
  FRONT_AXLE_DEFAULT,
  FRONT_AXLES,
  FRONT_SUSPENSION,
  HANGER_STANDARD_DEFAULT,
  HANGER_STANDARDS,
  HEAD_TUBE_DEFAULT,
  HEAD_TUBES,
  KIDS,
  MAX_ROTOR_DEFAULT,
  MAX_TIRE_WIDTH_DEFAULT,
  MTB,
  NOT_MID_DRIVE,
  REAR_AXLE_DEFAULT,
  REAR_AXLES,
  REAR_SUSPENSION,
} from "./standards";
import { BRAKE_MOUNTS } from "../conventions";

const maxRotor = attr("max-rotor", {
  kind: "number",
  unit: "mm",
  min: 140,
  max: 230,
  editable: true,
  presentWhen: DISC,
  ...MAX_ROTOR_DEFAULT,
});

const maxTireWidth = attr("max-tire-width", {
  kind: "number",
  unit: "mm",
  min: 18,
  max: 130,
  editable: true,
  ...MAX_TIRE_WIDTH_DEFAULT,
});

const brakeMount = attr("brake-mount", {
  kind: "enum",
  values: BRAKE_MOUNTS,
  editable: true,
  presentWhen: DISC,
  ...BRAKE_MOUNT_DEFAULT,
});

export const FRAME_PARTS = [
  part({
    id: "frame",
    system: "frame",
    optional: false,
    position: "none",
    meshId: "frame",
    attributes: [
      attr("material", {
        kind: "enum",
        values: ["aluminium", "steel", "carbon", "titanium"],
        editable: true,
        fallback: "aluminium",
      }),
      attr("rear-axle", { kind: "enum", values: REAR_AXLES, editable: true, ...REAR_AXLE_DEFAULT }),
      attr("bb-shell", {
        kind: "enum",
        values: BB_SHELLS,
        editable: true,
        presentWhen: NOT_MID_DRIVE,
        ...BB_SHELL_DEFAULT,
      }),
      attr("head-tube", { kind: "enum", values: HEAD_TUBES, editable: true, ...HEAD_TUBE_DEFAULT }),
      attr("seatpost-diameter", {
        kind: "number",
        unit: "mm",
        min: 22,
        max: 35,
        editable: true,
        fallback: null,
      }),
      attr("seat-clamp-diameter", {
        kind: "number",
        unit: "mm",
        min: 25,
        max: 40,
        editable: true,
        fallback: null,
      }),
      brakeMount,
      maxRotor,
      maxTireWidth,
      attr("hanger-standard", {
        kind: "enum",
        values: HANGER_STANDARDS,
        editable: true,
        presentWhen: DERAILLEUR,
        ...HANGER_STANDARD_DEFAULT,
      }),
      attr("belt-splitter", {
        kind: "boolean",
        editable: true,
        presentWhen: BELT,
        fallback: true,
      }),
    ],
    procedures: { check: ["check-frame-bolts"], clean: ["clean-frame"] },
    checkupPriority: 90,
    wearItem: false,
  }),

  part({
    id: "fork",
    system: "frame",
    optional: false,
    position: "front",
    meshId: "fork",
    attributes: [
      attr("axle", { kind: "enum", values: FRONT_AXLES, editable: true, ...FRONT_AXLE_DEFAULT }),
      attr("steerer", { kind: "enum", values: HEAD_TUBES, editable: true, ...HEAD_TUBE_DEFAULT }),
      brakeMount,
      maxRotor,
      maxTireWidth,
      attr("travel-mm", {
        kind: "number",
        unit: "mm",
        min: 20,
        max: 220,
        editable: true,
        presentWhen: FRONT_SUSPENSION,
        fallback: 100,
        when: [
          whenThen(REAR_SUSPENSION, 140),
          whenThen(MTB, 120),
          whenThen(CITY, 63),
          whenThen(KIDS, 50),
        ],
      }),
      attr("spring", {
        kind: "enum",
        values: ["coil", "air"],
        editable: true,
        presentWhen: FRONT_SUSPENSION,
        fallback: "coil",
        when: [whenThen(MTB, "air")],
      }),
      attr("stanchion-mm", {
        kind: "number",
        unit: "mm",
        min: 25,
        max: 40,
        editable: true,
        presentWhen: FRONT_SUSPENSION,
        fallback: 30,
        when: [whenThen(MTB, 34)],
      }),
      attr("lockout", {
        kind: "boolean",
        editable: true,
        presentWhen: FRONT_SUSPENSION,
        fallback: true,
      }),
    ],
    procedures: {
      check: ["check-headset", "check-suspension"],
      adjust: ["adjust-suspension-sag"],
    },
    checkupPriority: 30,
    wearItem: false,
  }),

  part({
    id: "headset",
    system: "frame",
    optional: false,
    position: "none",
    meshId: null,
    hostPartId: "fork",
    attributes: [
      attr("head-tube", { kind: "enum", values: HEAD_TUBES, editable: true, ...HEAD_TUBE_DEFAULT }),
    ],
    procedures: { check: ["check-headset"], adjust: ["adjust-headset-preload"] },
    checkupPriority: 31,
    wearItem: false,
  }),
] as const;
