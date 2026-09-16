/**
 * Stored builds across versions (§2.5): `parseStoredBuild` reads a version-1
 * fixture — a literal, as a row written by this release would look in
 * Postgres or in `va:bike:local` — and refuses unknown versions and corrupted
 * rows with errors the callers can tell apart.
 */
import { describe, expect, it } from "vitest";

import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import { answerWithDefaults } from "@/lib/domain/engine/decision";
import {
  CURRENT_BUILD_VERSION,
  InvalidStoredBuildError,
  parseStoredBuild,
  storedBuildVersion,
  UnsupportedBuildVersionError,
} from "@/lib/domain/engine/migrate";
import { buildForSpec } from "@/lib/domain/engine/parts-for-spec";

/** A version-1 city e-bike exactly as it would be serialised — not derived, so a format change shows. */
const STORED_V1 = `{
  "spec": {
    "version": 1,
    "drive": "electric",
    "discipline": "city-hybrid",
    "wheel": { "label": "700c", "etrtoDiameter": 622 },
    "brakes": { "type": "v-brake", "isDisc": false, "mount": null },
    "drivetrain": { "kind": "igh", "chainrings": 1, "speeds": 8, "transmission": "chain", "shifter": "grip" },
    "cockpit": { "bar": "swept" },
    "pedals": "flat",
    "suspension": { "front": false, "rear": false },
    "seatpost": { "dropper": false },
    "tires": { "system": "clincher-tube" },
    "eSystem": { "motorPosition": "hub-rear", "batteryPosition": "rack" },
    "frameStyle": "step-through"
  },
  "parts": [
    { "partId": "frame", "attributes": { "material": "aluminium", "rear-axle": "qr-10x135", "bb-shell": "bsa-68", "head-tube": "straight-1-1-8", "max-tire-width": 50, "seatpost-diameter": 27.2 } },
    { "partId": "fork", "attributes": { "axle": "qr-9x100", "steerer": "straight-1-1-8", "max-tire-width": 50 } },
    { "partId": "headset", "attributes": { "head-tube": "straight-1-1-8" } },
    { "partId": "wheel-front", "attributes": { "axle": "qr-9x100", "etrto-diameter": 622, "rim-width": 21, "tubeless-ready": false } },
    { "partId": "wheel-rear", "attributes": { "axle": "qr-10x135", "etrto-diameter": 622, "rim-width": 21, "tubeless-ready": false, "freehub": "igh" } },
    { "partId": "tire-front", "attributes": { "etrto-diameter": 622, "etrto-width": 42, "tread": "semi-slick" } },
    { "partId": "tire-rear", "attributes": { "etrto-diameter": 622, "etrto-width": 42, "tread": "semi-slick" } },
    { "partId": "tube-front", "attributes": { "etrto-diameter": 622, "valve": "schrader" } },
    { "partId": "tube-rear", "attributes": { "etrto-diameter": 622, "valve": "schrader" } },
    { "partId": "bottom-bracket", "attributes": { "bb-shell": "bsa-68", "spindle": "square-taper" } },
    { "partId": "crankset", "attributes": { "spindle": "square-taper", "pedal-thread": "9-16", "chainrings": 1, "crank-length": 170 } },
    { "partId": "chainring", "attributes": { "teeth": 38 } },
    { "partId": "chain", "attributes": { "speeds": "single", "e-rated": true } },
    { "partId": "shifter-right", "attributes": { "shifter-type": "grip", "speeds": 8, "brand": "shimano", "actuation": "mechanical" } },
    { "partId": "internal-gear-hub", "attributes": { "speeds": 8, "hub-brand": "shimano" } },
    { "partId": "shift-cables", "attributes": { "routing": "external" } },
    { "partId": "brake-lever-front", "attributes": { "actuation": "mechanical", "pull": "long-v-brake", "integrated": false } },
    { "partId": "brake-caliper-front", "attributes": { "brake-type": "v-brake", "actuation": "mechanical", "pad-type": "rim-molded" } },
    { "partId": "brake-pads-front", "attributes": {} },
    { "partId": "brake-line-front", "attributes": { "kind": "cable" } },
    { "partId": "brake-lever-rear", "attributes": { "actuation": "mechanical", "pull": "long-v-brake", "integrated": false } },
    { "partId": "brake-caliper-rear", "attributes": { "brake-type": "v-brake", "actuation": "mechanical", "pad-type": "rim-molded" } },
    { "partId": "brake-pads-rear", "attributes": { "pad-model": "Kool-Stop Salmon" } },
    { "partId": "brake-line-rear", "attributes": { "kind": "cable" } },
    { "partId": "handlebar", "attributes": { "bar-shape": "swept", "bar-clamp": 31.8, "bar-width": 620 } },
    { "partId": "stem", "attributes": { "bar-clamp": 31.8, "steerer-clamp": "1-1-8", "stem-length": 80 } },
    { "partId": "grips-or-tape", "attributes": { "cover": "grips" } },
    { "partId": "saddle", "attributes": { "saddle-width": 160, "rail": "round-7mm" } },
    { "partId": "seatpost", "attributes": { "seatpost-diameter": 27.2, "dropper": false } },
    { "partId": "seat-clamp", "attributes": { "quick-release": true } },
    { "partId": "pedal-left", "attributes": { "pedal-type": "flat", "pedal-thread": "9-16", "cleat": "none" } },
    { "partId": "pedal-right", "attributes": { "pedal-type": "flat", "pedal-thread": "9-16", "cleat": "none" } },
    { "partId": "e-motor", "attributes": { "motor-brand": "bafang", "torque": 45 } },
    { "partId": "e-battery", "attributes": { "battery-position": "rack", "capacity": 500, "voltage": 36 } },
    { "partId": "mudguards", "attributes": {} },
    { "partId": "rack", "attributes": { "rack-mount": "frame-eyelets" } },
    { "partId": "lights", "attributes": { "light-power": "e-bike" } }
  ]
}`;

