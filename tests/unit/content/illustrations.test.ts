/**
 * The content illustration registry (§5.3): domain ids are a subset, guide ids
 * are the 14 of §5.3, and every entry follows the registry conventions.
 */
/* eslint-disable security/detect-object-injection -- lookups keyed by registry ids */
import { describe, expect, it } from "vitest";

import {
  componentNameFor,
  CONTENT_ILLUSTRATIONS,
  GUIDE_ILLUSTRATION_IDS,
  illustrationDefinition,
  isContentIllustrationId,
} from "@/lib/content/illustrations";
import { ILLUSTRATIONS } from "@/lib/domain/data/illustrations";
import { checkIllustrations, IllustrationRegistrySchema } from "@/lib/domain/schema/illustration";

describe("content illustration registry", () => {
  it("contains every decision-tree illustration unchanged", () => {
    for (const [id, definition] of Object.entries(ILLUSTRATIONS)) {
      expect(CONTENT_ILLUSTRATIONS[id]).toEqual(definition);
    }
  });

  it("adds the 14 guide illustrations with derived component names", () => {
    expect(GUIDE_ILLUSTRATION_IDS).toHaveLength(14);
    expect(componentNameFor("derailleur-limit-screws-h-l-b")).toBe("IllDerailleurLimitScrewsHLB");
    for (const id of GUIDE_ILLUSTRATION_IDS) {
      expect(illustrationDefinition(id)).toEqual({
        component: componentNameFor(id),
        altKey: `illustrations.${id}.alt`,
        aspect: "4/3",
        status: "placeholder",
      });
    }
  });

  it("satisfies the registry schema (unique components, derived alt keys)", () => {
    expect(checkIllustrations(CONTENT_ILLUSTRATIONS)).toEqual([]);
    expect(IllustrationRegistrySchema.safeParse(CONTENT_ILLUSTRATIONS).success).toBe(true);
  });

  it("answers lookups safely", () => {
    expect(isContentIllustrationId("pad-wear-disc")).toBe(true);
    expect(isContentIllustrationId("ill-drive")).toBe(true);
    expect(isContentIllustrationId("toString")).toBe(false);
    expect(isContentIllustrationId(3)).toBe(false);
  });
});
