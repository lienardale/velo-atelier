/**
 * `lib/content/collection.ts` is the one import of the content-collections
 * output. The generated module is replaced here (it only exists after a build),
 * so this pins the contract: the pages get exactly the generated documents.
 */
import { describe, expect, it, vi } from "vitest";

import type { LegalDocument } from "@/lib/content/legal";
import { makeGuide } from "@/tests/_helpers/guides";

const documents = vi.hoisted(() => [] as unknown[]);
const legalDocuments = vi.hoisted(() => [] as unknown[]);

vi.mock("content-collections", () => ({
  allGuides: documents,
  allLegalPages: legalDocuments,
}));

const MENTIONS: LegalDocument = {
  id: "mentions",
  locale: "fr",
  title: "Mentions légales",
  summary: "Qui édite le site.",
  updatedAt: "2026-09-17",
  mdx: "compiled",
};

describe("GUIDES", () => {
  it("is the generated allGuides array", async () => {
    documents.push(makeGuide());
    const { GUIDES } = await import("@/lib/content/collection");
    expect(GUIDES).toBe(documents);
    expect(GUIDES[0].slug).toBe("clean-chain");
  });
});

describe("LEGAL", () => {
  it("is the generated allLegalPages array", async () => {
    legalDocuments.push(MENTIONS);
    const { LEGAL } = await import("@/lib/content/collection");
    expect(LEGAL).toBe(legalDocuments);
    expect(LEGAL[0].id).toBe("mentions");
  });
});
