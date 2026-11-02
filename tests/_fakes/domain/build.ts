/**
 * Domain fixtures: answers, specs and builds, without hand-writing any of them.
 *
 *   const spec = specFor("gravel-1x11");                  // the demo bike
 *   const eBike = makeSpec({ drive: "electric", eSystem: { motorPosition: "mid-drive" } });
 *   const build = makeBuild(spec, [{ partId: "chain", attributes: { speeds: "11" } }]);
 *
 * Everything goes through `answerWithDefaults` + `buildBikeSpec`, so a fixture
 * is always a spec the product could actually have produced — a hand-written
 * literal would drift the moment a default changes.
 *
 * `makeSpec` is the one exception: it deep-merges an override onto the default
 * bike so a test can name the one field it cares about. Use it for engines that
 * only read the spec; anything that must be reachable from the decision tree
 * should start from `answersFor`.
 */
import {
  answerWithDefaults,
  buildBikeSpec,
  BIKE_PRESETS,
  type Answers,
  type BikeBuild,
  type BikePart,
  type BikeSpec,
  type PresetId,
} from "@/lib/domain";

/** The answers a preset stands for, defaults filled in (they already are). */
export function answersFor(preset: PresetId): Answers {
  return answerWithDefaults(BIKE_PRESETS[preset]);
}

/** The spec of a preset. */
export function specFor(preset: PresetId): BikeSpec {
  return buildBikeSpec(answerWithDefaults(BIKE_PRESETS[preset]));
}

/**
 * The bike no preset describes: a 3×7 hybrid with thumb shifters and
 * V-brakes. From 5 to 7 speeds a derailleur bike carries a threaded freewheel
 * instead of a cassette (`lib/domain/data/parts/drivetrain.ts`), and until
 * 2026-11-02 every finding of `check-drivetrain#cassette-teeth` named the
 * cassette, so the planner — which drops a finding about a part the bike does
 * not carry — asked this bike's cog question with none. The corpus tests run
 * it beside the seven presets for that reason.
 *
 * Written like a preset: complete, and no answer the tree does not ask —
 * `tests/unit/checkup/plan-corpus.test.ts` holds
 * `answerWithDefaults(FREEWHEEL_ANSWERS)` to it.
 */
export const FREEWHEEL_ID = "hybrid-3x7-freewheel";

export const FREEWHEEL_ANSWERS: Answers = {
  drive: "muscular",
  discipline: "city-hybrid",
  "wheel-size": "700c",
  "brake-type": "v-brake",
  cockpit: "flat",
  drivetrain: "derailleur-3x",
  speeds: "7",
  shifter: "thumb",
  pedals: "flat",
  suspension: "rigid",
  "tire-system": "clincher-tube",
};

/** The spec of a bike described by nothing at all: the city-hybrid default. */
export const DEFAULT_SPEC: BikeSpec = buildBikeSpec(answerWithDefaults({}));

/** The demo bike `/velo/demo` shows. */
export const DEMO_SPEC: BikeSpec = specFor("gravel-1x11");

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object | null ? DeepPartial<NonNullable<T[K]>> | null : T[K];
};

/** `{ …DEFAULT_SPEC, …overrides }`, one level at a time. */
export function makeSpec(overrides: DeepPartial<BikeSpec> = {}, base: BikeSpec = DEFAULT_SPEC) {
  return merge(base, overrides) as BikeSpec;
}

function merge(base: unknown, overrides: unknown): unknown {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    return overrides;
  }
  if (base === null || typeof base !== "object") return overrides;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = merge((base as Record<string, unknown>)[key], value);
  }
  return result;
}

/** A build: a spec plus whatever parts the test cares about. */
export function makeBuild(spec: BikeSpec = DEFAULT_SPEC, parts: BikePart[] = []): BikeBuild {
  return { spec, parts };
}

/** One part, with its attributes. */
export function makePart(partId: string, attributes: BikePart["attributes"] = {}): BikePart {
  return { partId, attributes };
}
