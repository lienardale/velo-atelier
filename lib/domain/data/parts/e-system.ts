/**
 * The electric assist (§2.3): motor and battery, on electric bikes only.
 *
 * A mid-drive motor takes the bottom bracket's place and drives the crankset
 * through a spline (`crank-interface`, the same vocabulary as the crank's
 * `spindle`, checked by `e-crank-interface`). Motor and battery service are
 * out of scope as guides — the checkup sends those to a shop (§Scope).
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import { BATTERY_POSITIONS } from "../conventions";

import { attr, copyOf, is, part, whenThen } from "./define";
import { ELECTRIC, SPINDLES } from "./standards";

const HUB_MOTOR = is("eSystem.motorPosition", "hub-rear");

const procedures = { check: ["check-e-system"], clean: ["clean-ebike-dos-donts"] };

export const E_SYSTEM_PARTS = [
  part({
    id: "e-motor",
    system: "e-system",
    includeWhen: ELECTRIC,
    optional: false,
    position: "none",
    meshId: "e-motor",
    attributes: [
      attr("motor-brand", {
        kind: "enum",
        values: ["bosch", "shimano", "yamaha", "brose", "bafang"],
        editable: true,
        fallback: "bosch",
        when: [whenThen(HUB_MOTOR, "bafang")],
      }),
      attr("crank-interface", {
        kind: "enum",
        values: SPINDLES,
        editable: true,
        presentWhen: is("eSystem.motorPosition", "mid-drive"),
        fallback: "bosch-spline",
      }),
      attr("torque", {
        kind: "number",
        unit: "Nm",
        min: 10,
        max: 150,
        editable: true,
        fallback: 85,
        when: [whenThen(HUB_MOTOR, 45)],
      }),
    ],
    procedures,
    checkupPriority: 85,
    wearItem: false,
  }),

  part({
    id: "e-battery",
    system: "e-system",
    includeWhen: ELECTRIC,
    optional: false,
    position: "none",
    meshId: "e-battery",
    attributes: [
      attr("battery-position", {
        kind: "enum",
        values: BATTERY_POSITIONS,
        editable: false,
        fallback: "integrated",
        when: copyOf("eSystem.batteryPosition", BATTERY_POSITIONS),
      }),
      attr("capacity", {
        kind: "number",
        unit: "Wh",
        min: 150,
        max: 1200,
        editable: true,
        fallback: 500,
      }),
      attr("voltage", {
        kind: "number",
        unit: "V",
        min: 24,
        max: 60,
        editable: true,
        fallback: 36,
      }),
    ],
    procedures,
    checkupPriority: 86,
    wearItem: false,
  }),
] as const;
