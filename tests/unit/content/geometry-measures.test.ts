/**
 * Every guide a geometry measure points at is a FULL guide, in both locales
 * (§5.7, §5.8 AC8): a fit page that links to a stub teaches nothing.
 *
 * Two layers: the slug contract (the target is in `FULL_SLUGS`, so it can never
 * legally be a stub) and the files on disk (both locales exist, parse, and say
 * `status: full`). Every target has been written since W2-T4b, so a missing
 * folder is a failure, not a `todo`.
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
    describe(slug, () => {
      it("is written in both locales", () => {
        for (const locale of ["fr", "en"] as const) {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- slug comes from the domain data, joined under content/guides
          expect(existsSync(join(GUIDES_DIR, slug, `${locale}.mdx`)), `${slug}/${locale}.mdx`).toBe(
            true,
          );
        }
      });

      it("has status full in fr and en", () => {
        expect(readGuide(slug, "fr").status).toBe("full");
        expect(readGuide(slug, "en").status).toBe("full");
      });

      it("is the same kind as its slug and at least 4 steps long", () => {
        for (const locale of ["fr", "en"] as const) {
          const guide = readGuide(slug, locale);
          expect(guide.kind).toBe(slug.slice(0, slug.indexOf("-")));
          expect(guide.steps.length).toBeGreaterThanOrEqual(4);
        }
      });
    });
  }
});
