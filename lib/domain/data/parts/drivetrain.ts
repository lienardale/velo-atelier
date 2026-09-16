/**
 * The drivetrain (§2.3): what turns pedalling into wheel speed, and what
 * changes gear.
 *
 * Presence follows the spec closely:
 *
 *   - a mid-drive motor replaces the bottom bracket (the crankset stays);
 *   - a chain **or** a belt, never both;
 *   - a cassette from 8 speeds up, a threaded freewheel on 5–7-speed
 *     derailleurs — both `optional`, so an owner can swap one for the other;
 *   - a front derailleur and a left shifter only with two or three chainrings;
 *   - shift cables only when the shifting is mechanical.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import { SHIFTER_IDS } from "../conventions";

import { allOf, attr, copyOf, is, isNot, part, whenThen } from "./define";
import {
  BB_SHELL_DEFAULT,
  BB_SHELLS,
  BB_SPINDLE_DEFAULT,
  BB_SPINDLES,
  BELT,
  BRANDS,
  CASSETTE_FREEHUB_DEFAULT,
  CASSETTE_FREEHUBS,
  CASSETTE_RANGE_DEFAULT,
  CASSETTE_RANGES,
  CHAIN,
  CRANK_SPINDLE_DEFAULT,
  DERAILLEUR,
  DERAILLEUR_SPEEDS,
  DROP_BAR_DISCIPLINE,
  ELECTRIC,
  FREEHUBS,
  GRAVEL,
  HANGER_STANDARD_DEFAULT,
  HANGER_STANDARDS,
  IGH,
  KIDS,
  LARGEST_COG_DEFAULT,
  MAX_COG_DEFAULT,
  MTB,
  MULTI_CHAINRING,
  NOT_MID_DRIVE,
  PEDAL_THREADS,
  ROAD,
  SHIFT_ACTUATION_DEFAULT,
  SHIFT_ACTUATIONS,
  SHIFTED,
  SPEED_COUNTS,
  SPINDLES,
  speedsDefault,
} from "./standards";

const brand = attr("brand", { kind: "enum", values: BRANDS, editable: true, fallback: "shimano" });

const shiftActuation = attr("actuation", {
  kind: "enum",
  values: SHIFT_ACTUATIONS,
  editable: true,
  ...SHIFT_ACTUATION_DEFAULT,
});

const drivetrainCheck = { check: ["check-drivetrain"] };

/** Gear counts internal gear hubs are sold in (the tree offers exactly these for `igh`). */
const IGH_SPEEDS = [3, 5, 7, 8, 11, 14] as const;

