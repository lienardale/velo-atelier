/**
 * Tyres, inner tubes and sealant (§2.3).
 *
 * Tubes and sealant have no geometry of their own: they are clicked through
 * the tyre that holds them (`hostPartId`). A bike has tubes **or** sealant,
 * never both — `tires.system` decides.
 *
 * Widths are ETRTO millimetres (`etrto-width`), which is what both the 3D
 * solver (§3.1) and the rim-width table of `tire-rim-width` read.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import { ETRTO_DIAMETERS } from "../conventions";

import { attr, part, whenThen } from "./define";
import {
  CLINCHER,
  DROP_BAR_DISCIPLINE,
  ETRTO_DIAMETER_DEFAULT,
  MTB,
  KIDS,
  ROAD,
  TIRE_WIDTH_DEFAULT,
  TUBELESS,
} from "./standards";

const etrtoDiameter = attr("etrto-diameter", {
  kind: "enum",
  values: ETRTO_DIAMETERS,
  editable: true,
  ...ETRTO_DIAMETER_DEFAULT,
});

const tireAttributes = [
  etrtoDiameter,
  attr("etrto-width", {
    kind: "number",
    unit: "mm",
    min: 18,
    max: 130,
    editable: true,
    ...TIRE_WIDTH_DEFAULT,
  }),
  attr("tread", {
    kind: "enum",
    values: ["slick", "semi-slick", "knobby"],
    editable: true,
    fallback: "semi-slick",
    when: [whenThen(ROAD, "slick"), whenThen(MTB, "knobby"), whenThen(KIDS, "knobby")],
  }),
];

const tubeAttributes = [
  etrtoDiameter,
  attr("valve", {
    kind: "enum",
    values: ["presta", "schrader", "dunlop"],
    editable: true,
    fallback: "schrader",
    when: [whenThen(DROP_BAR_DISCIPLINE, "presta"), whenThen(MTB, "presta")],
  }),
  attr("valve-length", {
    kind: "number",
    unit: "mm",
    min: 30,
    max: 100,
    editable: true,
    fallback: null,
  }),
];

const tireProcedures = {
  check: ["check-wheels-tires"],
  replace: ["replace-tube-tire", "replace-tire-tubeless"],
  measure: ["measure-tire-pressure"],
};

const tubeProcedures = {
  check: ["check-wheels-tires"],
  replace: ["replace-tube-tire"],
};

export const TIRE_PARTS = [
  part({
    id: "tire-front",
    system: "tires",
    optional: false,
    position: "front",
    meshId: "tire-front",
    attributes: tireAttributes,
    procedures: tireProcedures,
    checkupPriority: 22,
    wearItem: true,
  }),

  part({
    id: "tire-rear",
    system: "tires",
    optional: false,
    position: "rear",
    meshId: "tire-rear",
    attributes: tireAttributes,
    procedures: tireProcedures,
    checkupPriority: 23,
    wearItem: true,
  }),

  part({
    id: "tube-front",
    system: "tires",
    includeWhen: CLINCHER,
    optional: false,
    position: "front",
    meshId: null,
    hostPartId: "tire-front",
    attributes: tubeAttributes,
    procedures: tubeProcedures,
    checkupPriority: 24,
    wearItem: true,
  }),

  part({
    id: "tube-rear",
    system: "tires",
    includeWhen: CLINCHER,
    optional: false,
    position: "rear",
    meshId: null,
    hostPartId: "tire-rear",
    attributes: tubeAttributes,
    procedures: tubeProcedures,
    checkupPriority: 25,
    wearItem: true,
  }),

  part({
    id: "sealant",
    system: "tires",
    includeWhen: TUBELESS,
    optional: false,
    position: "none",
    meshId: null,
    hostPartId: "tire-rear",
    attributes: [
      attr("sealant-kind", {
        kind: "enum",
        values: ["latex", "synthetic"],
        editable: true,
        fallback: "latex",
      }),
    ],
    procedures: { check: ["check-wheels-tires"], replace: ["replace-tire-tubeless"] },
    checkupPriority: 26,
    wearItem: true,
  }),
] as const;
