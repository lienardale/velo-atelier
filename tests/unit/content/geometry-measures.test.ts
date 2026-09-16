/**
 * Every guide a geometry measure points at is a FULL guide, in both locales
 * (§5.7, §5.8 AC8): a fit page that links to a stub teaches nothing.
 *
 * The slug contract is checked for every measure now: the target is in
 * `FULL_SLUGS`, so it can never legally be a stub. The on-disk check runs for
 * every target that has been written; targets still to be authored (W2-T4a/b
 * write `measure-*` and `adjust-suspension-sag`) are listed as visible
 * `todo`s — not silently passed — until their folder exists, at which point the
 * assertion runs with no edit to this file.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GEOMETRY_MEASURES } from "@/lib/domain/data/geometry-measures";
import { FULL_SLUGS } from "@/tests/fixtures/content-manifest";
import { GUIDES_DIR, readGuide } from "@/tests/_helpers/guides";

const targets = [...new Set(GEOMETRY_MEASURES.map((measure) => measure.guideSlug))].sort();

describe("geometry measures → full guides", () => {
  it("every target is a ★ full guide of the slug contract", () => {
    for (const slug of targets) expect(FULL_SLUGS as readonly string[], slug).toContain(slug);
  });

  it("every target is a measure or adjust guide", () => {
    for (const slug of targets) expect(slug, slug).toMatch(/^(measure|adjust)-/);
  });

  for (const slug of targets) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- slug comes from the domain data, joined under content/guides
    if (!existsSync(join(GUIDES_DIR, slug))) {
      it.todo(`${slug}: status full in fr and en (content/guides/${slug} not written yet — W2-T4)`);
      continue;
    }
    it(`${slug}: status full in fr and en`, () => {
      expect(readGuide(slug, "fr").status).toBe("full");
      expect(readGuide(slug, "en").status).toBe("full");
    });
  }
});
