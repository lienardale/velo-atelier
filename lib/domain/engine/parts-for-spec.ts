/**
 * `BikeSpec` → the parts on that bike, with their default attributes (§2.3).
 *
 * A part is on the bike when its `includeWhen` holds (absent = always); an
 * attribute exists when its `presentWhen` holds; its value is the first
 * matching conditional default, else the fallback — and a `null` fallback
 * leaves the key off the part, which is how "we cannot guess, ask the owner"
 * reaches `missingAttributes()` (§2.4).
 *
 * Zod-free: reachable from the barrel (the 3D viewer calls this on every spec
 * change, §3.1).
 */
import { PARTS, type CatalogPart, type PartId } from "../data/parts";
import type { BikeSpec } from "../schema/bike-spec";
import type {
  AttributeDef,
  AttributeValue,
  BikeBuild,
  BikePart,
  PartDefinition,
} from "../schema/part";

import { evalSpecCondition } from "./condition";

/** Does this part belong on this bike by default? */
export function isPartIncluded(definition: PartDefinition, spec: BikeSpec): boolean {
  return definition.includeWhen === undefined || evalSpecCondition(definition.includeWhen, spec);
}

/** Does this attribute exist on this bike (a fork's travel only on a suspension fork)? */
export function isAttributePresent(attribute: AttributeDef, spec: BikeSpec): boolean {
  return attribute.presentWhen === undefined || evalSpecCondition(attribute.presentWhen, spec);
}

/** The default value of one attribute on this bike, or `null` when it cannot be guessed. */
export function defaultAttributeValue(
  attribute: AttributeDef,
  spec: BikeSpec,
): AttributeValue | null {
  const rule = attribute.default.when.find((candidate) => evalSpecCondition(candidate.when, spec));
  return rule === undefined ? attribute.default.fallback : rule.value;
}

/** Every present attribute with a guessable default. */
export function defaultAttributes(
  definition: PartDefinition,
  spec: BikeSpec,
): Record<string, AttributeValue> {
  const attributes: Record<string, AttributeValue> = {};
  for (const attribute of definition.attributes) {
    if (!isAttributePresent(attribute, spec)) continue;
    const value = defaultAttributeValue(attribute, spec);
    if (value !== null) attributes[attribute.key] = value;
  }
  return attributes;
}

/** One part as it comes out of the factory. */
export function defaultPart(definition: CatalogPart, spec: BikeSpec): BikePart {
  return { partId: definition.id, attributes: defaultAttributes(definition, spec) };
}

/** The definitions of the parts this bike has by default, in catalogue order. */
export function includedParts(spec: BikeSpec): CatalogPart[] {
  return PARTS.filter((definition) => isPartIncluded(definition, spec));
}

/** Materialise every part of the bike, with default attributes (§1.2). */
export function partsForSpec(spec: BikeSpec): BikePart[] {
  return includedParts(spec).map((definition) => defaultPart(definition, spec));
}

/** `{ spec, parts: partsForSpec(spec) }` — the whole default build. */
export function buildForSpec(spec: BikeSpec): BikeBuild {
  return { spec, parts: partsForSpec(spec) };
}

/** The part with this id on this build, if it is fitted. */
export function findPart(build: BikeBuild, partId: PartId | string): BikePart | undefined {
  return build.parts.find((candidate) => candidate.partId === partId);
}
