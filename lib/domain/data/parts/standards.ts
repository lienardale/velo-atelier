/**
 * Shared vocabulary of the part catalogue: the standards two parts must agree
 * on, and the defaults both sides of a compatibility rule are derived from.
 *
 * This file is what keeps the ≈70-build invariant true by construction
 * (`tests/unit/domain/compatibility.rules.test.ts`): a wheel's axle and its
 * frame's dropouts, a cassette's freehub and its wheel's body, a caliper's
 * rotor size and the rotor itself all read their default from the **same**
 * constant here, so a bike the decision tree produces never contradicts itself.
 * When two sides need different vocabularies (a cassette cannot sit on an
 * internal gear hub), the narrower list shares the tail of the wider rules.
 *
 * Enum values double as message-key segments (`parts.values.<attr>.<value>`),
 * so they contain no dot: `31.8` is a number attribute, `9/16"` is `9-16`.
 *
 * Zod-free: reachable from the barrel.
 */
import { BRAKE_MOUNTS, ETRTO_DIAMETERS } from "../conventions";

import { allOf, copyOf, is, not, whenThen, type Condition, type Default } from "./define";

// ── Conditions ───────────────────────────────────────────────────────────────

export const discipline = (...ids: string[]): Condition => is("discipline", ...ids);

export const ROAD = discipline("road");
export const GRAVEL = discipline("gravel");
export const MTB = discipline("mtb");
export const CITY = discipline("city-hybrid");
export const KIDS = discipline("kids");
export const DROP_BAR_DISCIPLINE = discipline("road", "gravel");

export const DISC = is("brakes.isDisc", true);
export const RIM = is("brakes.isDisc", false);
export const HYDRAULIC_DISC = is("brakes.type", "disc-hydraulic");
export const MECHANICAL_DISC = is("brakes.type", "disc-mechanical");
export const V_BRAKE = is("brakes.type", "v-brake");
export const DROP_BAR = is("cockpit.bar", "drop");

export const ELECTRIC = is("drive", "electric");
export const MID_DRIVE = is("eSystem.motorPosition", "mid-drive");
export const NOT_MID_DRIVE = not(MID_DRIVE);

export const DERAILLEUR = is("drivetrain.kind", "derailleur");
export const IGH = is("drivetrain.kind", "igh");
export const SINGLESPEED = is("drivetrain.kind", "singlespeed");
export const SHIFTED = is("drivetrain.kind", "derailleur", "igh");
export const MULTI_CHAINRING = is("drivetrain.chainrings", 2, 3);
export const ONE_BY = is("drivetrain.chainrings", 1);
export const CHAIN = is("drivetrain.transmission", "chain");
export const BELT = is("drivetrain.transmission", "belt");
export const ELECTRONIC_SHIFTING = is("drivetrain.shifter", "electronic");

export const TUBELESS = is("tires.system", "tubeless");
export const CLINCHER = is("tires.system", "clincher-tube");
export const FRONT_SUSPENSION = is("suspension.front", true);
export const REAR_SUSPENSION = is("suspension.rear", true);
export const DROPPER = is("seatpost.dropper", true);

// ── Speeds ───────────────────────────────────────────────────────────────────

/** Every gear count the tree can produce on a shifted bike. */
export const SPEED_COUNTS = [3, 5, 7, 8, 9, 10, 11, 12, 13, 14] as const;

/** Sprocket counts a derailleur, its shifter and a cassette are sold in. */
export const DERAILLEUR_SPEEDS = [7, 8, 9, 10, 11, 12, 13] as const;

/** Copy the spec's gear count; `null` (ask) when the value is not in `values`. */
export const speedsDefault = (values: readonly number[]): Default => ({
  fallback: null,
  when: copyOf("drivetrain.speeds", values),
});

// ── Axles ────────────────────────────────────────────────────────────────────

export const FRONT_AXLES = [
  "qr-9x100",
  "ta-12x100",
  "ta-15x100",
  "ta-15x110-boost",
  "nutted",
] as const;
export const REAR_AXLES = [
  "qr-10x130",
  "qr-10x135",
  "ta-12x142",
  "ta-12x148-boost",
  "nutted",
] as const;

/** Disc bikes run thru-axles (Boost on a mountain bike); rim-brake bikes quick releases. */
export const FRONT_AXLE_DEFAULT: Default = {
  fallback: "qr-9x100",
  when: [whenThen(allOf(DISC, MTB), "ta-15x110-boost"), whenThen(DISC, "ta-12x100")],
};

