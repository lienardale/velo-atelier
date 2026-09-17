import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import enCommon from "@/messages/en/common.json";
import frCommon from "@/messages/fr/common.json";
import frTree from "@/messages/fr/decision-tree.json";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { DecisionTreeSkeleton } from "./DecisionTreeSkeleton";

describe("DecisionTreeSkeleton", () => {
  it("prerenders the page's real h1 and announces that the questions are loading", async () => {
    await renderWithIntl(<DecisionTreeSkeleton />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(frCommon.site.tagline);
    expect(screen.getByRole("status")).toHaveTextContent(frTree.tree.loading);
    expect(screen.getByTestId("decision-tree-skeleton")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("speaks English", async () => {
    await renderWithIntl(<DecisionTreeSkeleton />, { locale: "en" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(enCommon.site.tagline);
  });
});