export const DRIVETRAIN_PARTS = [
  part({
    id: "bottom-bracket",
    system: "drivetrain",
    includeWhen: NOT_MID_DRIVE,
    optional: false,
    position: "none",
    meshId: null,
    hostPartId: "crankset",
    attributes: [
      attr("bb-shell", { kind: "enum", values: BB_SHELLS, editable: true, ...BB_SHELL_DEFAULT }),
      attr("spindle", { kind: "enum", values: BB_SPINDLES, editable: true, ...BB_SPINDLE_DEFAULT }),
    ],
    procedures: { check: ["check-bottom-bracket"] },
    checkupPriority: 45,
    wearItem: false,
  }),

  part({
    id: "crankset",
    system: "drivetrain",
    optional: false,
    position: "none",
    meshId: "crankset",
    attributes: [
      attr("spindle", { kind: "enum", values: SPINDLES, editable: true, ...CRANK_SPINDLE_DEFAULT }),
      attr("pedal-thread", {
        kind: "enum",
        values: PEDAL_THREADS,
        editable: true,
        fallback: "9-16",
      }),
      attr("chainrings", {
        kind: "enum",
        values: [1, 2, 3],
        editable: true,
        fallback: 1,
        when: copyOf("drivetrain.chainrings", [2, 3]),
      }),
      attr("crank-length", {
        kind: "number",
        unit: "mm",
        min: 100,
        max: 185,
        editable: true,
        fallback: 170,
        when: [whenThen(KIDS, 140), whenThen(ROAD, 172.5)],
      }),
    ],
    procedures: { check: ["check-bottom-bracket", "check-drivetrain"] },
    checkupPriority: 44,
    wearItem: false,
  }),

  part({
    id: "chainring",
    system: "drivetrain",
    optional: false,
    position: "none",
    meshId: null,
    hostPartId: "crankset",
    attributes: [
      attr("teeth", {
        kind: "number",
        unit: "count",
        min: 20,
        max: 60,
        editable: true,
        fallback: 38,
        when: [
          whenThen(MTB, 32),
          whenThen(is("drivetrain.chainrings", 2), 50),
          whenThen(is("drivetrain.chainrings", 3), 44),
          whenThen(GRAVEL, 40),
          whenThen(KIDS, 32),
        ],
      }),
    ],
    procedures: { ...drivetrainCheck, clean: ["clean-drivetrain"] },
    checkupPriority: 43,
    wearItem: true,
  }),

  part({
    id: "chain",
    system: "drivetrain",
    includeWhen: CHAIN,
    optional: false,
    position: "none",
    meshId: "chain",
    attributes: [
      attr("speeds", {
        kind: "enum",
        values: ["single", "6-7-8", 9, 10, 11, 12, 13],
        editable: true,
        fallback: "6-7-8",
        when: [
          whenThen(is("drivetrain.kind", "igh", "singlespeed"), "single"),
          ...copyOf("drivetrain.speeds", [9, 10, 11, 12, 13]),
        ],
      }),
      attr("e-rated", {
        kind: "boolean",
        editable: true,
        fallback: false,
        when: [whenThen(ELECTRIC, true)],
      }),
    ],
    procedures: {
      ...drivetrainCheck,
      replace: ["replace-chain"],
      clean: ["clean-chain", "clean-drivetrain"],
      measure: ["measure-chain-wear"],
    },
    checkupPriority: 40,
    wearItem: true,
  }),

  part({
    id: "belt",
    system: "drivetrain",
    includeWhen: BELT,
    optional: false,
    position: "none",
    meshId: "belt",
    attributes: [
      attr("belt-line", {
        kind: "enum",
        values: ["gates-cdx", "gates-cdn"],
        editable: true,
        fallback: "gates-cdn",
      }),
      attr("belt-teeth", {
        kind: "number",
        unit: "count",
        min: 90,
        max: 160,
        editable: true,
        fallback: null,
      }),
    ],
    procedures: { check: ["check-hub-gear"] },
    checkupPriority: 41,
    wearItem: true,
  }),

  part({
    id: "cassette",
    system: "drivetrain",
    includeWhen: allOf(DERAILLEUR, is("drivetrain.speeds", 8, 9, 10, 11, 12, 13)),
    optional: true,
    position: "rear",
    meshId: "cassette",
    attributes: [
      attr("speeds", {
        kind: "enum",
        values: DERAILLEUR_SPEEDS,
        editable: true,
        ...speedsDefault(DERAILLEUR_SPEEDS),
      }),
      attr("range", {
        kind: "enum",
        values: CASSETTE_RANGES,
        editable: true,
        ...CASSETTE_RANGE_DEFAULT,
      }),
      attr("largest-cog", {
        kind: "number",
        unit: "count",
        min: 21,
        max: 55,
        editable: true,
        ...LARGEST_COG_DEFAULT,
      }),
      attr("freehub", {
        kind: "enum",
        values: CASSETTE_FREEHUBS,
        editable: true,
        ...CASSETTE_FREEHUB_DEFAULT,
      }),
    ],
    procedures: {
      ...drivetrainCheck,
      replace: ["replace-cassette"],
      clean: ["clean-drivetrain"],
    },
    checkupPriority: 42,
    wearItem: true,
  }),

  part({
    id: "freewheel",
    system: "drivetrain",
    includeWhen: allOf(DERAILLEUR, is("drivetrain.speeds", 5, 6, 7)),
    optional: true,
    position: "rear",
    meshId: "freewheel",
    attributes: [
      attr("speeds", {
        kind: "enum",
        values: [5, 6, 7, 8],
        editable: true,
        ...speedsDefault([5, 6, 7]),
      }),
      attr("freehub", {
        kind: "enum",
        values: FREEHUBS,
        editable: true,
        fallback: "freewheel-thread",
      }),
    ],
    procedures: { ...drivetrainCheck, clean: ["clean-drivetrain"] },
    checkupPriority: 42,
    wearItem: true,
  }),

  part({
    id: "rear-derailleur",
    system: "drivetrain",
    includeWhen: DERAILLEUR,
    optional: false,
    position: "rear",
    meshId: "rear-derailleur",
    attributes: [
      attr("speeds", {
        kind: "enum",
        values: DERAILLEUR_SPEEDS,
        editable: true,
        ...speedsDefault(DERAILLEUR_SPEEDS),
      }),
      brand,
      shiftActuation,
      attr("max-cog", {
        kind: "number",
        unit: "count",
        min: 21,
        max: 55,
        editable: true,
        ...MAX_COG_DEFAULT,
      }),
      attr("clutch", {
        kind: "boolean",
        editable: true,
        fallback: false,
        when: [whenThen(MTB, true), whenThen(GRAVEL, true)],
      }),
      attr("hanger-standard", {
        kind: "enum",
        values: HANGER_STANDARDS,
        editable: true,
        ...HANGER_STANDARD_DEFAULT,
      }),
      attr("hanger-model", { kind: "text", editable: true, fallback: null }),
    ],
    procedures: {
      ...drivetrainCheck,
      clean: ["clean-drivetrain"],
      adjust: ["adjust-rear-derailleur", "adjust-electronic-indexing"],
    },
    checkupPriority: 46,
    wearItem: false,
  }),

  part({
    id: "front-derailleur",
    system: "drivetrain",
    includeWhen: MULTI_CHAINRING,
    optional: false,
    position: "front",
    meshId: "front-derailleur",
    attributes: [
      attr("fd-mount", {
        kind: "enum",
        values: ["braze-on", "clamp-28-6", "clamp-31-8", "clamp-34-9", "direct-mount"],
        editable: true,
        fallback: "clamp-31-8",
        when: [whenThen(DROP_BAR_DISCIPLINE, "braze-on")],
      }),
      attr("chainrings", {
        kind: "enum",
        values: [2, 3],
        editable: true,
        fallback: 2,
        when: copyOf("drivetrain.chainrings", [3]),
      }),
      shiftActuation,
    ],
    procedures: {
      ...drivetrainCheck,
      adjust: ["adjust-front-derailleur", "adjust-electronic-indexing"],
    },
    checkupPriority: 47,
    wearItem: false,
  }),

  part({
    id: "shifter-right",
    system: "drivetrain",
    includeWhen: SHIFTED,
    optional: false,
    position: "right",
    meshId: "shifter-right",
    attributes: [
      attr("shifter-type", {
        kind: "enum",
        values: SHIFTER_IDS,
        editable: false,
        fallback: "trigger",
        when: copyOf("drivetrain.shifter", SHIFTER_IDS),
      }),
      attr("speeds", {
        kind: "enum",
        values: SPEED_COUNTS,
        editable: true,
        ...speedsDefault(SPEED_COUNTS),
      }),
      brand,
      shiftActuation,
    ],
    procedures: {
      check: ["check-drivetrain", "check-hub-gear"],
      adjust: ["adjust-rear-derailleur", "adjust-electronic-indexing"],
    },
    checkupPriority: 48,
    wearItem: false,
  }),

  part({
    id: "shifter-left",
    system: "drivetrain",
    includeWhen: MULTI_CHAINRING,
    optional: false,
    position: "left",
    meshId: "shifter-left",
    attributes: [
      attr("positions", {
        kind: "enum",
        values: [2, 3],
        editable: true,
        fallback: 2,
        when: copyOf("drivetrain.chainrings", [3]),
      }),
      brand,
      shiftActuation,
    ],
    procedures: { ...drivetrainCheck, adjust: ["adjust-front-derailleur"] },
    checkupPriority: 49,
    wearItem: false,
  }),

  part({
    id: "internal-gear-hub",
    system: "drivetrain",
    includeWhen: IGH,
    optional: false,
    position: "rear",
    meshId: "internal-gear-hub",
    attributes: [
      attr("speeds", {
        kind: "enum",
        values: IGH_SPEEDS,
        editable: true,
        ...speedsDefault(IGH_SPEEDS),
      }),
      attr("hub-brand", {
        kind: "enum",
        values: ["shimano", "sturmey-archer", "rohloff", "enviolo"],
        editable: true,
        fallback: "shimano",
      }),
    ],
    procedures: { check: ["check-hub-gear"] },
    checkupPriority: 41,
    wearItem: false,
  }),

  part({
    id: "shift-cables",
    system: "drivetrain",
    includeWhen: allOf(SHIFTED, isNot("drivetrain.shifter", "electronic")),
    optional: false,
    position: "none",
    meshId: null,
    hostPartId: "shifter-right",
    attributes: [
      attr("routing", {
        kind: "enum",
        values: ["external", "internal"],
        editable: true,
        fallback: "external",
        when: [whenThen(DROP_BAR_DISCIPLINE, "internal"), whenThen(MTB, "internal")],
      }),
    ],
    procedures: { check: ["check-cables-hoses"], replace: ["replace-shift-cable"] },
    checkupPriority: 50,
    wearItem: true,
  }),
] as const;