export const REAR_AXLE_DEFAULT: Default = {
  fallback: "qr-10x135",
  when: [
    whenThen(allOf(DISC, MTB), "ta-12x148-boost"),
    whenThen(DISC, "ta-12x142"),
    whenThen(ROAD, "qr-10x130"),
  ],
};

// ── Steering ─────────────────────────────────────────────────────────────────

/** Head tube standards, and the steerer a fork needs to fit one. */
export const HEAD_TUBES = ["threaded-1", "straight-1-1-8", "tapered-1-1-8-1-5"] as const;

export const HEAD_TUBE_DEFAULT: Default = {
  fallback: "tapered-1-1-8-1-5",
  when: [whenThen(KIDS, "threaded-1"), whenThen(CITY, "straight-1-1-8")],
};

export const STEERER_CLAMPS = ["quill-22-2", "1-1-8"] as const;

export const STEERER_CLAMP_DEFAULT: Default = {
  fallback: "1-1-8",
  when: [whenThen(KIDS, "quill-22-2")],
};

/** Handlebar clamp diameter in mm (a number: `31.8` cannot be a key segment). */
export const BAR_CLAMP_DEFAULT: Default = { fallback: 31.8, when: [whenThen(MTB, 35)] };

// ── Wheels and tyres ─────────────────────────────────────────────────────────

export const ETRTO_DIAMETER_DEFAULT: Default = {
  fallback: 622,
  when: copyOf("wheel.etrtoDiameter", ETRTO_DIAMETERS),
};

/** Tyre width in mm the default bike rolls on. */
export const TIRE_WIDTH_DEFAULT: Default = {
  fallback: 42,
  when: [whenThen(ROAD, 28), whenThen(MTB, 60), whenThen(KIDS, 50)],
};

/** Widest tyre the frame and the fork clear, in mm. */
export const MAX_TIRE_WIDTH_DEFAULT: Default = {
  fallback: 50,
  when: [whenThen(ROAD, 32), whenThen(MTB, 66), whenThen(KIDS, 60)],
};

/** Inner rim width, mm — the key of the ETRTO tyre-width table. */
export const RIM_WIDTHS = [17, 19, 21, 23, 25, 30] as const;

export const RIM_WIDTH_DEFAULT: Default = {
  fallback: 21,
  when: [whenThen(ROAD, 19), whenThen(GRAVEL, 23), whenThen(MTB, 30)],
};

// ── Freehub bodies ───────────────────────────────────────────────────────────

/** What a rear hub accepts: cassette bodies, a threaded freewheel, or an internal gear hub. */
export const FREEHUBS = [
  "hg",
  "hg-l",
  "xd",
  "xdr",
  "micro-spline",
  "freewheel-thread",
  "igh",
] as const;

/** The bodies a cassette can need. */
export const CASSETTE_FREEHUBS = ["hg", "hg-l", "xd", "xdr", "micro-spline"] as const;

/** Shared tail: the rules that decide the body of a cassette bike. */
const CASSETTE_BODY_RULES = [
  whenThen(is("drivetrain.speeds", 13), "xdr"),
  whenThen(allOf(DROP_BAR_DISCIPLINE, is("drivetrain.speeds", 11, 12)), "hg-l"),
  whenThen(is("drivetrain.speeds", 12), "micro-spline"),
];

export const WHEEL_FREEHUB_DEFAULT: Default = {
  fallback: "hg",
  when: [
    whenThen(IGH, "igh"),
    whenThen(SINGLESPEED, "freewheel-thread"),
    whenThen(is("drivetrain.speeds", 3, 5, 6, 7), "freewheel-thread"),
    ...CASSETTE_BODY_RULES,
  ],
};

export const CASSETTE_FREEHUB_DEFAULT: Default = { fallback: "hg", when: CASSETTE_BODY_RULES };

// ── Brakes ───────────────────────────────────────────────────────────────────

export const BRAKE_MOUNT_DEFAULT: Default = {
  fallback: "flat-mount",
  when: copyOf("brakes.mount", BRAKE_MOUNTS),
};

export const MAX_ROTOR_DEFAULT: Default = {
  fallback: 180,
  when: [whenThen(DROP_BAR_DISCIPLINE, 160), whenThen(MTB, 203)],
};

export const ROTOR_SIZES = [140, 160, 180, 203] as const;

/** Big front rotor on a full-suspension mountain bike, 180 on any other one, 160 elsewhere. */
export const FRONT_ROTOR_DEFAULT: Default = {
  fallback: 160,
  when: [whenThen(allOf(MTB, REAR_SUSPENSION), 203), whenThen(MTB, 180)],
};

