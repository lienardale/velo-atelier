/**
 * The guide page's metadata (§5.7): a stub guide is published for readers but
 * kept out of search results — `robots: noindex, nofollow` — while a full
 * guide is indexed.
 *
 * Proved on a SYNTHETIC stub (`STUB_SLUG`, both locales) beside the guides on
 * disk: every guide of the corpus is full, so the browser checks of a stub
 * page (`tests/e2e/seo.spec.ts`, `tests/e2e/guides.spec.ts`) skip themselves
 * for want of one. Setting `index: true` in `generateMetadata` fails the stub
 * case here.
 */
import { describe, expect, it, vi } from "vitest";

const { STUB_SLUG } = vi.hoisted(() => ({ STUB_SLUG: "replace-metadata-stub-fixture" }));

vi.mock("content-collections", async () => {
  const { diskGuides, makeGuide } = await import("@/tests/_helpers/guides");
  return {
    allGuides: [
      ...diskGuides(),
      ...(["fr", "en"] as const).map((locale) =>
        makeGuide({ slug: STUB_SLUG, kind: "replace", status: "stub", locale, title: "Stub" }),
      ),
    ],
    allLegalPages: [],
  };
});

vi.mock("@/lib/i18n/navigation", async () => ({
  getPathname: (await import("@/tests/_fakes/routes")).localizingGetPathname,
}));

const { generateMetadata } = await import("@/app/[locale]/guides/[slug]/page");
const { GUIDES } = await import("@/lib/content/collection");

const metadataFor = (locale: string, slug: string) =>
  generateMetadata({ params: Promise.resolve({ locale, slug }) });

const aFullGuide = GUIDES.find((guide) => guide.status === "full")?.slug;

describe("guide page metadata", () => {
  it.each(["fr", "en"])("keeps a stub guide out of search results (%s)", async (locale) => {
    const metadata = await metadataFor(locale, STUB_SLUG);
    expect(metadata.title).toBe("Stub");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it.each(["fr", "en"])("indexes a full guide (%s)", async (locale) => {
    expect(aFullGuide).toBeDefined();
    const metadata = await metadataFor(locale, aFullGuide!);
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });
});
