/**
 * The `/guides` filter (§6.2): URL parsing that ignores what it does not know,
 * serialisation that keeps foreign parameters, the guest-bike spec read from
 * storage, and the filter itself.
 */
import { describe, expect, it } from "vitest";

import {
  demoSpec,
  filterGuides,
  parseGuideFilter,
  serializeGuideFilter,
  specFromStoredBike,
} from "@/lib/content/filter";
import { toSummary } from "@/lib/content/guides";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { specFor } from "@/tests/_fakes/domain/build";
import { diskGuides } from "@/tests/_helpers/guides";

describe("parseGuideFilter / serializeGuideFilter", () => {
  it("keeps known values and drops the rest", () => {
    expect(parseGuideFilter(new URLSearchParams("kind=clean&system=brakes&bike=demo"))).toEqual({
      kind: "clean",
      system: "brakes",
      bike: "demo",
    });
    expect(parseGuideFilter(new URLSearchParams("kind=bogus&system=__proto__&bike=db"))).toEqual({
      kind: null,
      system: null,
      bike: null,
    });
  });

  it("writes only non-null values and keeps foreign parameters", () => {
    expect(
      serializeGuideFilter({ kind: "check", system: null, bike: null }, "?utm=x&system=frame"),
    ).toBe("?utm=x&kind=check");
    expect(serializeGuideFilter({ kind: null, system: null, bike: null })).toBe("");
  });
});

describe("specFromStoredBike", () => {
  it("rebuilds the spec from the stored answers", () => {
    const raw = JSON.stringify({ version: 1, answers: BIKE_PRESETS["road-rim-2x11"] });
    expect(specFromStoredBike(raw)).toEqual(specFor("road-rim-2x11"));
  });

  it("drops malformed answers and falls back to defaults for the rest", () => {
    const raw = JSON.stringify({
      answers: { discipline: "road", "Bad Key": "x", speeds: 11, drive: "a".repeat(40) },
    });
    expect(specFromStoredBike(raw)?.discipline).toBe("road");
  });

  it("returns null for anything that is not a stored bike", () => {
    for (const raw of [
      null,
      "not json",
      "null",
      "42",
      JSON.stringify({ answers: [] }),
      JSON.stringify({}),
    ]) {
      expect(specFromStoredBike(raw), String(raw)).toBeNull();
    }
  });

  it("builds the demo bike from the gravel preset", () => {
    expect(demoSpec()).toEqual(specFor("gravel-1x11"));
  });
});

describe("filterGuides", () => {
  // A fixed sample of the real corpus (the three W1 guides), so the expectations
  // below do not change every time a guide is added.
  const SAMPLE = new Set(["check-brakes-disc", "clean-chain", "replace-brake-pads-disc"]);
  const guides = diskGuides()
    .filter((guide) => guide.locale === "fr" && SAMPLE.has(guide.slug))
    .map(toSummary);
  const slugs = (list: typeof guides) => list.map((guide) => guide.slug).sort();

  it("returns everything without a filter", () => {
    expect(filterGuides(guides, {})).toHaveLength(guides.length);
    expect(filterGuides(guides, { spec: null })).toHaveLength(guides.length);
  });

  // The corpus grows wave by wave (W1: 3 guides, W2: 47), so these assertions are
  // written against what is on disk, anchored on guides that exist since W1.
  it("narrows by kind and by system", () => {
    const clean = filterGuides(guides, { kind: "clean" });
    expect(slugs(clean)).toContain("clean-chain");
    expect(clean.every((guide) => guide.kind === "clean")).toBe(true);
    expect(clean).toHaveLength(guides.filter((guide) => guide.kind === "clean").length);

    const brakes = filterGuides(guides, { system: "brakes" });
    expect(slugs(brakes)).toEqual(
      expect.arrayContaining(["check-brakes-disc", "replace-brake-pads-disc"]),
    );
    expect(slugs(brakes)).not.toContain("clean-chain");
    expect(brakes.every((guide) => guide.systems.includes("brakes"))).toBe(true);

    expect(filterGuides(guides, { kind: "clean", system: "suspension" })).toEqual([]);
  });

  it("narrows by bike through appliesTo", () => {
    const road = slugs(filterGuides(guides, { spec: specFor("road-rim-2x11") }));
    expect(road).toContain("clean-chain");
    expect(road).not.toContain("check-brakes-disc");
    expect(road).not.toContain("replace-brake-pads-disc");

    const gravel = slugs(filterGuides(guides, { spec: specFor("gravel-1x11") }));
    expect(gravel).toEqual(
      expect.arrayContaining(["check-brakes-disc", "clean-chain", "replace-brake-pads-disc"]),
    );
    // Guides without a condition apply to every bike.
    const unconditional = slugs(guides.filter((guide) => guide.appliesTo === undefined));
    expect(road).toEqual(expect.arrayContaining(unconditional));
    expect(gravel).toEqual(expect.arrayContaining(unconditional));
  });
});
