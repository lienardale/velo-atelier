/**
 * Guide parity on disk (§5.8 AC2): FR and EN exist for every guide, agree on
 * structure, and the ★ guides are really full.
 *
 * Runs over the guides that exist — the 3 of W1-T4 now, all 47 once W2-T4a/b
 * land; `tests/integration/content/coverage.test.ts` (W2-T4a) is the test that
 * requires all of `EXPECTED_SLUGS` to be present. Nothing here depends on
 * `.content-collections/`: files are parsed with the same frontmatter schema
 * the build uses.
 */
/* eslint-disable security/detect-object-injection -- lookups keyed by guide, locale and part ids from the repo */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runContentCheck } from "@/lib/content/check";
import { GUIDE_LOCALES } from "@/lib/content/types";
import { EXPECTED_SLUGS, FULL_SLUGS } from "@/tests/fixtures/content-manifest";
import { readGuide, slugsOnDisk } from "@/tests/_helpers/guides";

import frParts from "@/messages/fr/parts.json";
import enParts from "@/messages/en/parts.json";

const slugs = slugsOnDisk();
const full = new Set<string>(FULL_SLUGS);

describe("guides on disk", () => {
  it("exist, and every folder is a slug of the contract", () => {
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) expect(EXPECTED_SLUGS as readonly string[], slug).toContain(slug);
  });

  it("pass the content check (default mode, which includes FR/EN parity)", () => {
    const { errors } = runContentCheck(process.cwd());
    expect(errors.map((e) => `${e.file}:${e.line}: ${e.message}`)).toEqual([]);
  });

  for (const slug of slugs) {
    describe(slug, () => {
      const fr = readGuide(slug, "fr");
      const en = readGuide(slug, "en");

      it("has the same structure in both locales", () => {
        const shape = (g: typeof fr) => ({
          kind: g.kind,
          partIds: g.partIds,
          appliesTo: g.appliesTo,
          difficulty: g.difficulty,
          minutes: g.minutes,
          tools: g.tools.map((t) => t.toolId),
          status: g.status,
          order: g.order,
          steps: g.steps.map((s) => ({
            id: s.id,
            partIds: s.partIds,
            appliesTo: s.appliesTo,
            checkQuestion: s.checkQuestion !== undefined,
            ko: s.checkQuestion?.ko.map((k) => ({
              action: k.action,
              partId: k.partId,
              guideSlug: k.guideSlug,
            })),
          })),
        });
        expect(shape(en)).toEqual(shape(fr));
      });

      it("is translated: titles differ between locales", () => {
        expect(en.title).not.toBe(fr.title);
        expect(en.steps.map((s) => s.title)).not.toEqual(fr.steps.map((s) => s.title));
      });

      if (full.has(slug)) {
        it("is a ★ guide: full, ≥ 4 steps, ≥ 1 illustration, in both locales", () => {
          for (const guide of [fr, en]) {
            expect(guide.status).toBe("full");
            expect(guide.steps.length).toBeGreaterThanOrEqual(4);
            const inBody = /<Illustration\s+id="/.test(guide.body);
            expect(guide.steps.some((s) => s.illustration) || inBody).toBe(true);
          }
        });
      }
    });
  }
});

describe("glossary (content/glossary.json)", () => {
  const glossary = JSON.parse(
    readFileSync(join(process.cwd(), "content", "glossary.json"), "utf8"),
  ) as {
    terms: Array<{ id: string; fr: string; en: string }>;
  };

  it("has unique ids and both locales for every term", () => {
    const ids = glossary.terms.map((term) => term.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const term of glossary.terms) {
      for (const locale of GUIDE_LOCALES)
        expect(term[locale].trim(), `${term.id}.${locale}`).not.toBe("");
    }
  });

  it("every part label uses its glossary term", () => {
    const labels = { fr: frParts, en: enParts } as const;
    for (const term of glossary.terms.filter((t) => t.id.startsWith("part:"))) {
      const partId = term.id.slice("part:".length);
      for (const locale of GUIDE_LOCALES) {
        const label = (labels[locale] as unknown as Record<string, { label?: string }>)[partId]
          ?.label;
        expect(label, `parts.${partId}.label (${locale})`).toBeDefined();
        expect(label!.toLocaleLowerCase(locale), `parts.${partId}.label (${locale})`).toContain(
          term[locale].toLocaleLowerCase(locale),
        );
      }
    }
  });
});
