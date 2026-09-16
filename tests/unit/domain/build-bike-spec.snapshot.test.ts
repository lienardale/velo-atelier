/* eslint-disable security/detect-object-injection -- indices into BIKE_PRESETS, keyed by a PresetId */
/**
 * `answers → BikeSpec` (§2.2), pinned.
 *
 * The snapshots are the contract the 3D viewer, the part catalogue, the
 * compatibility rules and every guide's `appliesTo` read: a change to one of
 * them is a change to what the product says about somebody's bike, so it has to
 * show up in a diff. The assertions around them name the derivations that are
 * easy to get subtly wrong — a singlespeed has one gear and no shifter, `27-5`
 * is spelled `27.5` and measures 584, a mid-drive e-bike is the only bike with
 * a motor where its bottom bracket would be.
 */
import { describe, expect, it } from "vitest";

import {
  answerWithDefaults,
  BIKE_PRESETS,
  buildBikeSpec,
  getAtPath,
  isPresetId,
  PRESET_IDS,
  SPEC_SOURCES,
  type Answers,
} from "@/lib/domain";
import { BikeSpecSchema } from "@/lib/domain/schema/bike-spec";

const specOf = (answers: Answers) => buildBikeSpec(answerWithDefaults(answers));

/** Ten starting points: the empty one, both drives, all five disciplines, both odd drivetrains. */
const ROOT_COMBOS: Record<string, Answers> = {
  "nothing answered": {},
  electric: { drive: "electric" },
  road: { discipline: "road" },
  gravel: { discipline: "gravel" },
  mtb: { discipline: "mtb" },
  "city-hybrid": { discipline: "city-hybrid" },
  kids: { discipline: "kids" },
  singlespeed: { drivetrain: "singlespeed" },
  "hub gears with a belt": { drivetrain: "igh", transmission: "belt" },
  "electric mtb": { drive: "electric", discipline: "mtb" },
};

describe("buildBikeSpec", () => {
  for (const [name, answers] of Object.entries(ROOT_COMBOS)) {
    it(`builds the spec for: ${name}`, () => {
      expect(specOf(answers)).toMatchSnapshot();
    });
  }

  for (const preset of PRESET_IDS) {
    it(`builds the spec for the ${preset} preset`, () => {
      expect(specOf(BIKE_PRESETS[preset])).toMatchSnapshot();
    });
  }

  it("produces a spec that parses, for every preset", () => {
    for (const preset of PRESET_IDS) {
      const parsed = BikeSpecSchema.safeParse(specOf(BIKE_PRESETS[preset]));
      expect(parsed.success ? null : parsed.error.issues, preset).toBeNull();
    }
  });
});

describe("the derivations", () => {
  it("gives a singlespeed one gear, no shifter and a chain", () => {
    const spec = specOf({ drivetrain: "singlespeed" });
    expect(spec.drivetrain).toEqual({
      kind: "singlespeed",
      chainrings: 1,
      speeds: 1,
      transmission: "chain",
      shifter: null,
    });
  });

  it("counts chainrings from the drivetrain answer", () => {
    expect(specOf({ drivetrain: "derailleur-1x" }).drivetrain.chainrings).toBe(1);
    expect(specOf({ drivetrain: "derailleur-2x" }).drivetrain.chainrings).toBe(2);
    expect(specOf({ drivetrain: "derailleur-3x" }).drivetrain.chainrings).toBe(3);
    expect(specOf({ drivetrain: "igh" }).drivetrain.kind).toBe("igh");
  });

  it("keeps the belt a hub-gear-only answer", () => {
    expect(specOf({ drivetrain: "igh", transmission: "belt" }).drivetrain.transmission).toBe(
      "belt",
    );
    expect(specOf({ drivetrain: "derailleur-1x" }).drivetrain.transmission).toBe("chain");
  });

  it("turns a wheel-size id into a label and an ETRTO diameter", () => {
    expect(specOf({ discipline: "mtb", "wheel-size": "27-5" }).wheel).toEqual({
      label: "27.5",
      etrtoDiameter: 584,
    });
    expect(specOf({ discipline: "road", "wheel-size": "700c" }).wheel).toEqual({
      label: "700c",
      etrtoDiameter: 622,
    });
    expect(specOf({ discipline: "kids", "wheel-size": "16" }).wheel).toEqual({
      label: "16",
      etrtoDiameter: 305,
    });
  });

  it("marks disc brakes and leaves the mount null on rim brakes", () => {
    // The default bike is a city-hybrid, whose disc mount default is post-mount.
    expect(specOf({ "brake-type": "disc-mechanical" }).brakes).toMatchObject({
      isDisc: true,
      mount: "post-mount",
    });
    expect(specOf({ discipline: "road", "brake-type": "disc-hydraulic" }).brakes).toMatchObject({
      isDisc: true,
      mount: "flat-mount",
    });
    expect(specOf({ "brake-type": "cantilever" }).brakes).toEqual({
      type: "cantilever",
      isDisc: false,
      mount: null,
    });
  });

  it("reads suspension front/rear out of a single answer", () => {
    expect(specOf({ discipline: "mtb", suspension: "rigid" }).suspension).toEqual({
      front: false,
      rear: false,
    });
    expect(specOf({ discipline: "mtb", suspension: "front" }).suspension).toEqual({
      front: true,
      rear: false,
    });
    expect(specOf({ discipline: "mtb", suspension: "full" }).suspension).toEqual({
      front: true,
      rear: true,
    });
  });

  it("derives the frame style from the discipline", () => {
    expect(specOf({ discipline: "city-hybrid" }).frameStyle).toBe("step-through");
    expect(specOf({ discipline: "road" }).frameStyle).toBe("diamond");
  });

  it("gives an eSystem to electric bikes only", () => {
    expect(specOf({}).eSystem).toBeNull();
    expect(specOf({ drive: "electric" }).eSystem).toEqual({
      motorPosition: "mid-drive",
      batteryPosition: "integrated",
    });
    expect(specOf(BIKE_PRESETS["city-igh-8-hub-motor"]).eSystem).toEqual({
      motorPosition: "hub-rear",
      batteryPosition: "rack",
    });
  });

  it("marks the dropper post", () => {
    expect(specOf({ discipline: "mtb", suspension: "full" }).seatpost).toEqual({ dropper: true });
    expect(specOf({ discipline: "gravel" }).seatpost).toEqual({ dropper: false });
  });
});

describe("SPEC_SOURCES", () => {
  it("names a path that exists for every question", () => {
    const electric = specOf({ drive: "electric" });
    for (const [question, paths] of Object.entries(SPEC_SOURCES)) {
      for (const path of paths) {
        expect(getAtPath(electric, path), `${question} → ${path}`).toBeDefined();
      }
    }
  });
});

describe("presets", () => {
  it("are already complete: no missing answer, no answer this bike is never asked", () => {
    for (const preset of PRESET_IDS) {
      expect(answerWithDefaults(BIKE_PRESETS[preset]), preset).toEqual(BIKE_PRESETS[preset]);
    }
  });

  it("recognises its own ids", () => {
    expect(isPresetId("gravel-1x11")).toBe(true);
    expect(isPresetId("gravel-1x12")).toBe(false);
  });
});
