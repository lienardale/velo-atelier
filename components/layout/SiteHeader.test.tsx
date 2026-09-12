import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";

import { SiteHeader } from "./SiteHeader";

describe("SiteHeader", () => {
  it("is the sticky banner, hidden from print", async () => {
    await renderWithIntl(<SiteHeader />);
    const header = screen.getByRole("banner");
    expect(header).toHaveAttribute("data-site-header");
    expect(header).toHaveClass("sticky", "h-[var(--header-h)]");
  });

  it("links the logo home with a name that contains its visible text", async () => {
    await renderWithIntl(<SiteHeader />);
    const home = screen.getByRole("link", { name: "vélo-atelier — accueil" });
    expect(home).toHaveAttribute("href", "/");
    expect(home).toHaveTextContent("vélo-atelier");
  });

  it("offers Guides, Acheter and Mon vélo in the main navigation (≥ lg)", async () => {
    await renderWithIntl(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(nav).toHaveClass("hidden", "lg:block");
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Guides", "/guides"],
      ["Acheter", "/acheter"],
      ["Mon vélo", "/velo/demo"],
    ]);
    for (const link of links) expect(link).toHaveClass("tap-target");
  });

  it("puts the same destinations, plus Accueil, in the mobile sheet (< lg)", async () => {
    const { container } = await renderWithIntl(<SiteHeader />);
    expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toHaveClass("lg:hidden");
    const sheet = container.querySelector("dialog") as HTMLDialogElement;
    const links = within(sheet).getAllByRole("link", { hidden: true });
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Accueil", "/"],
      ["Guides", "/guides"],
      ["Acheter", "/acheter"],
      ["Mon vélo", "/velo/demo"],
    ]);
  });

  it("always shows the locale switcher", async () => {
    await renderWithIntl(<SiteHeader />);
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("group", { name: "Langue du site" })).toBeInTheDocument();
  });

  it("is translated", async () => {
    await renderWithIntl(<SiteHeader />, { locale: "en" });
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Guides", "Shop", "My bike"]);
    expect(screen.getByRole("link", { name: "vélo-atelier — home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open the menu" })).toBeInTheDocument();
  });
});
