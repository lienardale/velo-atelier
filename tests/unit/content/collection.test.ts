/**
 * `lib/content/collection.ts` is the one import of the content-collections
 * output. The generated module is replaced here (it only exists after a build),
 * so this pins the contract: the pages get exactly the generated documents.
 */
import { describe, expect, it, vi } from "vitest";

import { makeGuide } from "@/tests/_helpers/guides";

const documents = vi.hoisted(() => [] as unknown[]);

vi.mock("content-collections", () => ({ allGuides: documents }));

describe("GUIDES", () => {
  it("is the generated allGuides array", async () => {
    documents.push(makeGuide());
    const { GUIDES } = await import("@/lib/content/collection");
    expect(GUIDES).toBe(documents);
    expect(GUIDES[0].slug).toBe("clean-chain");
  });
});
