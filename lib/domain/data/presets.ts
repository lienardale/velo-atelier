/**
 * Seven representative bikes, as answer sets (§2.5).
 *
 * They are the demo bike (`gravel-1x11`), the seeded demo account's garage
 * (Appendix B), the fixtures every engine test builds on, and the subjects of
 * the visual-regression sweep. Between them they cover both drives, all five
 * disciplines, rim and disc brakes, derailleur / hub / single-speed gearing,
 * rigid / front / full suspension and both tyre systems.
 *
 * Each preset is **already complete**: it answers exactly the questions the
 * tree asks for that bike, no more (`schema.test.ts` asserts
 * `answerWithDefaults(preset)` equals the preset, which catches both a missing
 * answer and an answer to a question this bike never gets asked).
 *
 * Zod-free (`import type` only): this module is re-exported by the barrel.
 */
import type { Answers } from "../schema/decision";

export const PRESET_IDS = [
  "road-rim-2x11",
  "road-disc-2x12",
  "gravel-1x11",
  "mtb-hardtail-1x12",
  "mtb-full-dropper-1x12",
  "city-igh-8-hub-motor",
  "emtb-mid-1x12",
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export const BIKE_PRESETS: Record<PresetId, Answers> = {
  /** The classic aluminium road bike: rim calipers, 2×11, inner tubes. */
  "road-rim-2x11": {
    drive: "muscular",
    discipline: "road",
    "wheel-size": "700c",
    "brake-type": "rim-caliper",
    cockpit: "drop",
    drivetrain: "derailleur-2x",
    speeds: "11",
    shifter: "sti-integrated",
    pedals: "road-clipless",
    "tire-system": "clincher-tube",
  },

  /** What a road bike bought today looks like: flat-mount hydraulic discs, 2×12. */
  "road-disc-2x12": {
    drive: "muscular",
    discipline: "road",
    "wheel-size": "700c",
    "brake-type": "disc-hydraulic",
    "brake-mount": "flat-mount",
    cockpit: "drop",
    drivetrain: "derailleur-2x",
    speeds: "12",
    shifter: "sti-integrated",
    pedals: "road-clipless",
    "tire-system": "tubeless",
  },

  /** The demo bike: 1×11 gravel, tubeless, rigid post. */
  "gravel-1x11": {
    drive: "muscular",
    discipline: "gravel",
    "wheel-size": "700c",
    "brake-type": "disc-hydraulic",
    "brake-mount": "flat-mount",
    cockpit: "drop",
    drivetrain: "derailleur-1x",
    speeds: "11",
    shifter: "sti-integrated",
    pedals: "spd",
    seatpost: "rigid",
    "tire-system": "tubeless",
  },

  /** 29" hardtail, 1×12, post-mount discs. */
  "mtb-hardtail-1x12": {
    drive: "muscular",
    discipline: "mtb",
    "wheel-size": "29",
    "brake-type": "disc-hydraulic",
    "brake-mount": "post-mount",
    cockpit: "riser",
    drivetrain: "derailleur-1x",
    speeds: "12",
    shifter: "trigger",
    pedals: "spd",
    suspension: "front",
    seatpost: "rigid",
    "tire-system": "tubeless",
  },

  /** Full suspension with a dropper — the most parts of any preset. */
  "mtb-full-dropper-1x12": {
    drive: "muscular",
    discipline: "mtb",
    "wheel-size": "29",
    "brake-type": "disc-hydraulic",
    "brake-mount": "post-mount",
    cockpit: "riser",
    drivetrain: "derailleur-1x",
    speeds: "12",
    shifter: "trigger",
    pedals: "flat",
    suspension: "full",
    seatpost: "dropper",
    "tire-system": "tubeless",
  },

  /** City e-bike: hub gears, V-brakes, rear hub motor, battery on the rack. */
  "city-igh-8-hub-motor": {
    drive: "electric",
    discipline: "city-hybrid",
    "wheel-size": "700c",
    "brake-type": "v-brake",
    cockpit: "swept",
    drivetrain: "igh",
    transmission: "chain",
    speeds: "8",
    shifter: "grip",
    pedals: "flat",
    suspension: "rigid",
    "tire-system": "clincher-tube",
    "e-motor": "hub-rear",
    "e-battery": "rack",
  },

  /** Mid-drive e-MTB: the build where the bottom bracket is replaced by a motor. */
  "emtb-mid-1x12": {
    drive: "electric",
    discipline: "mtb",
    "wheel-size": "29",
    "brake-type": "disc-hydraulic",
    "brake-mount": "post-mount",
    cockpit: "riser",
    drivetrain: "derailleur-1x",
    speeds: "12",
    shifter: "trigger",
    pedals: "flat",
    suspension: "full",
    seatpost: "dropper",
    "tire-system": "tubeless",
    "e-motor": "mid-drive",
    "e-battery": "integrated",
  },
};

/** The bike `/velo/demo` shows to anyone who has not described their own yet. */
export const DEMO_PRESET_ID: PresetId = "gravel-1x11";

/** Type guard for a preset id arriving from a URL or a seed file. */
export function isPresetId(value: string): value is PresetId {
  return Object.hasOwn(BIKE_PRESETS, value);
}
