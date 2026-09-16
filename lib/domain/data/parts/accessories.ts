/**
 * Accessories (§2.3): mudguards, rack, kickstand, lights.
 *
 * Fitted by default on city and hybrid bikes (`includeWhen`), and `optional`
 * everywhere, so any owner can add or remove them. Each one is drawn as its own
 * simple mesh (`acc-<id>`, one draw call) and is clickable directly.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import { attr, part, whenThen } from "./define";
import { CITY, ELECTRIC } from "./standards";

const common = {
  system: "accessories",
  includeWhen: CITY,
  optional: true,
  position: "none",
  checkupPriority: 95,
  wearItem: false,
} as const;

export const ACCESSORY_PARTS = [
  part({
    ...common,
    id: "mudguards",
    meshId: "acc-mudguards",
    attributes: [
      attr("mudguard-width", {
        kind: "number",
        unit: "mm",
        min: 25,
        max: 80,
        editable: true,
        fallback: null,
      }),
    ],
    procedures: { check: ["check-frame-bolts"] },
  }),

  part({
    ...common,
    id: "rack",
    meshId: "acc-rack",
    attributes: [
      attr("rack-mount", {
        kind: "enum",
        values: ["frame-eyelets", "seatpost-clamp"],
        editable: true,
        fallback: "frame-eyelets",
      }),
    ],
    procedures: { check: ["check-frame-bolts"] },
  }),

  part({
    ...common,
    id: "kickstand",
    meshId: "acc-kickstand",
    attributes: [
      attr("kickstand-mount", {
        kind: "enum",
        values: ["chainstay-plate", "center", "rear-axle"],
        editable: true,
        fallback: "center",
      }),
    ],
    procedures: { check: ["check-frame-bolts"] },
  }),

  part({
    ...common,
    id: "lights",
    meshId: "acc-lights",
    attributes: [
      attr("light-power", {
        kind: "enum",
        values: ["battery", "dynamo", "e-bike"],
        editable: true,
        fallback: "battery",
        when: [whenThen(ELECTRIC, "e-bike"), whenThen(CITY, "dynamo")],
      }),
    ],
    procedures: { check: ["check-lights-safety"] },
  }),
] as const;
