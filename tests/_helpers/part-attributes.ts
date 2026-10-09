/**
 * The part catalogue, read the way the part edit form reads it — for tests
 * that have to hold a property of that form for EVERY attribute it can show,
 * not for the two or three a test author thought of.
 *
 * The form's defect of 2026-10-09 (`.debug/017` §5.8) needed two parts with a
 * field of the same name: the first agents to look listed the pairs by hand
 * and found eight; the catalogue has eleven, three of them between two hosted
 * parts (the pads, the tubes) that no click on the bike reaches but `?part=`
 * does. {@link sharedTypedPairs} is that enumeration, from the catalogue.
 */
import { buildOf, deriveBike } from "@/lib/bike/rules";
import { hasMesh, partDefinition } from "@/lib/domain/data/parts";
import { BIKE_PRESETS, type PresetId } from "@/lib/domain/data/presets";
import { isAttributePresent } from "@/lib/domain/engine/parts-for-spec";
import { setAttribute } from "@/lib/domain/engine/validate-build";
import type { AttributeDef, AttributeValue, BikeBuild } from "@/lib/domain/schema/part";

export const PRESET_IDS = Object.keys(BIKE_PRESETS) as PresetId[];

/** The build a preset's answers derive, as `createBikeAction` would store it. */
export function presetBuild(preset: PresetId): BikeBuild {
  // eslint-disable-next-line security/detect-object-injection -- a key of the presets table
  return buildOf(deriveBike(BIKE_PRESETS[preset]));
}

/** One attribute the form shows for one part of one build. */
export interface FormAttribute {
  partId: string;
  attribute: AttributeDef;
  /** What the build holds for it — `undefined` when nothing is set. */
  value: AttributeValue | undefined;
  /** Can a click ON THE BIKE select this part? A hosted part is reached by `?part=`. */
  onBike: boolean;
}

/** Every editable attribute present on `build`, in the order the panel lists them. */
export function formAttributes(build: BikeBuild): FormAttribute[] {
  const found: FormAttribute[] = [];
  for (const part of build.parts) {
    const definition = partDefinition(part.partId);
    if (definition === undefined) continue;
    for (const attribute of definition.attributes) {
      if (!attribute.editable || !isAttributePresent(attribute, build.spec)) continue;
      found.push({
        partId: part.partId,
        attribute,
        value: part.attributes[attribute.key],
        onBike: hasMesh(definition),
      });
    }
  }
  return found;
}

/** Number and text attributes: the ones committed on blur, i.e. the ones a stale field can write. */
export function isTyped(attribute: AttributeDef): boolean {
  return attribute.kind === "number" || attribute.kind === "text";
}

/** What is stored for one attribute of one part. */
export function attributeOf(
  build: BikeBuild,
  partId: string,
  key: string,
): AttributeValue | undefined {
  // eslint-disable-next-line security/detect-object-injection -- an attribute key of the catalogue
  return build.parts.find((part) => part.partId === partId)?.attributes[key];
}

/**
 * A value the domain accepts for `attribute` that is none of `avoid` — what a
 * test types, so that it can tell afterwards WHICH part received it.
 */
export function anotherValue(
  attribute: AttributeDef,
  ...avoid: (AttributeValue | undefined)[]
): AttributeValue {
  if (attribute.kind === "text") {
    for (const candidate of ["L05A", "B01S", "K03Ti"]) {
      if (!avoid.includes(candidate)) return candidate;
    }
    throw new Error(`no free text value for ${attribute.key}`);
  }
  const low = attribute.min ?? 1;
  const high = attribute.max ?? low + 100;
  for (let candidate = low + 1; candidate < high; candidate += 1) {
    if (!avoid.includes(candidate)) return candidate;
  }
  throw new Error(`no free number for ${attribute.key} in ${low}..${high}`);
}

/** Two parts of one preset that show a typed field under the same key, in one direction. */
export interface SharedPair {
  key: string;
  preset: PresetId;
  from: FormAttribute;
  to: FormAttribute;
}

/**
 * Every ORDERED pair of parts that share a number or text attribute key, over
 * the seven presets, once each — on the first preset that fits both.
 */
export function sharedTypedPairs(): SharedPair[] {
  const pairs = new Map<string, SharedPair>();
  for (const preset of PRESET_IDS) {
    const typed = formAttributes(presetBuild(preset)).filter((entry) => isTyped(entry.attribute));
    for (const from of typed) {
      for (const to of typed) {
        if (from.partId === to.partId || from.attribute.key !== to.attribute.key) continue;
        const id = `${from.attribute.key}: ${from.partId} -> ${to.partId}`;
        if (!pairs.has(id)) pairs.set(id, { key: from.attribute.key, preset, from, to });
      }
    }
  }
  return [...pairs.values()];
}

/**
 * One ordered pair of parts for every SELECT or CHECKBOX key two parts of a
 * preset share — the first pair found, on the first preset that fits both.
 *
 * A select or a checkbox is controlled, so it never showed another part's
 * value; but its status line ("Enregistré", or a refusal) lived in the same
 * per-key map as a typed field's and was carried to the next part just the
 * same. One pair per key is enough for that: the map never knew the part.
 */
export function sharedUntypedPairs(): SharedPair[] {
  const pairs = new Map<string, SharedPair>();
  for (const preset of PRESET_IDS) {
    const untyped = formAttributes(presetBuild(preset)).filter(
      (entry) => !isTyped(entry.attribute),
    );
    for (const from of untyped) {
      if (pairs.has(from.attribute.key)) continue;
      const to = untyped.find(
        (entry) => entry.partId !== from.partId && entry.attribute.key === from.attribute.key,
      );
      if (to !== undefined)
        pairs.set(from.attribute.key, { key: from.attribute.key, preset, from, to });
    }
  }
  return [...pairs.values()];
}

/**
 * `preset`'s build with a value of its own in every number and text field, so
 * that two parts never hold the same thing under the same key. Out of the box
 * almost all of them do (both tyres are 42 mm wide), and a field showing the
 * wrong part's value is then indistinguishable from one showing the right one.
 */
export function distinctBuild(preset: PresetId): BikeBuild {
  let build = presetBuild(preset);
  const taken = new Map<string, AttributeValue[]>();
  for (const entry of formAttributes(build)) {
    if (!isTyped(entry.attribute)) continue;
    const used = taken.get(entry.attribute.key) ?? [];
    const value =
      entry.attribute.kind === "text"
        ? `ref-${entry.partId}`
        : anotherValue(entry.attribute, ...used);
    const change = setAttribute(build, entry.partId, entry.attribute.key, value);
    if (!change.ok) {
      throw new Error(`${preset}: ${entry.partId}.${entry.attribute.key} refused ${String(value)}`);
    }
    build = change.build;
    taken.set(entry.attribute.key, [...used, value]);
  }
  return build;
}
