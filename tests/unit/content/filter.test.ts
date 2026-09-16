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
  const guides = diskGuides()
    .filter((guide) => guide.locale === "fr")
    .map(toSummary);
  const slugs = (list: typeof guides) => list.map((guide) => guide.slug).sort();

  it("returns everything without a filter", () => {
    expect(filterGuides(guides, {})).toHaveLength(guides.length);
    expect(filterGuides(guides, { spec: null })).toHaveLength(guides.length);
  });

  it("narrows by kind and by system", () => {
    expect(slugs(filterGuides(guides, { kind: "clean" }))).toEqual(["clean-chain"]);
    expect(slugs(filterGuides(guides, { system: "brakes" }))).toEqual([
      "check-brakes-disc",
      "replace-brake-pads-disc",
    ]);
    expect(filterGuides(guides, { kind: "clean", system: "suspension" })).toEqual([]);
  });

  it("narrows by bike through appliesTo", () => {
    expect(slugs(filterGuides(guides, { spec: specFor("road-rim-2x11") }))).toEqual([
      "clean-chain",
    ]);
    expect(slugs(filterGuides(guides, { spec: specFor("gravel-1x11") }))).toEqual(slugs(guides));
  });
});
