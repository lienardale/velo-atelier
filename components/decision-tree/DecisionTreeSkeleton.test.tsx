import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import enCommon from "@/messages/en/common.json";
import frCommon from "@/messages/fr/common.json";
import frTree from "@/messages/fr/decision-tree.json";
import enTree from "@/messages/en/decision-tree.json";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { DecisionTreeHero, DecisionTreeSkeleton } from "./DecisionTreeSkeleton";

describe("DecisionTreeHero", () => {
  it("is the page's real h1 and its intro paragraph", async () => {
    await renderWithIntl(<DecisionTreeHero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(frCommon.site.tagline);
    expect(screen.getByTestId("home-hero")).toHaveTextContent(frTree.home.intro);
  });

  it("speaks English", async () => {
    await renderWithIntl(<DecisionTreeHero />, { locale: "en" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(enCommon.site.tagline);
    expect(screen.getByTestId("home-hero")).toHaveTextContent(enTree.home.intro);
  });
});

describe("DecisionTreeSkeleton", () => {
  it("announces that the questions are loading", async () => {
    await renderWithIntl(<DecisionTreeSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent(frTree.tree.loading);
    expect(screen.getByTestId("decision-tree-skeleton")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("carries no heading: the h1 lives above the boundary this is the fallback of", async () => {
    // Load-bearing (.debug/005). React destroys this fallback's DOM when the
    // hydrated tree replaces it, and a re-created LCP element is reported by
    // Chrome as a second, much later LCP candidate. The page's <h1> and its
    // paragraph therefore belong to `DecisionTreeFrame`, outside the boundary.
    await renderWithIntl(<DecisionTreeSkeleton />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByTestId("home-hero")).toBeNull();
  });
});
