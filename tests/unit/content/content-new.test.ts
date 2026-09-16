/**
 * `scripts/content-new.ts` scaffolds a stub that the content check accepts as
 * a structure (it only asks for real text), with identical FR/EN frontmatter.
 */
import { describe, expect, it } from "vitest";

import { parseFrontmatter } from "@/lib/content/frontmatter";
import { GuideFrontmatterSchema } from "@/lib/content/schema";

import { scaffold } from "../../../scripts/content-new";

describe("content:new", () => {
  it("writes a valid stub in both locales with the same structure", () => {
    const files = scaffold("replace-bar-tape", ["grips-or-tape"]);
    const fr = GuideFrontmatterSchema.parse(parseFrontmatter(files.fr)?.data);
    const en = GuideFrontmatterSchema.parse(parseFrontmatter(files.en)?.data);
    expect(fr).toMatchObject({
      slug: "replace-bar-tape",
      kind: "replace",
      status: "stub",
      partIds: ["grips-or-tape"],
    });
    expect({ ...en, title: fr.title, summary: fr.summary, steps: fr.steps }).toEqual(fr);
    expect(files.fr).toContain('<Step id="first-step">');
  });

  it("defaults the part list and rejects bad slugs and parts", () => {
    expect(
      GuideFrontmatterSchema.parse(parseFrontmatter(scaffold("clean-frame", []).en)?.data).partIds,
    ).toEqual(["frame"]);
    expect(() => scaffold("repair-chain", [])).toThrow(/not a guide slug/);
    expect(() => scaffold("clean-chain", ["sprocket"])).toThrow(/unknown part id\(s\): sprocket/);
  });
});
