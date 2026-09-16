/**
 * The cockpit (§2.3): handlebar, stem, and what your hands hold — bar tape on
 * a drop bar, grips everywhere else (`cover`).
 *
 * `grips-or-tape` keeps one id and one label for both, so a checkup answer or a
 * build-list item survives an owner switching bar shapes; the `cover` value
 * says which one it is, and the buying guide searches for that.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import { BAR_SHAPES } from "../conventions";

import { attr, copyOf, part, whenThen } from "./define";
import {
  BAR_CLAMP_DEFAULT,
  CITY,
  DROP_BAR,
  GRAVEL,
  KIDS,
  MTB,
  ROAD,
  STEERER_CLAMP_DEFAULT,
  STEERER_CLAMPS,
} from "./standards";

const barClamp = attr("bar-clamp", {
  kind: "number",
  unit: "mm",
  min: 22,
  max: 36,
  editable: true,
  ...BAR_CLAMP_DEFAULT,
});

export const COCKPIT_PARTS = [
  part({
    id: "handlebar",
    system: "cockpit",
    optional: false,
    position: "none",
    meshId: "handlebar",
    attributes: [
      attr("bar-shape", {
        kind: "enum",
        values: BAR_SHAPES,
        editable: false,
        fallback: "flat",
        when: copyOf("cockpit.bar", BAR_SHAPES),
      }),
      barClamp,
      attr("bar-width", {
        kind: "number",
        unit: "mm",
        min: 300,
        max: 850,
        editable: true,
        fallback: 620,
        when: [whenThen(ROAD, 420), whenThen(GRAVEL, 440), whenThen(MTB, 780), whenThen(KIDS, 520)],
      }),
    ],
    procedures: {
      check: ["check-headset", "check-frame-bolts"],
      measure: ["measure-reach-and-drop"],
    },
    checkupPriority: 52,
    wearItem: false,
  }),

  part({
    id: "stem",
    system: "cockpit",
    optional: false,
    position: "none",
    meshId: "stem",
    attributes: [
      barClamp,
      attr("steerer-clamp", {
        kind: "enum",
        values: STEERER_CLAMPS,
        editable: true,
        ...STEERER_CLAMP_DEFAULT,
      }),
      attr("stem-length", {
        kind: "number",
        unit: "mm",
        min: 30,
        max: 140,
        editable: true,
        fallback: 80,
        when: [
          whenThen(ROAD, 100),
          whenThen(GRAVEL, 90),
          whenThen(MTB, 50),
          whenThen(KIDS, 50),
          whenThen(CITY, 80),
        ],
      }),
    ],
    procedures: {
      check: ["check-headset", "check-frame-bolts"],
      measure: ["measure-reach-and-drop"],
    },
    checkupPriority: 51,
    wearItem: false,
  }),

  part({
    id: "grips-or-tape",
    system: "cockpit",
    optional: false,
    position: "none",
    meshId: "grips-or-tape",
    attributes: [
      attr("cover", {
        kind: "enum",
        values: ["bar-tape", "grips"],
        editable: true,
        fallback: "grips",
        when: [whenThen(DROP_BAR, "bar-tape")],
      }),
    ],
    procedures: {
      check: ["check-frame-bolts"],
      replace: ["replace-bar-tape", "replace-grips"],
    },
    checkupPriority: 53,
    wearItem: true,
  }),
] as const;
