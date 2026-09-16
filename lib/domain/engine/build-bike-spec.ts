/**
 * `CompleteAnswers` → `BikeSpec` (§2.2).
 *
 * The answers are what the visitor said; the spec is what the rest of the app
 * reasons about. Every question is read by exactly one reader in
 * {@link READERS}, and that record `satisfies Record<QuestionId, …>`: adding a
 * seventeenth question to the tree fails `tsc` here until something consumes
 * it, which is the whole point.
 *
 * Questions that are not asked leave no answer — a singlespeed has no `speeds`,
 * a rim-brake bike no `brake-mount`, a muscular bike no `e-motor` — so every
 * reader states what the absence means.
 *
 * Zod-free: re-exported by the barrel.
 */
import type { QuestionId } from "../data/decision-tree";
import type {
  BarShape,
  BikeSpec,
  BrakeMount,
  BrakeType,
  Discipline,
  DriveKind,
  DrivetrainKind,
  EtrtoDiameter,
  FrameStyle,
  PedalId,
  ShifterId,
  SpecPath,
  TireSystem,
  Transmission,
  WheelLabel,
} from "../schema/bike-spec";
import type { CompleteAnswers } from "../schema/decision";

/** Wheel-size option id → what riders call it and the one number that is unambiguous. */
const WHEELS: Record<string, { label: WheelLabel; etrtoDiameter: EtrtoDiameter }> = {
  "700c": { label: "700c", etrtoDiameter: 622 },
  "650b": { label: "650b", etrtoDiameter: 584 },
  "29": { label: "29", etrtoDiameter: 622 },
  "27-5": { label: "27.5", etrtoDiameter: 584 },
  "26": { label: "26", etrtoDiameter: 559 },
  "24": { label: "24", etrtoDiameter: 507 },
  "20": { label: "20", etrtoDiameter: 406 },
  "16": { label: "16", etrtoDiameter: 305 },
};

/** Drivetrain option id → gear system and chainring count. */
const DRIVETRAINS: Record<string, { kind: DrivetrainKind; chainrings: 1 | 2 | 3 }> = {
  "derailleur-1x": { kind: "derailleur", chainrings: 1 },
  "derailleur-2x": { kind: "derailleur", chainrings: 2 },
  "derailleur-3x": { kind: "derailleur", chainrings: 3 },
  igh: { kind: "igh", chainrings: 1 },
  singlespeed: { kind: "singlespeed", chainrings: 1 },
};

/**
 * One reader per question. Each one owns the meaning of "not asked":
 * `speeds` absent means a singlespeed (one gear), `shifter` absent means no
 * shifter at all, `transmission` absent means a chain.
 *
 * The lookups index by an answer that `pruneAnswers` has already checked
 * against the tree, so an id that is not in a table cannot reach here.
 */
