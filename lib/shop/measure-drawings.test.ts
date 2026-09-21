/**
 * The attribute → drawing table of the build list's "Comment mesurer" (§6.5):
 * every key is an attribute a buyer is asked about, and every drawing exists.
 */
import { describe, expect, it } from "vitest";

import { illustrationDefinition } from "@/lib/content/illustrations";
import { PARTS } from "@/lib/domain/data/parts";

import { MEASURE_DRAWINGS, measureDrawingFor } from "./measure-drawings";

const ASKED = new Set(
  PARTS.flatMap((part) => part.attributes.filter((a) => a.editable).map((a) => a.key)),
);

describe("MEASURE_DRAWINGS", () => {
  it.each(Object.entries(MEASURE_DRAWINGS))(
    "%s → %s: an asked attribute, a registered drawing",
    (key, id) => {
      expect(ASKED.has(key), `${key} is not an attribute a buyer is asked about`).toBe(true);
      expect(illustrationDefinition(id), `${id} is not a registered drawing`).toBeDefined();
    },
  );

  it("answers nothing for an attribute without a drawing, or a prototype key", () => {
    expect(measureDrawingFor("speeds")).toBe("ill-speeds");
    expect(measureDrawingFor("range")).toBeUndefined();
    expect(measureDrawingFor("constructor")).toBeUndefined();
  });
});
