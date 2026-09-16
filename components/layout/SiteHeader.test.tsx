import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";

import { SiteHeader } from "./SiteHeader";

// The header renders `<AccountMenu>` (W1-T3), whose sign-out button imports the
// connexion server actions. In the browser those are a network reference, not
// code; in a jsdom test the module is really evaluated, and it pulls in
// `server-only` (which only Next's bundler can resolve) and `next-auth/lib/env.js`
// (which imports `next/server`, a specifier Node cannot resolve because `next`'s
// package.json has no `exports` map — next-auth's own source carries a
// `@ts-expect-error` about it). Stubbing the action module is the browser's view.
vi.mock("@/app/[locale]/(auth)/connexion/actions", () => ({
  loginAction: vi.fn(),
  googleSignInAction: vi.fn(),
  signOutAction: vi.fn(async () => ({ ok: true, data: true })),
}));

// `useSession()` needs a `<SessionProvider>`, and a real one would fetch
// `/api/auth/session` — which msw refuses (`onUnhandledRequest: 'error'`).
// The header's own tests are about the header; `AccountMenu.test.tsx` is where
// both session states are exercised.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

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
