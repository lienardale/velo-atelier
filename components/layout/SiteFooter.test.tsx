import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";

import { REPOSITORY_URL, SiteFooter } from "./SiteFooter";

describe("SiteFooter", () => {
  it("is the contentinfo landmark, hidden from print", async () => {
    await renderWithIntl(<SiteFooter />);
    expect(screen.getByRole("contentinfo")).toHaveAttribute("data-site-footer");
  });

  it("links the legal notice, the privacy page and the source code", async () => {
    await renderWithIntl(<SiteFooter />);
    const nav = screen.getByRole("navigation", { name: "Informations sur le site" });
    expect(within(nav).getByRole("link", { name: "Mentions légales" })).toHaveAttribute(
      "href",
      "/mentions-legales",
    );
    expect(within(nav).getByRole("link", { name: "Confidentialité" })).toHaveAttribute(
      "href",
      "/confidentialite",
    );
  });

  it("opens GitHub in a new tab, says so, and leaks no referrer or opener", async () => {
    await renderWithIntl(<SiteFooter />);
    const github = screen.getByRole("link", {
      name: "Code source sur GitHub (s’ouvre dans un nouvel onglet)",
    });
    expect(github).toHaveAttribute("href", REPOSITORY_URL);
    expect(REPOSITORY_URL).toBe("https://github.com/lienardale/velo-atelier");
    expect(github).toHaveAttribute("target", "_blank");
    expect(github).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows the licences and a locale switcher", async () => {
    await renderWithIntl(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("Code sous licence MIT · guides sous licence CC BY-SA 4.0");
    expect(within(footer).getByRole("group", { name: "Langue du site" })).toBeInTheDocument();
  });

  it("gives every link a 44 px tap height", async () => {
    await renderWithIntl(<SiteFooter />);
    for (const link of within(screen.getByRole("contentinfo")).getAllByRole("link")) {
      expect(link.className).toContain("min-h-[var(--tap-min)]");
    }
  });

  it("is translated", async () => {
    await renderWithIntl(<SiteFooter />, { locale: "en" });
    const nav = screen.getByRole("navigation", { name: "About this site" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Legal notice", "Privacy", "Source code on GitHub (opens in a new tab)"]);
  });
});
