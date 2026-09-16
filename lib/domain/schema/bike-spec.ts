/**
 * `BikeSpec` — the derived description of one bike (§2.2).
 *
 * `answers` is the source of truth and what gets persisted; the spec is
 * computed from it by `engine/build-bike-spec.ts` and cached. Everything
 * downstream (which parts exist, which guides apply, which compatibility rules
 * fire, what the 3D viewer draws) reads the spec, never the answers.
 *
 * The vocabulary lives in `data/conventions.ts` so the values stay reachable
 * without zod; this file only turns it into parsers and types.
 */
import * as z from "zod";

import {
  BAR_SHAPES,
  BATTERY_POSITIONS,
  BRAKE_MOUNTS,
  BRAKE_TYPES,
  DISCIPLINES,
  DRIVE_KINDS,
  DRIVETRAIN_KINDS,
  ETRTO_DIAMETERS,
  MOTOR_POSITIONS,
  PEDAL_IDS,
  SHIFTER_IDS,
  TIRE_SYSTEMS,
  TRANSMISSIONS,
  WHEEL_LABELS,
} from "../data/conventions";
import type { Paths } from "../engine/paths";

/** The only schema version in the wild; `engine/migrate.ts` switches on it. */
export const BIKE_SPEC_VERSION = 1;

export const DriveKindSchema = z.enum(DRIVE_KINDS);
export const DisciplineSchema = z.enum(DISCIPLINES);
export const WheelLabelSchema = z.enum(WHEEL_LABELS);
export const EtrtoDiameterSchema = z.literal(ETRTO_DIAMETERS);
export const BrakeTypeSchema = z.enum(BRAKE_TYPES);
export const BrakeMountSchema = z.enum(BRAKE_MOUNTS);
export const DrivetrainKindSchema = z.enum(DRIVETRAIN_KINDS);
export const TransmissionSchema = z.enum(TRANSMISSIONS);
export const ShifterIdSchema = z.enum(SHIFTER_IDS);
export const BarShapeSchema = z.enum(BAR_SHAPES);
export const PedalIdSchema = z.enum(PEDAL_IDS);
export const TireSystemSchema = z.enum(TIRE_SYSTEMS);
export const MotorPositionSchema = z.enum(MOTOR_POSITIONS);
export const BatteryPositionSchema = z.enum(BATTERY_POSITIONS);
export const FrameStyleSchema = z.enum(["diamond", "step-through"]);

/**
 * No `.default()` anywhere in this file (§2): a defaulted field is optional on
 * the input type but required on the inferred output type, which would let a
 * data file omit it and still typecheck. Every field is explicit.
 */
export const BikeSpecSchema = z.strictObject({
  version: z.literal(BIKE_SPEC_VERSION),
  drive: DriveKindSchema,
  discipline: DisciplineSchema,
  wheel: z.strictObject({
    label: WheelLabelSchema,
    etrtoDiameter: EtrtoDiameterSchema,
  }),
  brakes: z.strictObject({
    type: BrakeTypeSchema,
    isDisc: z.boolean(),
    mount: BrakeMountSchema.nullable(),
  }),
  drivetrain: z.strictObject({
    kind: DrivetrainKindSchema,
    chainrings: z.literal([1, 2, 3]),
    speeds: z.int().min(1).max(14),
    transmission: TransmissionSchema,
    shifter: ShifterIdSchema.nullable(),
  }),
  cockpit: z.strictObject({ bar: BarShapeSchema }),
  pedals: PedalIdSchema,
  suspension: z.strictObject({ front: z.boolean(), rear: z.boolean() }),
  seatpost: z.strictObject({ dropper: z.boolean() }),
  tires: z.strictObject({ system: TireSystemSchema }),
  eSystem: z
    .strictObject({
      motorPosition: MotorPositionSchema,
      batteryPosition: BatteryPositionSchema,
    })
    .nullable(),
  frameStyle: FrameStyleSchema,
});

export type DriveKind = z.infer<typeof DriveKindSchema>;
export type Discipline = z.infer<typeof DisciplineSchema>;
export type WheelLabel = z.infer<typeof WheelLabelSchema>;
export type EtrtoDiameter = z.infer<typeof EtrtoDiameterSchema>;
export type BrakeType = z.infer<typeof BrakeTypeSchema>;
export type BrakeMount = z.infer<typeof BrakeMountSchema>;
export type DrivetrainKind = z.infer<typeof DrivetrainKindSchema>;
export type Transmission = z.infer<typeof TransmissionSchema>;
export type ShifterId = z.infer<typeof ShifterIdSchema>;
export type BarShape = z.infer<typeof BarShapeSchema>;
export type PedalId = z.infer<typeof PedalIdSchema>;
export type TireSystem = z.infer<typeof TireSystemSchema>;
export type MotorPosition = z.infer<typeof MotorPositionSchema>;
export type BatteryPosition = z.infer<typeof BatteryPositionSchema>;
export type FrameStyle = z.infer<typeof FrameStyleSchema>;

export type BikeSpec = z.infer<typeof BikeSpecSchema>;

/**
 * Every addressable path of a `BikeSpec` — what `SpecCondition.path` accepts.
 * A typo (`brakes.isDsic`) is a `tsc` error in the data file that writes it,
 * not a condition that quietly never matches.
 */
export type SpecPath = Paths<BikeSpec>;