describe("parseStoredBuild", () => {
  it("reads a version-1 build as it was stored", () => {
    const build = parseStoredBuild(JSON.parse(STORED_V1));
    expect(CURRENT_BUILD_VERSION).toBe(1);
    expect(build.spec).toEqual(
      buildBikeSpec(answerWithDefaults(BIKE_PRESETS["city-igh-8-hub-motor"])),
    );
    expect(build.parts).toHaveLength(37);
    // The owner's edits survive: a measured seatpost, a named pad, no kickstand.
    expect(build.parts.find((part) => part.partId === "seatpost")!.attributes).toEqual({
      "seatpost-diameter": 27.2,
      dropper: false,
    });
    expect(build.parts.some((part) => part.partId === "kickstand")).toBe(false);
  });

  it("reads back any build this release writes", () => {
    const build = buildForSpec(buildBikeSpec(answerWithDefaults(BIKE_PRESETS["emtb-mid-1x12"])));
    expect(parseStoredBuild(JSON.parse(JSON.stringify(build)))).toEqual(build);
  });

  it("refuses a version it does not know", () => {
    const future = JSON.parse(STORED_V1) as { spec: { version: number } };
    future.spec.version = 2;
    expect(() => parseStoredBuild(future)).toThrow(UnsupportedBuildVersionError);
    expect(() => parseStoredBuild(future)).toThrow("Unsupported stored build version: 2");
    expect(() => parseStoredBuild("[]")).toThrow("Unsupported stored build version: undefined");
    expect(() => parseStoredBuild({ spec: [] })).toThrow(UnsupportedBuildVersionError);
  });

  it("refuses a corrupted version-1 row, listing what is wrong", () => {
    const corrupted = JSON.parse(STORED_V1) as { parts: { partId: string }[] };
    corrupted.parts[0].partId = "jetpack";
    try {
      parseStoredBuild(corrupted);
      expect.unreachable("a corrupted build must not parse");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStoredBuildError);
      const invalid = error as InvalidStoredBuildError;
      expect(invalid.name).toBe("InvalidStoredBuildError");
      expect(invalid.issues).toEqual([
        { path: "parts.0.partId", code: "unknown-part" },
        { path: "parts.frame", code: "missing-part" },
      ]);
      expect(invalid.message).toBe(
        "Invalid stored build: parts.0.partId (unknown-part), parts.frame (missing-part)",
      );
    }
  });

  it("finds the version where it is stored", () => {
    expect(storedBuildVersion(JSON.parse(STORED_V1))).toBe(1);
    expect(storedBuildVersion(null)).toBeUndefined();
    expect(storedBuildVersion({ spec: "v1" })).toBeUndefined();
    expect(new UnsupportedBuildVersionError(3).version).toBe(3);
  });
});
