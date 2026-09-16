/**
 * Compatibility rules (§2.4) — "will this part work on this bike?".
 *
 * Each rule compares `<partId>.<attribute>` references with one of five checks
 * (`equal`, `allowed`, `lte`, `range`, `flag`); the engine is
 * `engine/compatibility.ts`. Front/rear pairs are written once with `{side}`
 * and expanded by `pairFrontRear()`, which appends `-front` / `-rear` to the id
 * and keeps the message keys shared (`rules.<group>.message`), so the copy is
 * written once and the issue's `partIds` say which side it is about.
 *
 * `RULE_IDS` is the literal list, so `CASES: Record<RuleId, …>` in
 * `compatibility.rules.test.ts` fails `tsc` when a rule has no test case; that
 * test also asserts the list equals the expanded catalogue.
 *
 * Every rule here is satisfied by every default bike the decision tree can
 * produce (the ≈70-build invariant) — which is why the parts' defaults for
 * both sides of a rule come from the same constant in `parts/standards.ts`.
 *
 * Zod-free (`import type` only): reachable from the barrel.
 */
import type { CompatibilityRule } from "../schema/rule";

import { pairFrontRear } from "./conventions";
import { is, not, type Condition } from "./parts/define";
import {
  BELT,
  DERAILLEUR,
  DISC,
  ELECTRIC,
  IGH,
  MECHANICAL_DISC,
  MID_DRIVE,
  MULTI_CHAINRING,
  RIM,
  TUBELESS,
} from "./parts/standards";

