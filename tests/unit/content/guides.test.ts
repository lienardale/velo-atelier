/**
 * Guide accessors (§5.1, §6.2), the slug helpers and the frontmatter schema's
 * document-level refinements.
 */
import { describe, expect, it } from "vitest";

import {
  compareGuides,
  findGuide,
  guideSlugsForLocale,
  guidesForLocale,
  prevNextOf,
  relatedGuides,
  systemsOf,
  tocOf,
  toSummary,
} from "@/lib/content/guides";
import {
  GuideFrontmatterSchema,
  GuideSourceSchema,
  isGuideSlug,
  kindOfGuideSlug,
} from "@/lib/content/schema";
import { diskGuides, makeGuide } from "@/tests/_helpers/guides";

const docs = [
  makeGuide({ slug: "replace-chain", kind: "replace", title: "B", order: 1 }),
  makeGuide({
    slug: "check-drivetrain",
    kind: "check",
    title: "Z",
    order: 5,
    related: ["clean-chain", "replace-chain", "check-drivetrain", "clean-missing"],
  }),
  makeGuide({ slug: "clean-chain", kind: "clean", title: "A", order: 1 }),
  makeGuide({ slug: "check-brakes-disc", kind: "check", title: "Y", order: 5 }),
  makeGuide({ slug: "check-brakes-disc", kind: "check", title: "Y fr", order: 5, locale: "fr" }),
  makeGuide({
    slug: "replace-chain",
    kind: "replace",
    title: "stub",
    status: "stub",
    locale: "fr",
  }),
];

describe("ordering and lookup", () => {
  it("sorts by kind, then order, then title, then slug", () => {
    expect(guidesForLocale(docs, "en").map((d) => d.slug)).toEqual([
      "check-brakes-disc",
      "check-drivetrain",
      "clean-chain",
      "replace-chain",
    ]);
    const a = { kind: "check" as const, order: 1, title: "Same", slug: "check-a" };
    expect(compareGuides(a, { ...a, slug: "check-b" })).toBeLessThan(0);
  });

  it("finds one guide per slug and locale", () => {
    expect(findGuide(docs, "check-brakes-disc", "fr")?.title).toBe("Y fr");
    expect(findGuide(docs, "clean-chain", "fr")).toBeUndefined();
    expect(guideSlugsForLocale(docs, "fr")).toEqual(["check-brakes-disc", "replace-chain"]);
  });

  it("builds the table of contents from the steps", () => {
    expect(
      tocOf(
        makeGuide({
          steps: [
            { id: "a", title: "A" },
            { id: "b", title: "B" },
          ],
        }),
      ),
    ).toEqual([
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ]);
  });
});

describe("related and neighbours", () => {
  it("keeps existing, full, other guides of the same locale, in the author's order", () => {
    const drivetrain = findGuide(docs, "check-drivetrain", "en")!;
    expect(relatedGuides(docs, drivetrain).map((d) => d.slug)).toEqual([
      "clean-chain",
      "replace-chain",
    ]);
    const fr = makeGuide({
      slug: "check-x",
      kind: "check",
      locale: "fr",
      related: ["replace-chain"],
    });
    expect(relatedGuides([...docs, fr], fr)).toEqual([]); // the fr replace-chain is a stub
  });

  it("returns the previous and next guide, or null at the ends", () => {
    const list = guidesForLocale(docs, "en");
    expect(prevNextOf(docs, list[0])).toEqual({ previous: null, next: list[1] });
    expect(prevNextOf(docs, list[3])).toEqual({ previous: list[2], next: null });
    expect(prevNextOf(docs, makeGuide({ slug: "adjust-none", kind: "adjust" }))).toEqual({
      previous: null,
      next: null,
    });
  });
});

describe("summaries", () => {
  it("derives the part systems in catalogue order and ignores unknown ids", () => {
    expect(systemsOf(["chain", "brake-pads-front", "frame", "nope"])).toEqual([
      "frame",
      "drivetrain",
      "brakes",
    ]);
  });

  it("drops the MDX and keeps appliesTo only when present", () => {
    const summary = toSummary(
      makeGuide({ mdx: "code", appliesTo: { path: "brakes.isDisc", in: [true] } }),
    );
    expect(summary).not.toHaveProperty("mdx");
    expect(summary.appliesTo).toEqual({ path: "brakes.isDisc", in: [true] });
    expect(toSummary(makeGuide())).not.toHaveProperty("appliesTo");
    expect(toSummary(makeGuide()).systems).toEqual(["drivetrain"]);
  });

  it("summarises the real guides", () => {
    for (const guide of diskGuides()) expect(toSummary(guide).systems.length).toBeGreaterThan(0);
  });
});

describe("slugs and the frontmatter schema", () => {
  it("recognises slugs and their kind", () => {
    expect(isGuideSlug("check-brakes-disc")).toBe(true);
    for (const bad of [
      "brakes-disc",
      "check-",
      "check-../x",
      "CHECK-a",
      42,
      "check-" + "a".repeat(70),
    ]) {
      expect(isGuideSlug(bad), String(bad)).toBe(false);
    }
    expect(kindOfGuideSlug("measure-chain-wear")).toBe("measure");
    expect(kindOfGuideSlug("repair-chain")).toBeNull();
  });

  const valid = { ...makeGuide(), locale: undefined, mdx: undefined };
  delete (valid as Record<string, unknown>).locale;
  delete (valid as Record<string, unknown>).mdx;

  it("accepts a valid document and rejects unknown keys", () => {
    expect(GuideFrontmatterSchema.safeParse(valid).success).toBe(true);
    expect(GuideFrontmatterSchema.safeParse({ ...valid, type: "clean" }).success).toBe(false);
    expect(GuideSourceSchema.safeParse({ ...valid, content: "body" }).success).toBe(true);
  });

  it("requires the slug to start with the kind and the domain refinements to hold", () => {
    const wrongKind = GuideFrontmatterSchema.safeParse({ ...valid, kind: "check" });
    expect(wrongKind.success).toBe(false);
    expect(JSON.stringify(wrongKind.error?.issues)).toContain(
      'must start with its kind \\"check-\\"',
    );

    const duplicate = GuideFrontmatterSchema.safeParse({
      ...valid,
      steps: [
        { id: "one", title: "One" },
        { id: "one", title: "Again" },
      ],
    });
    expect(JSON.stringify(duplicate.error?.issues)).toContain("duplicate step id");
  });
});
