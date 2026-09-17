import { describe, expect, it } from "vitest";

import {
  firstValue,
  parsePartId,
  parsePartIds,
  parsePresetId,
  parseQuality,
  parseViewerMode,
  parseViewerQuery,
  serializePartIds,
  withViewerParams,
} from "./query";

describe("viewer query parameters", () => {
  it("takes the first string of a repeated parameter", () => {
    expect(firstValue("a")).toBe("a");
    expect(firstValue(["b", "c"])).toBe("b");
    expect(firstValue([])).toBeUndefined();
    expect(firstValue(undefined)).toBeUndefined();
    expect(firstValue(3)).toBeUndefined();
  });

  it("parses part ids", () => {
    expect(parsePartId("saddle")).toBe("saddle");
    expect(parsePartId(["chain", "saddle"])).toBe("chain");
    expect(parsePartId("bogus")).toBeNull();
    expect(parsePartIds("chain,saddle,chain,bogus")).toEqual(["chain", "saddle"]);
    expect(parsePartIds("")).toEqual([]);
    expect(serializePartIds(["chain", "saddle"])).toBe("chain,saddle");
  });

  it("parses presets, qualities and modes", () => {
    expect(parsePresetId("road-rim-2x11")).toBe("road-rim-2x11");
    expect(parsePresetId("road")).toBeNull();
    expect(parseQuality("low")).toBe("low");
    expect(parseQuality("ultra")).toBeNull();
    expect(parseViewerMode("pick")).toBe("pick");
    expect(parseViewerMode("PICK")).toBe("browse");
  });

  it("whitelists a searchParams object", () => {
    expect(
      parseViewerQuery({
        part: "chain",
        parts: "saddle",
        preset: "gravel-1x11",
        quality: "med",
        mode: "pick",
        x: "1",
      }),
    ).toEqual({
      part: "chain",
      parts: ["saddle"],
      preset: "gravel-1x11",
      quality: "med",
      mode: "pick",
    });
    expect(parseViewerQuery(null)).toEqual({
      part: null,
      parts: [],
      preset: null,
      quality: null,
      mode: "browse",
    });
  });

  it("writes ?part= and ?parts= preserving everything else", () => {
    expect(withViewerParams("http://x.test/fr/velo/demo?step=2#top", "chain", [])).toBe(
      "/fr/velo/demo?step=2&part=chain#top",
    );
    expect(withViewerParams("/fr/velo/demo?part=chain&parts=a", null, ["saddle", "chain"])).toBe(
      "/fr/velo/demo?parts=saddle%2Cchain",
    );
    expect(withViewerParams("/fr?part=chain", null, [])).toBe("/fr");
  });
});
