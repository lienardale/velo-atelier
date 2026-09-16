/**
 * Naming conventions shared by every domain data file (§2.3).
 *
 * Zod-free on purpose: `lib/domain/index.ts` re-exports this module, and the
 * barrel must never pull a parser into the client bundle
 * (`tests/unit/domain/no-zod-in-barrel.test.ts`).
 */

/**
 * Every id that becomes a message-key segment — question ids, option ids, part
 * ids, attribute keys, rule ids, tool ids, illustration ids.
 *
 * Kebab-case, no dots: next-intl uses `.` as its key separator, so an id with a
 * dot in it would silently split into two levels of the catalogue (§1.2).
 */
export const ID_PATTERN = /^[a-z0-9-]+$/;

/** `true` when `value` is a well-formed id (see {@link ID_PATTERN}). */
export function isId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/**
 * How many options a node may show at once before the grid stops being
 * scannable on a phone (§2.1). Asserted by `decision.property.test.ts` over
 * every reachable state, not just the ones we thought of.
 */
export const MAX_VISIBLE_OPTIONS = 8;

/**
 * From this many options up, every option needs a thumbnail — unless every
 * option id is a plain number, which is how `speeds` renders a numeric grid
 * with no art at all (§2.1).
 */
export const THUMBNAIL_THRESHOLD = 4;

// ── The vocabulary of a BikeSpec ─────────────────────────────────────────────
//
// Declared here rather than in `schema/bike-spec.ts` so that the values (not
// only the types) are reachable from the zod-free barrel: a client component
// that renders a `<select>` of disciplines must not pull a parser into the
// bundle. `schema/bike-spec.ts` builds its `z.enum`s from these arrays, so the
// runtime lists and the parsed types can never drift apart.

/** Muscular or electric — question 1 of the tree. */
export const DRIVE_KINDS = ["muscular", "electric"] as const;

/** What the bike is built for — question 2, the strongest default-setter. */
export const DISCIPLINES = ["road", "gravel", "mtb", "city-hybrid", "kids"] as const;

/** Wheel labels as riders say them (`27.5`, with a dot: a label, never a key segment). */
export const WHEEL_LABELS = ["700c", "650b", "29", "27.5", "26", "24", "20", "16"] as const;

/** ETRTO bead-seat diameters in mm, the only unambiguous way to read a wheel size. */
export const ETRTO_DIAMETERS = [622, 584, 559, 507, 406, 305] as const;

export const BRAKE_TYPES = [
  "rim-caliper",
  "v-brake",
  "cantilever",
  "disc-mechanical",
  "disc-hydraulic",
] as const;

export const BRAKE_MOUNTS = ["flat-mount", "post-mount", "is-mount"] as const;

/** How the gears work, once the number of chainrings is a separate field. */
export const DRIVETRAIN_KINDS = ["derailleur", "igh", "singlespeed"] as const;

export const TRANSMISSIONS = ["chain", "belt"] as const;

export const SHIFTER_IDS = [
  "sti-integrated",
  "trigger",
  "grip",
  "thumb",
  "bar-end",
  "electronic",
] as const;

export const BAR_SHAPES = ["drop", "flat", "riser", "swept"] as const;

export const PEDAL_IDS = ["flat", "spd", "road-clipless", "toe-clips", "combo"] as const;

export const TIRE_SYSTEMS = ["clincher-tube", "tubeless"] as const;

export const MOTOR_POSITIONS = ["mid-drive", "hub-rear"] as const;

export const BATTERY_POSITIONS = ["integrated", "external-downtube", "rack"] as const;

/** Derived from the discipline: city and hybrid bikes get the low top tube. */
export const FRAME_STYLES = ["diamond", "step-through"] as const;

/** The systems a part can belong to — the grouping of the parts panel (§6.4). */
export const PART_SYSTEMS = [
  "frame",
  "wheels",
  "tires",
  "drivetrain",
  "brakes",
  "cockpit",
  "saddle",
  "pedals",
  "suspension",
  "e-system",
  "accessories",
] as const;

/** Where a part sits when its id is not unique on the bike. */
export const PART_POSITIONS = ["front", "rear", "left", "right", "none"] as const;

/** Units an attribute can carry; `count` covers "how many" (teeth, pistons, …). */
export const ATTRIBUTE_UNITS = ["mm", "in", "g", "Wh", "V", "Nm", "count"] as const;

/**
 * Which lever operates which brake, French/continental convention: left lever →
 * front brake. Used by the checkup wording ("le levier gauche commande le frein
 * avant") and by the 3D labels.
 */
export const BRAKE_SIDE = { front: "left", rear: "right" } as const;

/** The two positions a paired part can take (`-front` / `-rear`). */
export const POSITIONS = ["front", "rear"] as const;

/** `'front' | 'rear'`. */
export type Position = (typeof POSITIONS)[number];

/**
 * The placeholder a paired template writes wherever the position belongs:
 * `'brake-pads-{side}'`, `'{side}.rotor-size'`, …
 */
export const SIDE_TOKEN = "{side}";

/** Replace every {@link SIDE_TOKEN} inside a JSON-shaped value, recursively. */
function substitute<T>(value: T, side: Position): T {
  if (typeof value === "string") return value.replaceAll(SIDE_TOKEN, side) as T;
  if (Array.isArray(value)) return value.map((item) => substitute(item, side)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, side)]),
    ) as T;
  }
  return value;
}

/**
 * Expand one paired template into its front and rear instances (§2.3).
 *
 * `pairFrontRear({ id: 'rotor-hub-interface', appliesTo: ['rotor-{side}', 'wheel-{side}'], … })`
 * yields `rotor-hub-interface-front` (about `rotor-front` / `wheel-front`) and
 * `rotor-hub-interface-rear`, so a rule pairs front with front and rear with
 * rear and can never cross the two.
 *
 * Every string in the template — ids, part ids, attribute paths, message keys —
 * gets the substitution, so a template stays readable as one object.
 */
export function pairFrontRear<T extends { id: string }>(template: T): [T, T] {
  return [forSide(template, "front"), forSide(template, "rear")];
}

function forSide<T extends { id: string }>(template: T, side: Position): T {
  return { ...substitute(template, side), id: `${template.id}-${side}` };
}
