import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";
import { makeGuide, readGuide } from "@/tests/_helpers/guides";

import { AppliesToBanner, describeAppliesTo } from "./AppliesToBanner";
import { GuideGrid } from "./GuideCard";
import { GuideLayout } from "./GuideLayout";
import { PrevNext } from "./PrevNext";
import { ToolsList } from "./ToolsList";

describe("GuideLayout", () => {
  it("lays out a real guide: header, safety, bikes, tools, steps, related, neighbours", async () => {
    const guide = readGuide("check-brakes-disc", "fr");
    const related = [readGuide("replace-brake-pads-disc", "fr")];
    await renderWithIntl(
      <GuideLayout
        guide={guide}
        related={related}
        previous={null}
        next={{ slug: "clean-chain", title: "Nettoyer et lubrifier la chaîne" }}
      >
        <p>STEPS</p>
      </GuideLayout>,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Contrôler des freins à disque",
    );
    expect(screen.getByText("Contrôler", { selector: "[data-kind]" })).toBeInTheDocument();
    expect(screen.getByTestId("guide-difficulty")).toHaveTextContent("Facile");
    expect(screen.getByTestId("guide-duration")).toHaveTextContent("15 minutes");
    expect(screen.getByTestId("safety-notes").querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByTestId("applies-to")).toHaveTextContent("Freins à disque : oui");
    expect(within(screen.getByTestId("tools-list")).getByText("Clés Allen")).toBeInTheDocument();
    expect(within(screen.getByTestId("guide-steps")).getByText("STEPS")).toBeInTheDocument();
    expect(screen.getByTestId("guide-toc")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-banner")).toBeNull();

    const relatedSection = screen.getByRole("region", { name: "À lire ensuite" });
    expect(within(relatedSection).getByRole("link", { name: related[0].title })).toHaveAttribute(
      "href",
      expect.stringContaining("replace-brake-pads-disc"),
    );
    const neighbours = screen.getByRole("navigation", { name: "Autres guides" });
    expect(within(neighbours).getByRole("link")).toHaveAttribute("rel", "next");
    expect(screen.getByRole("link", { name: "Voir sur mon vélo" })).toBeInTheDocument();
  });

  it("shows the stub banner, and no safety or related section when there is none", async () => {
    await renderWithIntl(
      <GuideLayout
        guide={makeGuide({ status: "stub" })}
        related={[]}
        previous={{ slug: "check-a", title: "A" }}
        next={null}
      >
        <p>STEPS</p>
      </GuideLayout>,
      { locale: "en" },
    );
    expect(screen.getByTestId("stub-banner")).toHaveTextContent("still being written");
    expect(screen.queryByTestId("safety-notes")).toBeNull();
    expect(screen.queryByRole("region", { name: "Read next" })).toBeNull();
    expect(screen.getByTestId("applies-to")).toHaveTextContent("Every bike.");
    expect(screen.getByTestId("tools-list")).toHaveTextContent("No tools");
    expect(screen.getByRole("link", { name: /Previous guide/ })).toHaveAttribute("rel", "prev");
  });
});

describe("AppliesToBanner", () => {
  it("describes nested conditions in words", async () => {
    await renderWithIntl(
      <AppliesToBanner
        appliesTo={{
          all: [
            { path: "brakes.type", in: ["disc-hydraulic", "disc-mechanical"] },
            {
              any: [
                { path: "drivetrain.speeds", notIn: [12] },
                { not: { path: "drive", in: ["electric"] } },
              ],
            },
          ],
        }}
      />,
      { locale: "en" },
    );
    expect(screen.getByTestId("applies-to")).toHaveTextContent(
      "Brakes: hydraulic disc, mechanical disc and Speeds: anything but 12 or unless Drive: e-bike",
    );
  });

  it("describeAppliesTo joins with the translator it is given", () => {
    const t = (key: string, values?: Record<string, string>) =>
      `${key}${values ? JSON.stringify(values) : ""}`;
    expect(
      describeAppliesTo(
        {
          kind: "leaf",
          pathKey: "pedals",
          negated: false,
          values: [{ key: "flat", raw: "flat", numeric: false }],
        },
        t,
      ),
    ).toBe(
      'appliesTo.leaf{"label":"appliesTo.paths.pedals","values":"appliesTo.values.pedals.flat"}',
    );
  });
});

describe("ToolsList, GuideGrid, PrevNext", () => {
  it("lists alternatives joined by the separator, with an h3 when nested", async () => {
    await renderWithIntl(
      <ToolsList
        headingLevel={3}
        tools={[{ toolId: "chain-checker", alternatives: ["steel-ruler", "tape-measure"] }]}
      />,
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Outils nécessaires");
    expect(screen.getByTestId("tool-alternatives")).toHaveTextContent(
      "À défaut : Réglet métallique ou Mètre ruban",
    );
  });

  it("renders one card per guide", async () => {
    await renderWithIntl(
      <GuideGrid
        guides={[makeGuide(), makeGuide({ slug: "check-x", kind: "check", difficulty: 3 })]}
      />,
    );
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getAllByRole("article")[1]).toHaveTextContent("Avancé");
  });

  it("renders nothing without neighbours", async () => {
    const { container } = await renderWithIntl(<PrevNext previous={null} next={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
