import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Step } from "@/components/mdx/Step";
import { makeStep } from "@/tests/_helpers/checkup";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { StepCard } from "./StepCard";

const STEP = makeStep();

/** A guide's compiled tree, as the server hands it down: every step at once. */
const GUIDE = (
  <>
    <Step id="pad-wear" title="Mesurer l’usure des plaquettes" number={1}>
      <p>Regardez dans la fente de l’étrier.</p>
    </Step>
    <Step id="rotor-true" title="Vérifier les disques" number={2}>
      <p>Faites tourner la roue.</p>
    </Step>
  </>
);

const labelOf = (toolId: string): string =>
  toolId === "chain-checker" ? "Contrôleur d'usure de chaîne" : "Réglet métallique";

describe("StepCard", () => {
  it("shows ONE step of the guide it was handed — the §5.2 StepScope contract", async () => {
    await renderWithIntl(
      <StepCard
        step={STEP}
        index={0}
        total={12}
        guideNode={GUIDE}
        substitutions={[]}
        labelOf={labelOf}
      />,
    );

    expect(screen.getByText("Regardez dans la fente de l’étrier.")).toBeInTheDocument();
    expect(screen.queryByText("Faites tourner la roue.")).not.toBeInTheDocument();
  });

  it("says where the visitor is, once", async () => {
    await renderWithIntl(
      <StepCard
        step={STEP}
        index={3}
        total={12}
        guideNode={GUIDE}
        substitutions={[]}
        labelOf={labelOf}
      />,
    );

    expect(screen.getByRole("progressbar", { name: "Étape 4 sur 12" })).toBeInTheDocument();
    expect(screen.getByText("4/12")).toBeInTheDocument();
  });

  it("offers the stand-in for a tool the visitor does not have, and admits when there is none", async () => {
    const { rerender } = await renderWithIntl(
      <StepCard
        step={STEP}
        index={0}
        total={1}
        guideNode={GUIDE}
        substitutions={[{ toolId: "chain-checker", alternatives: ["steel-ruler"] }]}
        labelOf={labelOf}
      />,
    );
    expect(screen.getByTestId("tool-substitution")).toHaveTextContent("Réglet métallique");

    rerender(
      <StepCard
        step={STEP}
        index={0}
        total={1}
        guideNode={GUIDE}
        substitutions={[{ toolId: "chain-checker", alternatives: [] }]}
        labelOf={labelOf}
      />,
    );
    expect(screen.getByTestId("tool-substitution")).toHaveTextContent("pas de remplaçant possible");
  });

  it("badges a step whose guide is still a stub", async () => {
    const { rerender } = await renderWithIntl(
      <StepCard
        step={STEP}
        index={0}
        total={1}
        guideNode={GUIDE}
        substitutions={[]}
        labelOf={labelOf}
      />,
    );
    expect(screen.queryByTestId("step-stub-badge")).not.toBeInTheDocument();

    rerender(
      <StepCard
        step={{ ...STEP, stub: true }}
        index={0}
        total={1}
        guideNode={GUIDE}
        substitutions={[]}
        labelOf={labelOf}
      />,
    );
    expect(screen.getByTestId("step-stub-badge")).toBeInTheDocument();
  });

  it("links the whole guide, and survives a guide that is missing", async () => {
    await renderWithIntl(
      <StepCard
        step={STEP}
        index={0}
        total={1}
        guideNode={null}
        substitutions={[]}
        labelOf={labelOf}
      />,
    );

    expect(screen.getByTestId("step-guide-link")).toHaveAttribute(
      "href",
      "/guides/check-brakes-disc",
    );
    expect(screen.getByTestId("step-body")).toBeEmptyDOMElement();
  });
});
