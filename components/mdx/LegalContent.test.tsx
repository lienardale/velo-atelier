/**
 * `LegalContent` — the frame both legal routes render.
 *
 * The compiled-MDX evaluator is replaced by a stand-in that renders the element
 * map it is handed, the way `GuideContent.test.tsx` does: what is under test is
 * that a legal document's plain markdown reaches the page with the elements it
 * uses styled, and that the `<article>` is labelled by its own `<h1>` so the
 * landmark is announced with the page's name.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LegalDocument } from "@/lib/content/legal";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { LegalContent } from "./LegalContent";

vi.mock("@content-collections/mdx/react", () => ({
  MDXContent: ({
    code,
    components,
  }: {
    code: string;
    components: Record<string, (props: Record<string, unknown>) => React.ReactNode>;
  }) => (
    <div data-code={code}>
      {components.h2({ children: "Éditeur du site" })}
      {components.p({ children: "velo-atelier est un projet personnel." })}
      {components.ul({ children: components.li?.({ children: "MIT" }) ?? null })}
      {components.a({ href: "/fr/confidentialite", children: "confidentialité" })}
      {components.code({ children: "va:" })}
    </div>
  ),
}));

const DOCUMENT: LegalDocument = {
  id: "mentions",
  locale: "fr",
  title: "Mentions légales",
  summary: "Qui édite le site.",
  updatedAt: "2026-09-17",
  mdx: "compiled-legal",
};

describe("LegalContent", () => {
  it("renders the title, the revision date and the compiled body", async () => {
    const { container } = await renderWithIntl(
      <LegalContent
        document={DOCUMENT}
        headingId="legal-notice-title"
        updatedLabel="Dernière mise à jour : 17 septembre 2026"
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Mentions légales" })).toBeInTheDocument();
    expect(screen.getByText("Dernière mise à jour : 17 septembre 2026")).toBeInTheDocument();
    expect(container.querySelector("[data-code=compiled-legal]")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Éditeur du site" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "confidentialité" })).toHaveAttribute(
      "href",
      "/fr/confidentialite",
    );
  });

  it("labels the article with its heading and carries a machine-readable date", async () => {
    const { container } = await renderWithIntl(
      <LegalContent document={DOCUMENT} headingId="legal-notice-title" updatedLabel="MAJ" />,
    );

    expect(screen.getByRole("article", { name: "Mentions légales" })).toBeInTheDocument();
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-09-17");
  });
});
