/**
 * The buying guide (§2.5), and the data it reads: tools, retailers, the
 * domain's own message lookup.
 *
 *   - FR and EN snapshots of three guides that exercise every constraint form;
 *   - the candidate template passes `checkCompatibility` for every part of every
 *     preset, and moves inside the constraints when the bike has changed;
 *   - questions: missing measurements first, tagged `askedBecause`; attributes
 *     pinned to a single value are not asked;
 *   - the §5.8 query: `cassette 11 vitesses 11-34 hg` / `cassette 11 speed 11-34 hg`.
 */
/* eslint-disable security/detect-object-injection -- offsets into our own fixtures and catalogue */
import { describe, expect, it } from "vitest";

import { PARTS, partDefinition, PART_IDS, type PartId } from "@/lib/domain/data/parts";
import { BIKE_PRESETS, PRESET_IDS } from "@/lib/domain/data/presets";
import { RETAILER_ORDER, RETAILERS } from "@/lib/domain/data/retailers";
import { RULES } from "@/lib/domain/data/rules";
import { isToolId, TOOL_IDS, TOOLS } from "@/lib/domain/data/tools";
import { buildBikeSpec } from "@/lib/domain/engine/build-bike-spec";
import {
  buildBuyingGuide,
  buildSearchQuery,
  buyingQuestion,
  constraintsFor,
  mergeBounds,
  pickValue,
  ruleBounds,
  satisfies,
  type BuyingConstraint,
} from "@/lib/domain/engine/buying-guide";
import { checkCompatibility } from "@/lib/domain/engine/compatibility";
import { answerWithDefaults } from "@/lib/domain/engine/decision";
import { buildForSpec, defaultPart, findPart } from "@/lib/domain/engine/parts-for-spec";
import {
  attributeLabel,
  domainMessage,
  lookupMessage,
  partLabel,
  valueLabel,
} from "@/lib/domain/i18n";
import type { Answers } from "@/lib/domain/schema/decision";
import type { AttributeDef, AttributeValue, BikeBuild } from "@/lib/domain/schema/part";
import { RetailerDefSchema, RETAILER_IDS } from "@/lib/domain/schema/retailer";
import { ToolDefSchema } from "@/lib/domain/schema/procedure";
import { routing } from "@/lib/i18n/routing";

const buildOf = (answers: Answers): BikeBuild =>
  buildForSpec(buildBikeSpec(answerWithDefaults(answers)));

function withValues(
  build: BikeBuild,
  values: Record<string, AttributeValue | undefined>,
): BikeBuild {
  const copy = structuredClone(build);
  for (const [ref, value] of Object.entries(values)) {
    const [partId, key] = ref.split(".");
    const part = findPart(copy, partId)!;
    if (value === undefined) delete part.attributes[key];
    else part.attributes[key] = value;
  }
  return copy;
}

const GRAVEL = buildOf(BIKE_PRESETS["gravel-1x11"]);
const ROAD_RIM = buildOf(BIKE_PRESETS["road-rim-2x11"]);
const ROAD_DISC = buildOf(BIKE_PRESETS["road-disc-2x12"]);

// ── Snapshots ────────────────────────────────────────────────────────────────

describe("buildBuyingGuide snapshots", () => {
  for (const locale of routing.locales) {
    it(`a cassette for the demo gravel bike (${locale})`, () => {
      expect(buildBuyingGuide(GRAVEL, "cassette", locale)).toMatchSnapshot();
    });

    it(`a seatpost for a bike nobody has measured (${locale})`, () => {
      expect(buildBuyingGuide(ROAD_RIM, "seatpost", locale)).toMatchSnapshot();
    });

    it(`a front tyre, a rear rotor and a frame on a road disc bike (${locale})`, () => {
      expect(buildBuyingGuide(ROAD_DISC, "tire-front", locale).constraints).toMatchSnapshot();
      expect(buildBuyingGuide(ROAD_DISC, "rotor-rear", locale).constraints).toMatchSnapshot();
      const bigRotor = withValues(ROAD_DISC, { "rotor-rear.diameter": 180 });
      expect(buildBuyingGuide(bigRotor, "frame", locale).constraints).toMatchSnapshot();
    });
  }
});

// ── The template ─────────────────────────────────────────────────────────────

