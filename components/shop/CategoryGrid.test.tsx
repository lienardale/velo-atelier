/**
 * The grid of `/acheter` (§5.5).
 *
 * The YAML's own structure is held by
 * `tests/unit/content/parts-legal-shop.test.ts` and by
 * `lib/shop/retailers.test.ts`. What is checked here is what the card DOES: it
 * opens the part panel, and it links to the three shops with the category's own
 * search text.
 */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SHOP_CATEGORIES } from "@/lib/shop/retailers";
import { outboundUrl } from "@/lib/shop/outbound";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { CategoryGrid, type CategoryCard } from "./CategoryGrid";

/** The real categories, as `/acheter` hands them over: one locale, flat strings. */
const cards: CategoryCard[] = SHOP_CATEGORIES.map((category) => ({
  id: category.id,
  label: category.label.fr,
  hint: category.hint.fr,
  query: category.query.fr,
  partId: category.partIds[0],
  retailers: category.retailers,
}));

describe("<CategoryGrid>", () => {
  it("renders one card per category, in the file's order", async () => {
    const { container } = await renderWithIntl(<CategoryGrid categories={cards} locale="fr" />);
    const rendered = [...container.querySelectorAll("[data-category]")]
      .filter((node) => node.tagName === "DIV")
      .map((node) => node.getAttribute("data-category"));
    expect(rendered).toEqual(cards.map((card) => card.id));
  });

  it("opens the part panel from the card's title", async () => {
    // `tests/setup.ts` mocks `@/lib/i18n/navigation` with a `Link` that renders
    // the INTERNAL pathname and drops the query (it is a mock, not the router).
    // That the URL really carries `?part=` — and that `/acheter` is `/shop` in
    // English — is asserted against the running app in tests/e2e/shop.spec.ts.
    await renderWithIntl(<CategoryGrid categories={cards} locale="fr" />);
    expect(screen.getByTestId("category-link-chains")).toHaveAttribute("href", "/acheter");
  });

  it("links every card to its three shops with its own search text", async () => {
    const { container } = await renderWithIntl(<CategoryGrid categories={cards} locale="fr" />);
    for (const card of cards) {
      const node = container.querySelector(`div[data-category="${card.id}"]`) as HTMLElement;
      const links = within(node).getAllByRole("link");
      // The title plus one button per retailer.
      expect(links, card.id).toHaveLength(1 + card.retailers.length);
      for (const retailer of card.retailers) {
        const button = node.querySelector(`a[data-retailer="${retailer}"]`);
        expect(button, `${card.id}/${retailer}`).toHaveAttribute(
          "href",
          outboundUrl(retailer, "fr", card.query, card.partId),
        );
      }
    }
  });

  it("uses the English shops and the English wording on the English page", async () => {
    const english = SHOP_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label.en,
      hint: category.hint.en,
      query: category.query.en,
      partId: category.partIds[0],
      retailers: category.retailers,
    }));
    const { container } = await renderWithIntl(<CategoryGrid categories={english} locale="en" />, {
      locale: "en",
    });
    expect(screen.getByTestId("category-link-chains")).toHaveTextContent("Chains");
    const rose = container.querySelector(
      'div[data-category="chains"] a[data-retailer="rosebikes"]',
    );
    expect(rose).toHaveAttribute("href", "https://www.rosebikes.com/search?q=bike%20chain");
  });

  it("falls back to the three shops for a card that names none", async () => {
    const orphan = [{ ...cards[0], id: "orphan", retailers: [] }];
    const { container } = await renderWithIntl(<CategoryGrid categories={orphan} locale="fr" />);
    const node = container.querySelector('div[data-category="orphan"]') as HTMLElement;
    for (const retailer of ["rosebikes", "alltricks", "decathlon"]) {
      expect(node.querySelector(`a[data-retailer="${retailer}"]`), retailer).not.toBeNull();
    }
  });

  it("marks each card so the print sheet keeps it in one piece", async () => {
    const { container } = await renderWithIntl(<CategoryGrid categories={cards} locale="fr" />);
    expect(container.querySelectorAll("[data-print-card]")).toHaveLength(cards.length);
  });
});
