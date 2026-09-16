/**
 * Pedals (§2.3): one part per side, because a left pedal is reverse-threaded
 * and each side wears and seizes on its own.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import { PEDAL_IDS } from "../conventions";

import { attr, copyOf, is, part, whenThen } from "./define";
import { PEDAL_THREADS } from "./standards";

const pedalAttributes = [
  attr("pedal-type", {
    kind: "enum",
    values: PEDAL_IDS,
    editable: true,
    fallback: "flat",
    when: copyOf("pedals", PEDAL_IDS),
  }),
  attr("pedal-thread", { kind: "enum", values: PEDAL_THREADS, editable: true, fallback: "9-16" }),
  attr("cleat", {
    kind: "enum",
    values: ["none", "spd", "spd-sl", "look-keo"],
    editable: true,
    fallback: "none",
    when: [
      whenThen(is("pedals", "road-clipless"), "spd-sl"),
      whenThen(is("pedals", "spd", "combo"), "spd"),
    ],
  }),
];

const procedures = {
  check: ["check-pedals"],
  replace: ["replace-pedals"],
  adjust: ["adjust-cleats"],
};

export const PEDAL_PARTS = [
  part({
    id: "pedal-left",
    system: "pedals",
    optional: false,
    position: "left",
    meshId: "pedal-left",
    attributes: pedalAttributes,
    procedures,
    checkupPriority: 70,
    wearItem: false,
  }),

  part({
    id: "pedal-right",
    system: "pedals",
    optional: false,
    position: "right",
    meshId: "pedal-right",
    attributes: pedalAttributes,
    procedures,
    checkupPriority: 71,
    wearItem: false,
  }),
] as const;