describe("the candidate template", () => {
  it("passes checkCompatibility for every part of every preset", () => {
    const unmeetable: string[] = [];
    for (const preset of PRESET_IDS) {
      const build = buildOf(BIKE_PRESETS[preset]);
      for (const partId of PART_IDS) {
        const guide = buildBuyingGuide(build, partId, "fr");
        // A cassette cannot be bought for a hub-gear bike: when the constraints
        // leave no value at all, there is nothing to template.
        const byAttribute = Map.groupBy(guide.constraints, (entry) => entry.attribute);
        const impossible = [...byAttribute.values()].some((entries) => {
          const merged = mergeBounds(entries);
          return merged.allowed !== null && merged.allowed.length === 0;
        });
        if (impossible) {
          unmeetable.push(`${preset}/${partId}`);
          continue;
        }
        const report = checkCompatibility(build, guide.candidateTemplate);
        expect(
          report.issues.filter((issue) => issue.severity === "error"),
          `${preset} / ${partId}`,
        ).toEqual([]);
      }
    }
    // Only the parts a bike of that kind cannot take at all.
    expect(unmeetable).toEqual([
      "road-rim-2x11/freewheel",
      "road-disc-2x12/freewheel",
      "gravel-1x11/freewheel",
      "mtb-hardtail-1x12/freewheel",
      "mtb-full-dropper-1x12/freewheel",
      "city-igh-8-hub-motor/cassette",
      "city-igh-8-hub-motor/freewheel",
      "emtb-mid-1x12/freewheel",
    ]);
  });

  it("moves into the constraints when the bike has changed", () => {
    const xdWheel = withValues(GRAVEL, { "wheel-rear.freehub": "xd" });
    const current = findPart(xdWheel, "cassette")!;
    expect(checkCompatibility(xdWheel, current).ok).toBe(false);

    const guide = buildBuyingGuide(xdWheel, "cassette", "fr");
    expect(guide.candidateTemplate.attributes).toMatchObject({ freehub: "xd", speeds: 11 });
    expect(checkCompatibility(xdWheel, guide.candidateTemplate).ok).toBe(true);
    // The speed count is pinned by the derailleur, the body by the wheel: neither is asked.
    const asked = guide.questions.map((question) => question.attribute);
    expect(asked).not.toContain("freehub");
    expect(asked).not.toContain("speeds");
    expect(asked).toContain("range");
  });

  it("raises a number to a minimum the rest of the bike needs", () => {
    const bigRotor = withValues(ROAD_DISC, { "rotor-rear.diameter": 180 });
    const guide = buildBuyingGuide(bigRotor, "frame", "en");
    expect(guide.candidateTemplate.attributes["max-rotor"]).toBe(180);
    expect(checkCompatibility(bigRotor, guide.candidateTemplate).ok).toBe(true);
  });

  it("starts from the defaults for a part the bike does not have yet", () => {
    const guide = buildBuyingGuide(GRAVEL, "rack", "fr");
    expect(guide.candidateTemplate).toEqual(defaultPart(partDefinition("rack")!, GRAVEL.spec));
    expect(guide.constraints).toEqual([]);
  });
});

// ── Questions ────────────────────────────────────────────────────────────────

describe("the questions", () => {
  it("ask for the measurements the rules could not read first", () => {
    const guide = buildBuyingGuide(ROAD_RIM, "seatpost", "fr");
    expect(guide.questions[0]).toMatchObject({
      partId: "frame",
      attribute: "seatpost-diameter",
      kind: "number",
      unit: "mm",
      min: 22,
      max: 35,
      options: null,
      askedBecause: "seatpost-frame-diameter",
    });
    expect(guide.questions.slice(1).every((question) => question.askedBecause === null)).toBe(true);
    expect(guide.questions.map((question) => question.attribute)).toContain("seatpost-diameter");
  });

  it("offer only the enum values the constraints still allow", () => {
    const bigRotor = withValues(ROAD_DISC, {
      "frame.max-rotor": 180,
      "brake-caliper-rear.rotor-size": undefined,
      "brake-caliper-rear.mount": "post-mount",
      "frame.brake-mount": "post-mount",
    });
    const guide = buildBuyingGuide(bigRotor, "rotor-rear", "en");
    const diameter = guide.questions.find((question) => question.attribute === "diameter")!;
    expect(diameter.options!.map((option) => option.value)).toEqual([160, 180]);
    expect(diameter.max).toBe(180);
    expect(guide.questions[0]).toMatchObject({
      partId: "brake-caliper-rear",
      attribute: "rotor-size",
      askedBecause: "caliper-rotor-size-rear",
    });
  });

  it("describe an attribute without help text or bounds", () => {
    const bare: AttributeDef = {
      key: "cover",
      kind: "enum",
      values: ["bar-tape", "grips"],
      editable: true,
      default: { fallback: "grips", when: [] },
      labelKey: "parts.attr.cover.label",
    };
    expect(
      buyingQuestion("en", "grips-or-tape", bare, { allowed: null, min: null, max: null }, null),
    ).toEqual({
      partId: "grips-or-tape",
      attribute: "cover",
      kind: "enum",
      label: "Cover",
      help: null,
      unit: null,
      options: [
        { value: "bar-tape", label: "Bar tape" },
        { value: "grips", label: "Grips" },
      ],
      min: null,
      max: null,
      askedBecause: null,
    });
  });
});

