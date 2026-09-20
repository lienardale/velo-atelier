/* eslint-disable security/detect-object-injection -- lookups into the test's own label tables */
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ToolRef } from "@/lib/checkup/types";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { ToolChecklist } from "./ToolChecklist";

const LABELS: Record<string, string> = {
  "chain-checker": "Contrôleur d'usure de chaîne",
  "steel-ruler": "Réglet métallique",
  "chain-whip": "Fouet à chaîne",
};

const TOOLS: ToolRef[] = [
  { toolId: "chain-checker", alternatives: ["steel-ruler"] },
  { toolId: "chain-whip", alternatives: [] },
];

const labelOf = (toolId: string): string => LABELS[toolId] ?? toolId;

describe("ToolChecklist", () => {
  it("lists the plan's tools as checkboxes named by the tool", async () => {
    await renderWithIntl(
      <ToolChecklist tools={TOOLS} missing={[]} onToggle={vi.fn()} labelOf={labelOf} />,
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(
      screen.getByRole("checkbox", { name: /Contrôleur d'usure de chaîne/ }),
    ).not.toBeChecked();
  });

  it("offers the stand-in once a tool is ticked, and says when there is none", async () => {
    const { rerender } = await renderWithIntl(
      <ToolChecklist
        tools={TOOLS}
        missing={["chain-checker"]}
        onToggle={vi.fn()}
        labelOf={labelOf}
      />,
    );

    expect(screen.getByTestId("tool-alternative-chain-checker")).toHaveTextContent(
      "À défaut : Réglet métallique",
    );
    expect(screen.queryByTestId("tool-alternative-chain-whip")).not.toBeInTheDocument();

    rerender(
      <ToolChecklist
        tools={TOOLS}
        missing={["chain-checker", "chain-whip"]}
        onToggle={vi.fn()}
        labelOf={labelOf}
      />,
    );
    expect(screen.getByTestId("tool-alternative-chain-whip")).toHaveTextContent(
      "Pas de remplaçant",
    );
  });

  it("reports the tool the visitor says they do not have", async () => {
    const onToggle = vi.fn();
    const { user } = await renderWithIntl(
      <ToolChecklist tools={TOOLS} missing={[]} onToggle={onToggle} labelOf={labelOf} />,
    );

    await user.click(screen.getByTestId("tool-missing-chain-checker"));
    expect(onToggle).toHaveBeenCalledWith("chain-checker", true);
  });

  it("says so plainly when the checkup needs no tools at all", async () => {
    await renderWithIntl(
      <ToolChecklist tools={[]} missing={[]} onToggle={vi.fn()} labelOf={labelOf} />,
    );

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      within(screen.getByTestId("tool-checklist")).getByText("Ce contrôle ne demande aucun outil."),
    ).toBeInTheDocument();
  });
});
