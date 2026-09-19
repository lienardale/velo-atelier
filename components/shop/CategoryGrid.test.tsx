/**
 * The grid of `/acheter` (§5.5).
 *
 * The YAML's own structure is held by
 * `tests/unit/content/parts-legal-shop.test.ts` and by
 * `lib/shop/retailers.test.ts`. What is checked here is what the card DOES: it
 * opens the part panel, and it links to the three shops with the category's own
 * search text.
 */
import { screen } from "@testing-library/react";
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

  // Eleven cards × three shops, walked in plain JS and asserted ONCE
  // (`.debug/009`). The obvious spelling — `within(node).getAllByRole("link")`
  // per card — TIMED OUT at the 5 s budget under `vitest --coverage`, the tier
  // CI actually runs, while its five siblings in this file each cost ~0.3 s in
  // the same process: `getAllByRole` recomputes the accessibility tree on every
  // call and v8 instruments each one. A plain `a[href]` query is the same set
  // here (every anchor this component renders carries an href) and brought the
  // test to ~0.3 s. Measure this file with `--coverage`; a plain `vitest run`
  // finishes the whole suite in 3 s and shows none of it.
  //
  // Collecting the mismatches rather than asserting inside the loop is the
  // other half of `.debug/009`: the old spelling stopped at the first bad card,
  // this one names all eleven.
  it("links every card to its three shops with its own search text", async () => {
    const { container } = await renderWithIntl(<CategoryGrid categories={cards} locale="fr" />);

    const wrongCount: string[] = [];
    const wrongHref: string[] = [];
    for (const card of cards) {
      const node = container.querySelector(`div[data-category="${card.id}"]`);
      if (node === null) {
        wrongCount.push(`${card.id}: not rendered`);
        continue;
      }
      // The title plus one button per retailer.
      const links = node.querySelectorAll("a[href]").length;
      if (links !== 1 + card.retailers.length) {
        wrongCount.push(`${card.id}: ${links} links, expected ${1 + card.retailers.length}`);
      }
      for (const retailer of card.retailers) {
        const href = node.querySelector(`a[data-retailer="${retailer}"]`)?.getAttribute("href");
        const want = outboundUrl(retailer, "fr", card.query, card.partId);
        if (href !== want) wrongHref.push(`${card.id}/${retailer}: ${href ?? "missing"} ≠ ${want}`);
      }
    }

    expect({ wrongCount, wrongHref }).toEqual({ wrongCount: [], wrongHref: [] });
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
