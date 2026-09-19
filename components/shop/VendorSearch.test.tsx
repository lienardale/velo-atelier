/**
 * The free-text box of `/acheter` (§5.5).
 *
 * It has no form and no request: what it produces is three hrefs. So what is
 * worth pinning is that the links follow what is typed, that a paste is cleaned
 * before it becomes a URL, and that an empty box offers no link at all rather
 * than three links to a search for nothing.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { outboundUrl } from "@/lib/shop/outbound";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { VendorSearch } from "./VendorSearch";

describe("<VendorSearch>", () => {
  it("offers no link until something is typed", async () => {
    await renderWithIntl(<VendorSearch locale="fr" />);
    expect(screen.getByTestId("vendor-search-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("vendor-search-links")).not.toBeInTheDocument();
  });

  it("points the three shops at what was typed", async () => {
    const { user } = await renderWithIntl(<VendorSearch locale="fr" />);
    await user.type(screen.getByTestId("vendor-search-input"), "chaîne 11 vitesses");

    expect(screen.getByTestId("vendor-search-rosebikes")).toHaveAttribute(
      "href",
      outboundUrl("rosebikes", "fr", "chaîne 11 vitesses"),
    );
    expect(screen.getByTestId("vendor-search-decathlon")).toHaveAttribute(
      "href",
      "https://www.decathlon.fr/search?Ntt=cha%C3%AEne%2011%20vitesses",
    );
  });

  it("links to the English shops on the English page", async () => {
    await renderWithIntl(<VendorSearch locale="en" defaultQuery="chain 11 speed" />);
    expect(screen.getByTestId("vendor-search-rosebikes")).toHaveAttribute(
      "href",
      "https://www.rosebikes.com/search?q=chain%2011%20speed",
    );
  });

  it("cleans a paste before it becomes a URL", async () => {
    await renderWithIntl(
      <VendorSearch locale="fr" defaultQuery={"  chaîne \n\t 11   vitesses  "} />,
    );
    expect(screen.getByTestId("vendor-search-rosebikes")).toHaveAttribute(
      "href",
      outboundUrl("rosebikes", "fr", "chaîne 11 vitesses"),
    );
  });

  it("treats whitespace alone as nothing typed", async () => {
    await renderWithIntl(<VendorSearch locale="fr" defaultQuery="    " />);
    expect(screen.getByTestId("vendor-search-empty")).toBeInTheDocument();
  });

  it("gives the field a label and a 16 px font, so iOS does not zoom (§6.8 AC5)", async () => {
    await renderWithIntl(<VendorSearch locale="fr" />);
    const input = screen.getByLabelText("Que cherchez-vous ?");
    expect(input).toBe(screen.getByTestId("vendor-search-input"));
    expect(input.className).toContain("text-base");
    expect(input.className).toContain("min-h-[var(--tap-min)]");
  });
});