export const RULE_IDS = [
  "chain-cassette-speeds",
  "chain-freewheel-speeds",
  "derailleur-cassette-speeds",
  "shifter-derailleur-speeds",
  "shifter-hub-speeds",
  "shifter-derailleur-brand",
  "shifter-derailleur-brand-11-plus",
  "shifter-derailleur-actuation",
  "front-shifter-chainrings",
  "derailleur-max-cog",
  "cassette-freehub",
  "cassette-speeds-freehub",
  "freewheel-body",
  "hanger-standard",
  "caliper-rotor-size-front",
  "caliper-rotor-size-rear",
  "rotor-caliper-mount-front",
  "rotor-caliper-mount-rear",
  "rotor-frame-max",
  "rotor-fork-max",
  "rotor-hub-interface-front",
  "rotor-hub-interface-rear",
  "caliper-frame-mount",
  "caliper-fork-mount",
  "lever-caliper-actuation-front",
  "lever-caliper-actuation-rear",
  "lever-pull-ratio-front",
  "lever-pull-ratio-rear",
  "mech-disc-lever-pull-front",
  "mech-disc-lever-pull-rear",
  "wheel-axle-frame",
  "wheel-axle-fork",
  "tire-diameter-wheel-front",
  "tire-diameter-wheel-rear",
  "tire-rim-width-front",
  "tire-rim-width-rear",
  "tubeless-rim-tire-front",
  "tubeless-rim-tire-rear",
  "tire-frame-clearance",
  "tire-fork-clearance",
  "headset-frame",
  "stem-steerer",
  "stem-bar-clamp",
  "seatpost-frame-diameter",
  "seatpost-frame-shim",
  "seat-clamp-frame",
  "bb-shell-frame",
  "bb-spindle-crank",
  "pedal-thread-crank-left",
  "pedal-thread-crank-right",
  "belt-frame-splitter",
  "e-chain-rated",
  "e-crank-interface",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/** A rule whose id is a {@link RuleId}. */
export type CatalogRule = CompatibilityRule & { id: RuleId };

/** `rules.<group>.message` / `.fix` — shared by both instances of a paired rule. */
const keys = (group: string) => ({
  messageKey: `rules.${group}.message`,
  fixHintKey: `rules.${group}.fix`,
});

const up = (...speeds: number[]): Condition => is("drivetrain.speeds", ...speeds);

const single = (rule: CompatibilityRule): CompatibilityRule[] => [rule];

const paired = (rule: CompatibilityRule): CompatibilityRule[] => pairFrontRear(rule);

const RULE_GROUPS: CompatibilityRule[][] = [
  // ── Speeds ────────────────────────────────────────────────────────────────
  single({
    id: "chain-cassette-speeds",
    severity: "error",
    appliesTo: ["chain", "cassette"],
    check: {
      kind: "allowed",
      a: "chain.speeds",
      b: "cassette.speeds",
      table: {
        single: [1],
        "6-7-8": [6, 7, 8],
        "9": [9],
        "10": [10],
        "11": [11],
        "12": [12],
        "13": [13],
      },
    },
    ...keys("chain-cassette-speeds"),
  }),
  single({
    id: "chain-freewheel-speeds",
    severity: "error",
    appliesTo: ["chain", "freewheel"],
    check: {
      kind: "allowed",
      a: "chain.speeds",
      b: "freewheel.speeds",
      table: {
        single: [1],
        "6-7-8": [5, 6, 7, 8],
        "9": [9],
        "10": [10],
        "11": [11],
        "12": [12],
        "13": [13],
      },
    },
    ...keys("chain-freewheel-speeds"),
  }),
  single({
    id: "derailleur-cassette-speeds",
    severity: "error",
    appliesTo: ["rear-derailleur", "cassette"],
    check: { kind: "equal", a: "rear-derailleur.speeds", b: "cassette.speeds" },
    ...keys("derailleur-cassette-speeds"),
  }),
  single({
    id: "shifter-derailleur-speeds",
    severity: "error",
    appliesTo: ["shifter-right", "rear-derailleur"],
    when: DERAILLEUR,
    check: { kind: "equal", a: "shifter-right.speeds", b: "rear-derailleur.speeds" },
    ...keys("shifter-derailleur-speeds"),
  }),
  single({
    id: "shifter-hub-speeds",
    severity: "error",
    appliesTo: ["shifter-right", "internal-gear-hub"],
    when: IGH,
    check: { kind: "equal", a: "shifter-right.speeds", b: "internal-gear-hub.speeds" },
    ...keys("shifter-hub-speeds"),
  }),

  // ── Shifting ──────────────────────────────────────────────────────────────
  // Up to 10 speeds, MicroSHIFT and Shimano share a cable pull; from 11 up every
  // brand stands alone.
  single({
    id: "shifter-derailleur-brand",
    severity: "error",
    appliesTo: ["shifter-right", "rear-derailleur"],
    when: up(5, 6, 7, 8, 9, 10),
    check: {
      kind: "allowed",
      a: "shifter-right.brand",
      b: "rear-derailleur.brand",
      table: {
        shimano: ["shimano", "microshift"],
        microshift: ["microshift", "shimano"],
        sram: ["sram"],
        campagnolo: ["campagnolo"],
      },
    },
    ...keys("shifter-derailleur-brand"),
  }),
  single({
    id: "shifter-derailleur-brand-11-plus",
    severity: "error",
    appliesTo: ["shifter-right", "rear-derailleur"],
    when: up(11, 12, 13),
    check: {
      kind: "allowed",
      a: "shifter-right.brand",
      b: "rear-derailleur.brand",
      table: {
        shimano: ["shimano"],
        microshift: ["microshift"],
        sram: ["sram"],
        campagnolo: ["campagnolo"],
      },
    },
    ...keys("shifter-derailleur-brand"),
  }),
  single({
    id: "shifter-derailleur-actuation",
    severity: "error",
    appliesTo: ["shifter-right", "rear-derailleur"],
    check: { kind: "equal", a: "shifter-right.actuation", b: "rear-derailleur.actuation" },
    ...keys("shifter-derailleur-actuation"),
  }),
  single({
    id: "front-shifter-chainrings",
    severity: "error",
    appliesTo: ["shifter-left", "crankset"],
    when: MULTI_CHAINRING,
    check: { kind: "equal", a: "shifter-left.positions", b: "crankset.chainrings" },
    ...keys("front-shifter-chainrings"),
  }),
  single({
    id: "derailleur-max-cog",
    severity: "warning",
    appliesTo: ["cassette", "rear-derailleur"],
    check: { kind: "lte", a: "cassette.largest-cog", b: "rear-derailleur.max-cog" },
    ...keys("derailleur-max-cog"),
  }),
  single({
    id: "cassette-freehub",
    severity: "error",
    appliesTo: ["cassette", "wheel-rear"],
    check: {
      kind: "allowed",
      a: "cassette.freehub",
      b: "wheel-rear.freehub",
      table: {
        hg: ["hg", "hg-l"],
        "hg-l": ["hg-l"],
        xd: ["xd", "xdr"],
        xdr: ["xdr"],
        "micro-spline": ["micro-spline"],
      },
    },
    ...keys("cassette-freehub"),
  }),
  single({
    id: "cassette-speeds-freehub",
    severity: "error",
    appliesTo: ["wheel-rear", "cassette"],
    check: {
      kind: "allowed",
      a: "wheel-rear.freehub",
      b: "cassette.speeds",
      table: {
        hg: [7, 8, 9, 10, 11],
        "hg-l": [8, 9, 10, 11, 12],
        xd: [11, 12],
        xdr: [12, 13],
        "micro-spline": [12],
      },
    },
    ...keys("cassette-speeds-freehub"),
  }),
  single({
    id: "freewheel-body",
    severity: "error",
    appliesTo: ["freewheel", "wheel-rear"],
    check: { kind: "equal", a: "freewheel.freehub", b: "wheel-rear.freehub" },
    ...keys("freewheel-body"),
  }),
  single({
    id: "hanger-standard",
    severity: "warning",
    appliesTo: ["rear-derailleur", "frame"],
    when: DERAILLEUR,
    check: {
      kind: "allowed",
      a: "rear-derailleur.hanger-standard",
      b: "frame.hanger-standard",
      table: { udh: ["udh"], classic: ["classic", "udh"] },
    },
    ...keys("hanger-standard"),
  }),

  // ── Disc brakes ───────────────────────────────────────────────────────────
  paired({
    id: "caliper-rotor-size",
    severity: "error",
    appliesTo: ["brake-caliper-{side}", "rotor-{side}"],
    when: DISC,
    check: { kind: "equal", a: "brake-caliper-{side}.rotor-size", b: "rotor-{side}.diameter" },
    ...keys("caliper-rotor-size"),
  }),
  paired({
    id: "rotor-caliper-mount",
    severity: "warning",
    appliesTo: ["brake-caliper-{side}", "rotor-{side}"],
    when: DISC,
    check: {
      kind: "allowed",
      a: "brake-caliper-{side}.mount",
      b: "rotor-{side}.diameter",
      table: { "flat-mount": [140, 160], "post-mount": [160, 180, 203] },
    },
    ...keys("rotor-caliper-mount"),
  }),
  single({
    id: "rotor-frame-max",
    severity: "error",
    appliesTo: ["rotor-rear", "frame"],
    when: DISC,
    check: { kind: "lte", a: "rotor-rear.diameter", b: "frame.max-rotor" },
    ...keys("rotor-frame-max"),
  }),
  single({
    id: "rotor-fork-max",
    severity: "error",
    appliesTo: ["rotor-front", "fork"],
    when: DISC,
    check: { kind: "lte", a: "rotor-front.diameter", b: "fork.max-rotor" },
    ...keys("rotor-fork-max"),
  }),
  paired({
    id: "rotor-hub-interface",
    severity: "error",
    appliesTo: ["rotor-{side}", "wheel-{side}"],
    when: DISC,
    check: { kind: "equal", a: "rotor-{side}.interface", b: "wheel-{side}.rotor-interface" },
    ...keys("rotor-hub-interface"),
  }),
  single({
    id: "caliper-frame-mount",
    severity: "error",
    appliesTo: ["frame", "brake-caliper-rear"],
    when: DISC,
    check: {
      kind: "allowed",
      a: "frame.brake-mount",
      b: "brake-caliper-rear.mount",
      table: {
        "flat-mount": ["flat-mount"],
        "post-mount": ["post-mount"],
        "is-mount": ["post-mount"],
      },
    },
    ...keys("caliper-frame-mount"),
  }),
  single({
    id: "caliper-fork-mount",
    severity: "error",
    appliesTo: ["fork", "brake-caliper-front"],
    when: DISC,
    check: {
      kind: "allowed",
      a: "fork.brake-mount",
      b: "brake-caliper-front.mount",
      table: {
        "flat-mount": ["flat-mount"],
        "post-mount": ["post-mount"],
        "is-mount": ["post-mount"],
      },
    },
    ...keys("caliper-frame-mount"),
  }),

  // ── Levers ────────────────────────────────────────────────────────────────
  paired({
    id: "lever-caliper-actuation",
    severity: "error",
    appliesTo: ["brake-lever-{side}", "brake-caliper-{side}"],
    check: {
      kind: "equal",
      a: "brake-lever-{side}.actuation",
      b: "brake-caliper-{side}.actuation",
    },
    ...keys("lever-caliper-actuation"),
  }),
  paired({
    id: "lever-pull-ratio",
    severity: "error",
    appliesTo: ["brake-caliper-{side}", "brake-lever-{side}"],
    when: RIM,
    check: {
      kind: "allowed",
      a: "brake-caliper-{side}.brake-type",
      b: "brake-lever-{side}.pull",
      table: {
        "rim-caliper": ["short-road"],
        cantilever: ["short-road"],
        "v-brake": ["long-v-brake"],
        "disc-mechanical": ["short-road", "long-v-brake"],
        "disc-hydraulic": ["hydraulic"],
      },
    },
    ...keys("lever-pull-ratio"),
  }),
  paired({
    id: "mech-disc-lever-pull",
    severity: "error",
    appliesTo: ["brake-caliper-{side}", "brake-lever-{side}"],
    when: MECHANICAL_DISC,
    check: { kind: "equal", a: "brake-caliper-{side}.pull", b: "brake-lever-{side}.pull" },
    ...keys("mech-disc-lever-pull"),
  }),

  // ── Wheels and tyres ──────────────────────────────────────────────────────
  single({
    id: "wheel-axle-frame",
    severity: "error",
    appliesTo: ["wheel-rear", "frame"],
    check: { kind: "equal", a: "wheel-rear.axle", b: "frame.rear-axle" },
    ...keys("wheel-axle-frame"),
  }),
  single({
    id: "wheel-axle-fork",
    severity: "error",
    appliesTo: ["wheel-front", "fork"],
    check: { kind: "equal", a: "wheel-front.axle", b: "fork.axle" },
    ...keys("wheel-axle-fork"),
  }),
  paired({
    id: "tire-diameter-wheel",
    severity: "error",
    appliesTo: ["tire-{side}", "wheel-{side}"],
    check: { kind: "equal", a: "tire-{side}.etrto-diameter", b: "wheel-{side}.etrto-diameter" },
    ...keys("tire-diameter-wheel"),
  }),
  paired({
    id: "tire-rim-width",
    severity: "warning",
    appliesTo: ["wheel-{side}", "tire-{side}"],
    check: {
      kind: "range",
      a: "wheel-{side}.rim-width",
      b: "tire-{side}.etrto-width",
      table: {
        "17": [25, 32],
        "19": [28, 40],
        "21": [32, 50],
        "23": [35, 60],
        "25": [40, 64],
        "30": [50, 66],
      },
    },
    ...keys("tire-rim-width"),
  }),
  paired({
    id: "tubeless-rim-tire",
    severity: "error",
    appliesTo: ["wheel-{side}", "tire-{side}"],
    when: TUBELESS,
    check: { kind: "flag", a: "wheel-{side}.tubeless-ready", mustBe: true },
    ...keys("tubeless-rim-tire"),
  }),
  single({
    id: "tire-frame-clearance",
    severity: "error",
    appliesTo: ["tire-rear", "frame"],
    check: { kind: "lte", a: "tire-rear.etrto-width", b: "frame.max-tire-width" },
    ...keys("tire-frame-clearance"),
  }),
  single({
    id: "tire-fork-clearance",
    severity: "error",
    appliesTo: ["tire-front", "fork"],
    check: { kind: "lte", a: "tire-front.etrto-width", b: "fork.max-tire-width" },
    ...keys("tire-fork-clearance"),
  }),

  // ── Steering and seating ──────────────────────────────────────────────────
  single({
    id: "headset-frame",
    severity: "error",
    appliesTo: ["headset", "frame"],
    check: { kind: "equal", a: "headset.head-tube", b: "frame.head-tube" },
    ...keys("headset-frame"),
  }),
  single({
    id: "stem-steerer",
    severity: "error",
    appliesTo: ["fork", "stem"],
    check: {
      kind: "allowed",
      a: "fork.steerer",
      b: "stem.steerer-clamp",
      table: {
        "threaded-1": ["quill-22-2"],
        "straight-1-1-8": ["1-1-8"],
        "tapered-1-1-8-1-5": ["1-1-8"],
      },
    },
    ...keys("stem-steerer"),
  }),
  single({
    id: "stem-bar-clamp",
    severity: "error",
    appliesTo: ["stem", "handlebar"],
    check: { kind: "equal", a: "stem.bar-clamp", b: "handlebar.bar-clamp" },
    ...keys("stem-bar-clamp"),
  }),
  single({
    id: "seatpost-frame-diameter",
    severity: "error",
    appliesTo: ["seatpost", "frame"],
    check: { kind: "lte", a: "seatpost.seatpost-diameter", b: "frame.seatpost-diameter" },
    ...keys("seatpost-frame-diameter"),
  }),
  single({
    id: "seatpost-frame-shim",
    severity: "warning",
    appliesTo: ["seatpost", "frame"],
    check: { kind: "equal", a: "seatpost.seatpost-diameter", b: "frame.seatpost-diameter" },
    ...keys("seatpost-frame-shim"),
  }),
  single({
    id: "seat-clamp-frame",
    severity: "error",
    appliesTo: ["seat-clamp", "frame"],
    check: { kind: "equal", a: "seat-clamp.seat-clamp-diameter", b: "frame.seat-clamp-diameter" },
    ...keys("seat-clamp-frame"),
  }),

  // ── Bottom bracket and pedals ─────────────────────────────────────────────
  single({
    id: "bb-shell-frame",
    severity: "error",
    appliesTo: ["bottom-bracket", "frame"],
    when: not(MID_DRIVE),
    check: { kind: "equal", a: "bottom-bracket.bb-shell", b: "frame.bb-shell" },
    ...keys("bb-shell-frame"),
  }),
  single({
    id: "bb-spindle-crank",
    severity: "error",
    appliesTo: ["bottom-bracket", "crankset"],
    when: not(MID_DRIVE),
    check: { kind: "equal", a: "bottom-bracket.spindle", b: "crankset.spindle" },
    ...keys("bb-spindle-crank"),
  }),
  single({
    id: "pedal-thread-crank-left",
    severity: "error",
    appliesTo: ["crankset", "pedal-left"],
    check: { kind: "equal", a: "crankset.pedal-thread", b: "pedal-left.pedal-thread" },
    ...keys("pedal-thread-crank"),
  }),
  single({
    id: "pedal-thread-crank-right",
    severity: "error",
    appliesTo: ["crankset", "pedal-right"],
    check: { kind: "equal", a: "crankset.pedal-thread", b: "pedal-right.pedal-thread" },
    ...keys("pedal-thread-crank"),
  }),

  // ── Belts and e-bikes ─────────────────────────────────────────────────────
  single({
    id: "belt-frame-splitter",
    severity: "error",
    appliesTo: ["frame", "belt"],
    when: BELT,
    check: { kind: "flag", a: "frame.belt-splitter", mustBe: true },
    ...keys("belt-frame-splitter"),
  }),
  single({
    id: "e-chain-rated",
    severity: "warning",
    appliesTo: ["chain"],
    when: ELECTRIC,
    check: { kind: "flag", a: "chain.e-rated", mustBe: true },
    ...keys("e-chain-rated"),
  }),
  single({
    id: "e-crank-interface",
    severity: "error",
    appliesTo: ["crankset", "e-motor"],
    when: MID_DRIVE,
    check: { kind: "equal", a: "crankset.spindle", b: "e-motor.crank-interface" },
    ...keys("e-crank-interface"),
  }),
];

/** Every rule, front/rear pairs expanded, in the order of {@link RULE_IDS}' groups. */
export const RULES: readonly CatalogRule[] = RULE_GROUPS.flat() as CatalogRule[];

/** The distinct message groups (`rules.<group>.*`) the catalogue uses. */
export const RULE_MESSAGE_GROUPS: readonly string[] = [
  ...new Set(RULES.map((rule) => rule.messageKey.split(".")[1])),
];