// ── Constraints, bounds and picks ────────────────────────────────────────────

const rule = (id: string) => RULES.find((entry) => entry.id === id)!;

describe("constraints", () => {
  it("read both directions of an allowed table", () => {
    const [onCassette] = constraintsFor(GRAVEL, "cassette", "fr").filter(
      (entry) => entry.ruleId === "cassette-freehub",
    );
    expect(onCassette).toMatchObject({ attribute: "freehub", allowed: ["hg", "hg-l"] });
    const [onWheel] = constraintsFor(GRAVEL, "wheel-rear", "en").filter(
      (entry) => entry.ruleId === "cassette-freehub",
    );
    expect(onWheel).toMatchObject({
      attribute: "freehub",
      allowed: ["hg-l"],
      because: { partId: "cassette", attribute: "freehub", value: "hg-l" },
      label: "Freehub body: Shimano HG-L (12-speed road)",
    });
  });

  it("read both directions of a range table, and skip a value it does not list", () => {
    const onTire = ruleBounds(rule("tire-rim-width-front"), ROAD_RIM, "tire-front");
    expect(onTire).toMatchObject({ key: "etrto-width", bounds: { min: 28, max: 40 } });
    const onWheel = ruleBounds(rule("tire-rim-width-front"), ROAD_RIM, "wheel-front");
    expect(onWheel).toMatchObject({ key: "rim-width", bounds: { allowed: [17, 19] } });
    const oddRim = withValues(ROAD_RIM, { "wheel-front.rim-width": 99 });
    expect(ruleBounds(rule("tire-rim-width-front"), oddRim, "tire-front")).toBeNull();
    const igh = withValues(GRAVEL, { "wheel-rear.freehub": "igh" });
    expect(ruleBounds(rule("cassette-speeds-freehub"), igh, "cassette")).toBeNull();
  });

  it("say nothing when the rule does not apply, the other side is unknown or both sides are the part", () => {
    expect(ruleBounds(rule("rotor-frame-max"), ROAD_RIM, "frame")).toBeNull();
    expect(ruleBounds(rule("seatpost-frame-diameter"), ROAD_RIM, "seatpost")).toBeNull();
    expect(ruleBounds(rule("chain-cassette-speeds"), ROAD_RIM, "frame")).toBeNull();
    expect(
      ruleBounds(
        {
          ...rule("stem-bar-clamp"),
          check: { kind: "equal", a: "stem.bar-clamp", b: "stem.bar-clamp" },
        },
        ROAD_RIM,
        "stem",
      ),
    ).toBeNull();
  });

  it("turn a flag into a single allowed value, and apply a margin", () => {
    expect(ruleBounds(rule("tubeless-rim-tire-front"), ROAD_DISC, "wheel-front")).toEqual({
      key: "tubeless-ready",
      bounds: { allowed: [true], min: null, max: null },
      because: null,
    });
    const withMargin = {
      ...rule("tire-frame-clearance"),
      check: { kind: "lte", a: "tire-rear.etrto-width", b: "frame.max-tire-width", margin: 2 },
    } as const;
    expect(ruleBounds(withMargin, ROAD_RIM, "tire-rear")!.bounds.max).toBe(34);
    expect(ruleBounds(withMargin, ROAD_RIM, "frame")!.bounds.min).toBe(26);
  });

  it("put words on every bound", () => {
    const labels = (locale: "fr" | "en") =>
      constraintsFor(ROAD_DISC, "tire-front", locale).map((entry) => entry.label);
    expect(labels("fr")).toContain("Largeur du pneu : entre 28 mm et 40 mm");
    expect(labels("en")).toContain("Tyre width: 32 mm at most");
    const frame = constraintsFor(
      withValues(ROAD_DISC, { "rotor-rear.diameter": 180 }),
      "frame",
      "fr",
    );
    expect(frame.map((entry) => entry.label)).toContain("Disque maximal : 180 mm au minimum");
  });

  const bounds = (overrides: Partial<BuyingConstraint>): BuyingConstraint => ({
    ruleId: "tire-frame-clearance",
    severity: "error",
    attribute: "etrto-width",
    allowed: null,
    min: null,
    max: null,
    because: null,
    label: "",
    ...overrides,
  });

  it("intersect when several rules speak about one attribute", () => {
    expect(
      mergeBounds([
        bounds({ allowed: [140, 160, 180] }),
        bounds({ allowed: ["160", "180", "203"] }),
        bounds({ min: 150 }),
        bounds({ min: 160 }),
        bounds({ max: 200 }),
        bounds({ max: 190 }),
      ]),
    ).toEqual({ allowed: [160, 180], min: 160, max: 190 });
  });

  it("check a value against the merged bounds", () => {
    expect(satisfies({ allowed: [160], min: null, max: null }, "160")).toBe(true);
    expect(satisfies({ allowed: [160], min: null, max: null }, 180)).toBe(false);
    expect(satisfies({ allowed: null, min: 30, max: null }, 28)).toBe(false);
    expect(satisfies({ allowed: null, min: null, max: 30 }, 32)).toBe(false);
    expect(satisfies({ allowed: null, min: 28, max: 32 }, 30)).toBe(true);
  });

  const diameter = partDefinition("rotor-rear")!.attributes.find((a) => a.key === "diameter")!;
  const width = partDefinition("tire-rear")!.attributes.find((a) => a.key === "etrto-width")!;
  const text = partDefinition("rear-derailleur")!.attributes.find((a) => a.key === "hanger-model")!;

  it("pick the value to buy", () => {
    const open = { allowed: null, min: null, max: null };
    expect(pickValue(diameter, 160, { ...open, max: 180 })).toBe(160);
    expect(pickValue(diameter, 203, { ...open, max: 180 })).toBe(180);
    expect(pickValue(diameter, 140, { ...open, min: 160 })).toBe(160);
    expect(pickValue(diameter, 140, { ...open, allowed: [180, 203] })).toBe(180);
    expect(pickValue(width, 45, { ...open, max: 32 })).toBe(32);
    expect(pickValue(width, 25, { ...open, min: 28 })).toBe(28);
    expect(pickValue(width, undefined, { ...open, max: 32 })).toBeUndefined();
    expect(pickValue(width, 27, { ...open, allowed: [27.2] })).toBe(27.2);
    expect(pickValue(diameter, 203, { ...open, allowed: [160], max: 140 })).toBe(140);
    expect(pickValue(text, "x", { ...open, allowed: ["y"] })).toBe("y");
    expect(pickValue(text, "x", { ...open, allowed: [] })).toBe("x");
  });
});

