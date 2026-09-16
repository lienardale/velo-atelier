/**
 * Saddle, seatpost and seat clamp (§2.3).
 *
 * Bore diameters are real measurements (27.2, 30.9, 31.6 mm, …) that the
 * decision tree cannot know, so they default to `null`: the seatpost rules are
 * skipped until the owner measures, and the buying guide asks first.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import { attr, part, whenThen } from "./define";
import { CITY, DROPPER, KIDS, MTB } from "./standards";

export const SADDLE_PARTS = [
  part({
    id: "saddle",
    system: "saddle",
    optional: false,
    position: "none",
    meshId: "saddle",
    attributes: [
      attr("saddle-width", {
        kind: "number",
        unit: "mm",
        min: 110,
        max: 220,
        editable: true,
        fallback: 143,
        when: [whenThen(CITY, 160), whenThen(KIDS, 130)],
      }),
      attr("rail", {
        kind: "enum",
        values: ["round-7mm", "oval-7x9"],
        editable: true,
        fallback: "round-7mm",
      }),
    ],
    procedures: {
      check: ["check-frame-bolts"],
      replace: ["replace-saddle"],
      measure: ["measure-saddle-height", "measure-saddle-setback"],
    },
    checkupPriority: 60,
    wearItem: false,
  }),

  part({
    id: "seatpost",
    system: "saddle",
    optional: false,
    position: "none",
    meshId: "seatpost",
    attributes: [
      attr("seatpost-diameter", {
        kind: "number",
        unit: "mm",
        min: 22,
        max: 35,
        editable: true,
        fallback: null,
      }),
      attr("dropper", {
        kind: "boolean",
        editable: false,
        fallback: false,
        when: [whenThen(DROPPER, true)],
      }),
      attr("travel-mm", {
        kind: "number",
        unit: "mm",
        min: 50,
        max: 250,
        editable: true,
        presentWhen: DROPPER,
        fallback: 150,
        when: [whenThen(MTB, 170)],
      }),
    ],
    procedures: {
      check: ["check-frame-bolts", "check-suspension"],
      measure: ["measure-saddle-height"],
    },
    checkupPriority: 61,
    wearItem: false,
  }),

  part({
    id: "seat-clamp",
    system: "saddle",
    optional: false,
    position: "none",
    meshId: null,
    hostPartId: "seatpost",
    attributes: [
      attr("seat-clamp-diameter", {
        kind: "number",
        unit: "mm",
        min: 25,
        max: 40,
        editable: true,
        fallback: null,
      }),
      attr("quick-release", {
        kind: "boolean",
        editable: true,
        fallback: false,
        when: [whenThen(CITY, true), whenThen(KIDS, true)],
      }),
    ],
    procedures: { check: ["check-frame-bolts"] },
    checkupPriority: 62,
    wearItem: false,
  }),
] as const;