export const REAR_ROTOR_DEFAULT: Default = { fallback: 160, when: [whenThen(MTB, 180)] };

export const ROTOR_INTERFACES = ["6-bolt", "centerlock"] as const;

export const ROTOR_INTERFACE_DEFAULT: Default = {
  fallback: "6-bolt",
  when: [whenThen(DROP_BAR_DISCIPLINE, "centerlock")],
};

export const BRAKE_ACTUATIONS = ["mechanical", "hydraulic"] as const;

export const BRAKE_ACTUATION_DEFAULT: Default = {
  fallback: "mechanical",
  when: [whenThen(HYDRAULIC_DISC, "hydraulic")],
};

/** Cable pull of a lever, and what a caliper or a mechanical disc expects. */
export const PULLS = ["short-road", "long-v-brake", "hydraulic"] as const;

// ── Drivetrain ───────────────────────────────────────────────────────────────

export const BRANDS = ["shimano", "sram", "campagnolo", "microshift"] as const;

export const SHIFT_ACTUATIONS = ["mechanical", "electronic"] as const;

export const SHIFT_ACTUATION_DEFAULT: Default = {
  fallback: "mechanical",
  when: [whenThen(ELECTRONIC_SHIFTING, "electronic")],
};

export const BB_SHELLS = ["bsa-68", "bsa-73", "bb86", "bb30", "pf30", "t47"] as const;

export const BB_SHELL_DEFAULT: Default = {
  fallback: "bsa-68",
  when: [whenThen(ROAD, "bb86"), whenThen(MTB, "bsa-73")],
};

/** Crank spindles; the last three are e-bike motor splines. */
export const SPINDLES = [
  "square-taper",
  "isis",
  "octalink",
  "hollowtech-24",
  "dub-28-99",
  "bb30-30",
  "bosch-spline",
  "shimano-steps-spline",
  "bafang-spline",
] as const;

/** A bottom bracket only ever holds a pedalled spindle. */
export const BB_SPINDLES = SPINDLES.slice(0, 6);

const PEDALLED_SPINDLE_RULES = [whenThen(discipline("city-hybrid", "kids"), "square-taper")];

export const CRANK_SPINDLE_DEFAULT: Default = {
  fallback: "hollowtech-24",
  when: [whenThen(MID_DRIVE, "bosch-spline"), ...PEDALLED_SPINDLE_RULES],
};

export const BB_SPINDLE_DEFAULT: Default = {
  fallback: "hollowtech-24",
  when: PEDALLED_SPINDLE_RULES,
};

export const PEDAL_THREADS = ["9-16", "1-2"] as const;

export const HANGER_STANDARDS = ["udh", "classic"] as const;

export const HANGER_STANDARD_DEFAULT: Default = {
  fallback: "classic",
  when: [whenThen(allOf(MTB, is("drivetrain.speeds", 12)), "udh")],
};

/** The cassette a default bike carries, as `range` and its biggest sprocket. */
const CASSETTE_CASES = [
  [allOf(MTB, is("drivetrain.speeds", 12, 13)), "10-51", 51],
  [MTB, "11-42", 42],
  [allOf(GRAVEL, ONE_BY), "11-42", 42],
  [allOf(ROAD, is("drivetrain.speeds", 12, 13)), "11-30", 30],
  [ROAD, "11-28", 28],
] as const;

export const CASSETTE_RANGES = [
  "11-25",
  "11-28",
  "11-30",
  "11-32",
  "11-34",
  "11-36",
  "11-42",
  "10-42",
  "10-45",
  "10-51",
  "10-52",
] as const;

export const CASSETTE_RANGE_DEFAULT: Default = {
  fallback: "11-32",
  when: CASSETTE_CASES.map(([condition, range]) => whenThen(condition, range)),
};

export const LARGEST_COG_DEFAULT: Default = {
  fallback: 32,
  when: CASSETTE_CASES.map(([condition, , cog]) => whenThen(condition, cog)),
};

/** Largest sprocket the rear derailleur is rated for: always ≥ the default cassette's. */
export const MAX_COG_DEFAULT: Default = {
  fallback: 36,
  when: [
    whenThen(allOf(MTB, is("drivetrain.speeds", 12, 13)), 52),
    whenThen(MTB, 46),
    whenThen(allOf(GRAVEL, ONE_BY), 42),
    whenThen(ROAD, 34),
  ],
};