// ── Search ───────────────────────────────────────────────────────────────────

describe("search queries", () => {
  const cassette = { speeds: 11, range: "11-34", freehub: "hg" };

  it("match the §5.8 contract in both locales", () => {
    expect(buildSearchQuery("cassette", cassette, "fr")).toBe("cassette 11 vitesses 11-34 hg");
    expect(buildSearchQuery("cassette", cassette, "en")).toBe("cassette 11 speed 11-34 hg");
    expect(encodeURIComponent(buildSearchQuery("cassette", cassette, "fr"))).toBe(
      "cassette%2011%20vitesses%2011-34%20hg",
    );
  });

  it("append a brand only when one was picked, and skip what is unknown", () => {
    expect(buildSearchQuery("cassette", { speeds: 12 }, "en", "Shimano")).toBe(
      "cassette 12 speed Shimano",
    );
    expect(buildSearchQuery("frame", {}, "fr")).toBe("cadre");
  });

  it("spell a chain's speed family and search bar tape as bar tape", () => {
    expect(buildSearchQuery("chain", { speeds: "6-7-8" }, "fr")).toBe("chaîne 6-7-8 vitesses");
    expect(buildSearchQuery("grips-or-tape", { cover: "bar-tape" }, "fr")).toBe("guidoline");
    expect(buildSearchQuery("grips-or-tape", {}, "en")).toBe("bar tape or grips");
  });

  it("give every retailer the query of the template", () => {
    const guide = buildBuyingGuide(GRAVEL, "cassette", "fr", { brand: "SRAM" });
    expect(Object.keys(guide.searchQueries)).toEqual([...RETAILER_ORDER]);
    for (const query of Object.values(guide.searchQueries)) {
      expect(query).toBe("cassette 11 vitesses 11-42 hg-l SRAM");
    }
  });
});

