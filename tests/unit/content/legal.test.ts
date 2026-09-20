/**
 * `lib/content/legal.ts` — the two legal documents and the dates on them.
 *
 * The date is the part worth pinning. YAML hands `updatedAt: 2026-09-17` to the
 * content build as a `Date` at UTC midnight; the transform stores the calendar
 * date as a string, and the page turns it back into a `Date` to format. A
 * timezone slip anywhere in that round trip shows a French visitor the day
 * before the policy was revised — the kind of wrong nobody reports and everyone
 * half-notices.
 */
import { describe, expect, it } from "vitest";

import {
  findLegal,
  isLegalPageId,
  LEGAL_PAGE_IDS,
  legalUpdatedAt,
  LegalSourceSchema,
  toCalendarDate,
  type LegalDocument,
} from "@/lib/content/legal";

function makeLegal(overrides: Partial<LegalDocument> = {}): LegalDocument {
  return {
    id: "mentions",
    locale: "fr",
    title: "Mentions légales",
    summary: "Qui édite le site.",
    updatedAt: "2026-09-17",
    mdx: "compiled",
    ...overrides,
  };
}

const DOCUMENTS: readonly LegalDocument[] = [
  makeLegal(),
  makeLegal({ locale: "en", title: "Legal notice" }),
  makeLegal({ id: "confidentialite", title: "Politique de confidentialité" }),
];

describe("LEGAL_PAGE_IDS", () => {
  it("is the two files on disk, and nothing else is an id", () => {
    expect([...LEGAL_PAGE_IDS]).toEqual(["mentions", "confidentialite"]);
    expect(isLegalPageId("mentions")).toBe(true);
    expect(isLegalPageId("confidentialite")).toBe(true);
    for (const value of ["cgv", "", "mentions.fr", 1, null, undefined]) {
      expect(isLegalPageId(value)).toBe(false);
    }
  });
});

describe("findLegal", () => {
  it("matches on id AND locale", () => {
    expect(findLegal(DOCUMENTS, "mentions", "en")?.title).toBe("Legal notice");
    expect(findLegal(DOCUMENTS, "confidentialite", "fr")?.title).toBe(
      "Politique de confidentialité",
    );
  });

  it("returns undefined when the pair does not exist", () => {
    expect(findLegal(DOCUMENTS, "confidentialite", "en")).toBeUndefined();
    expect(findLegal([], "mentions", "fr")).toBeUndefined();
  });
});

describe("the revision date", () => {
  it("stores the calendar date in UTC, whatever the build machine's clock says", () => {
    // 23:30 in Paris on the 17th is already the 17th in UTC; 00:30 is not the 16th.
    expect(toCalendarDate(new Date("2026-09-17T00:00:00.000Z"))).toBe("2026-09-17");
    expect(toCalendarDate(new Date("2026-09-17T23:59:59.000Z"))).toBe("2026-09-17");
  });

  it("round-trips back to UTC midnight, so no formatter can shift the day", () => {
    const date = legalUpdatedAt(makeLegal({ updatedAt: "2026-09-17" }));
    expect(date.toISOString()).toBe("2026-09-17T00:00:00.000Z");
    expect(
      new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(date),
    ).toBe("17 septembre 2026");
  });
});

describe("LegalSourceSchema", () => {
  const valid = {
    title: "Mentions légales",
    summary: "Qui édite le site.",
    updatedAt: new Date("2026-09-17T00:00:00.000Z"),
    content: "## Éditeur",
  };

  it("accepts a Date from YAML and an ISO string from a quoted value", () => {
    expect(LegalSourceSchema.parse(valid).updatedAt).toEqual(valid.updatedAt);
    expect(LegalSourceSchema.parse({ ...valid, updatedAt: "2026-09-17" }).updatedAt).toEqual(
      valid.updatedAt,
    );
  });

  it("refuses an empty title, a missing date and an unknown field", () => {
    expect(() => LegalSourceSchema.parse({ ...valid, title: "  " })).toThrow();
    expect(() => LegalSourceSchema.parse({ ...valid, updatedAt: undefined })).toThrow();
    expect(() => LegalSourceSchema.parse({ ...valid, status: "stub" })).toThrow();
  });
});