const READERS = {
  drive: (answers: CompleteAnswers) => answers.drive as DriveKind,

  discipline: (answers: CompleteAnswers) => answers.discipline as Discipline,

  "wheel-size": (answers: CompleteAnswers) => WHEELS[answers["wheel-size"] as string],

  "brake-type": (answers: CompleteAnswers) => {
    const type = answers["brake-type"] as BrakeType;
    return { type, isDisc: type.startsWith("disc-") };
  },

  /** Rim brakes have no caliper mount: the question is not asked, the field is null. */
  "brake-mount": (answers: CompleteAnswers) =>
    (answers["brake-mount"] ?? null) as BrakeMount | null,

  cockpit: (answers: CompleteAnswers) => answers.cockpit as BarShape,

  drivetrain: (answers: CompleteAnswers) => DRIVETRAINS[answers.drivetrain as string],

  /** Belts only exist behind a hub gear or a singlespeed; everything else runs a chain. */
  transmission: (answers: CompleteAnswers) => (answers.transmission ?? "chain") as Transmission,

  /** Not asked on a singlespeed, which has exactly one gear. */
  speeds: (answers: CompleteAnswers) => (answers.speeds === undefined ? 1 : Number(answers.speeds)),

  /** Not asked on a singlespeed, which has no shifter to inspect or replace. */
  shifter: (answers: CompleteAnswers) => (answers.shifter ?? null) as ShifterId | null,

  pedals: (answers: CompleteAnswers) => answers.pedals as PedalId,

  /** Not asked on road and gravel frames, which are rigid here by definition. */
  suspension: (answers: CompleteAnswers) => ({
    front: answers.suspension === "front" || answers.suspension === "full",
    rear: answers.suspension === "full",
  }),

  seatpost: (answers: CompleteAnswers) => ({ dropper: answers.seatpost === "dropper" }),

  "tire-system": (answers: CompleteAnswers) => ({
    system: answers["tire-system"] as TireSystem,
  }),

  "e-motor": (answers: CompleteAnswers) => answers["e-motor"],

  "e-battery": (answers: CompleteAnswers) => answers["e-battery"],
} satisfies Record<QuestionId, (answers: CompleteAnswers) => unknown>;

/**
 * City and hybrid bikes get the low top tube; everything else is a diamond
 * frame. Derived rather than asked — one fewer question for an answer the
 * visitor cannot get wrong by looking.
 */
function frameStyleFor(discipline: Discipline): FrameStyle {
  return discipline === "city-hybrid" ? "step-through" : "diamond";
}

/** Build the spec. The `CompleteAnswers` brand guarantees the tree has been walked. */
export function buildBikeSpec(answers: CompleteAnswers): BikeSpec {
  const discipline = READERS.discipline(answers);
  const motorPosition = READERS["e-motor"](answers);
  const batteryPosition = READERS["e-battery"](answers);

  return {
    version: 1,
    drive: READERS.drive(answers),
    discipline,
    wheel: READERS["wheel-size"](answers),
    brakes: { ...READERS["brake-type"](answers), mount: READERS["brake-mount"](answers) },
    drivetrain: {
      ...READERS.drivetrain(answers),
      speeds: READERS.speeds(answers),
      transmission: READERS.transmission(answers),
      shifter: READERS.shifter(answers),
    },
    cockpit: { bar: READERS.cockpit(answers) },
    pedals: READERS.pedals(answers),
    suspension: READERS.suspension(answers),
    seatpost: READERS.seatpost(answers),
    tires: READERS["tire-system"](answers),
    eSystem:
      motorPosition === undefined || batteryPosition === undefined
        ? null
        : {
            motorPosition: motorPosition as NonNullable<BikeSpec["eSystem"]>["motorPosition"],
            batteryPosition: batteryPosition as NonNullable<BikeSpec["eSystem"]>["batteryPosition"],
          },
    frameStyle: frameStyleFor(discipline),
  };
}

/**
 * Which questions feed which parts of the spec — the map a reader needs when
 * they wonder why changing the discipline moved the frame style.
 */
export const SPEC_SOURCES = {
  drive: ["drive"],
  discipline: ["discipline", "frameStyle"],
  "wheel-size": ["wheel.label", "wheel.etrtoDiameter"],
  "brake-type": ["brakes.type", "brakes.isDisc"],
  "brake-mount": ["brakes.mount"],
  cockpit: ["cockpit.bar"],
  drivetrain: ["drivetrain.kind", "drivetrain.chainrings"],
  transmission: ["drivetrain.transmission"],
  speeds: ["drivetrain.speeds"],
  shifter: ["drivetrain.shifter"],
  pedals: ["pedals"],
  suspension: ["suspension.front", "suspension.rear"],
  seatpost: ["seatpost.dropper"],
  "tire-system": ["tires.system"],
  "e-motor": ["eSystem.motorPosition"],
  "e-battery": ["eSystem.batteryPosition"],
} satisfies Record<QuestionId, readonly SpecPath[]>;