// ── Data the guide reads ─────────────────────────────────────────────────────

describe("the tool catalogue", () => {
  it("parses, and every alternative is another tool", () => {
    expect(TOOLS.map((tool) => tool.id)).toEqual([...TOOL_IDS]);
    for (const tool of TOOLS) {
      expect(ToolDefSchema.safeParse(tool).success, tool.id).toBe(true);
      expect(tool.labelKey).toBe(`tools.${tool.id}.label`);
      for (const alternative of tool.alternatives) {
        expect(isToolId(alternative), `${tool.id} → ${alternative}`).toBe(true);
        expect(alternative).not.toBe(tool.id);
      }
    }
    expect(TOOLS.find((tool) => tool.id === "chain-checker")!.alternatives).toContain(
      "steel-ruler",
    );
    expect(isToolId("sonic-screwdriver")).toBe(false);
    expect(isToolId(3)).toBe(false);
  });
});

describe("the retailers", () => {
  it("are the three of the schema, parse, and have labels", () => {
    expect([...RETAILER_ORDER]).toEqual([...RETAILER_IDS]);
    for (const id of RETAILER_ORDER) {
      const retailer = RETAILERS[id];
      expect(RetailerDefSchema.safeParse(retailer).success, id).toBe(true);
      expect(retailer.id).toBe(id);
      for (const locale of routing.locales) {
        expect(lookupMessage(locale, retailer.labelKey), `${locale} ${id}`).toBeTypeOf("string");
        const target = retailer.byLocale[locale];
        if (target.kind === "category") {
          for (const partId of Object.keys(target.byPartId)) {
            expect(PART_IDS, partId).toContain(partId);
          }
        }
      }
    }
  });
});

describe("the domain message lookup", () => {
  it("resolves strings, and nothing that is not one", () => {
    expect(partLabel("fr", "bottom-bracket")).toBe("Boîtier de pédalier");
    expect(attributeLabel("en", "freehub")).toBe("Freehub body");
    expect(lookupMessage("fr", "parts.values")).toBeUndefined();
    expect(lookupMessage("fr", "parts.nope.label")).toBeUndefined();
    expect(lookupMessage("fr", "parts.frame.label.deeper")).toBeUndefined();
    expect(lookupMessage("fr", "parts.__proto__")).toBeUndefined();
    expect(lookupMessage("en", "decision.drive.options.electric.label")).toBe("Electric");
  });

  it("fills placeholders it is given and leaves the others", () => {
    expect(domainMessage("fr", "parts.units.mm", { value: 27.2 })).toBe("27.2 mm");
    expect(domainMessage("en", "parts.units.mm")).toBe("{value} mm");
    expect(domainMessage("en", "parts.missing.key")).toBe("parts.missing.key");
  });

  it("labels enum values, yes/no, numbers with a unit and bare values", () => {
    expect(valueLabel("fr", "freehub", "micro-spline")).toBe("Shimano Micro Spline");
    expect(valueLabel("en", "lockout", true)).toBe("Yes");
    expect(valueLabel("fr", "lockout", false)).toBe("Non");
    expect(valueLabel("en", "etrto-width", 28, "mm")).toBe("28 mm");
    expect(valueLabel("en", "hanger-model", "Pilo D38")).toBe("Pilo D38");
  });

  it("covers every part of the catalogue in both locales", () => {
    for (const locale of routing.locales) {
      for (const part of PARTS) {
        expect(partLabel(locale, part.id as PartId)).not.toBe(part.labelKey);
      }
    }
  });
});
