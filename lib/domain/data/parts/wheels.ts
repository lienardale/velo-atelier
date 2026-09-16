/**
 * The two wheels (§2.3): axle standard, rim, rotor interface and — at the back
 * — the freehub body that decides which cassette fits.
 *
 * Freehub defaults (§2.3): up to 10 speeds → HG; road/gravel 11–12 → HG-L;
 * mountain 11 → HG; 12 → Micro Spline; 13 → XDR; 5–7-speed derailleurs →
 * a threaded freewheel; internal gear hubs → their own shell.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import { ETRTO_DIAMETERS } from "../conventions";

import { attr, part, whenThen, type Default } from "./define";
import {
  DISC,
  ETRTO_DIAMETER_DEFAULT,
  FREEHUBS,
  FRONT_AXLE_DEFAULT,
  FRONT_AXLES,
  REAR_AXLE_DEFAULT,
  REAR_AXLES,
  RIM_WIDTH_DEFAULT,
  RIM_WIDTHS,
  ROTOR_INTERFACE_DEFAULT,
  ROTOR_INTERFACES,
  TUBELESS,
  WHEEL_FREEHUB_DEFAULT,
} from "./standards";

const sharedAttributes = [
  attr("etrto-diameter", {
    kind: "enum",
    values: ETRTO_DIAMETERS,
    editable: true,
    ...ETRTO_DIAMETER_DEFAULT,
  }),
  attr("rim-width", { kind: "enum", values: RIM_WIDTHS, editable: true, ...RIM_WIDTH_DEFAULT }),
  attr("rotor-interface", {
    kind: "enum",
    values: ROTOR_INTERFACES,
    editable: true,
    presentWhen: DISC,
    ...ROTOR_INTERFACE_DEFAULT,
  }),
  attr("tubeless-ready", {
    kind: "boolean",
    editable: true,
    fallback: false,
    when: [whenThen(TUBELESS, true)],
  }),
];

const axle = (values: readonly string[], defaults: Default) =>
  attr("axle", { kind: "enum", values, editable: true, ...defaults });

const procedures = {
  check: ["check-wheels-tires"],
  adjust: ["adjust-hub-bearing-preload"],
};

export const WHEEL_PARTS = [
  part({
    id: "wheel-front",
    system: "wheels",
    optional: false,
    position: "front",
    meshId: "wheel-front",
    attributes: [axle(FRONT_AXLES, FRONT_AXLE_DEFAULT), ...sharedAttributes],
    procedures,
    checkupPriority: 20,
    wearItem: false,
  }),

  part({
    id: "wheel-rear",
    system: "wheels",
    optional: false,
    position: "rear",
    meshId: "wheel-rear",
    attributes: [
      axle(REAR_AXLES, REAR_AXLE_DEFAULT),
      ...sharedAttributes,
      attr("freehub", { kind: "enum", values: FREEHUBS, editable: true, ...WHEEL_FREEHUB_DEFAULT }),
    ],
    procedures,
    checkupPriority: 21,
    wearItem: false,
  }),
] as const;
