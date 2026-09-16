import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GuideToc } from "@/components/guides/GuideToc";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { Step, stepAnchor } from "./Step";
import { StepScope, useActiveStepId } from "./StepScope";

function Steps() {
  return (
    <>
      <GuideToc
        entries={[
          { id: "pad-wear", title: "Mesurer l’usure" },
          { id: "rotor-true", title: "Vérifier les disques" },
        ]}
      />
      <Step id="pad-wear" title="Mesurer l’usure" number={1} illustration={<p>dessin</p>}>
        <p>Corps 1</p>
      </Step>
      <Step id="rotor-true" title="Vérifier les disques" number={2}>
        <p>Corps 2</p>
      </Step>
    </>
  );
}

function ActiveId() {
  return <output>{useActiveStepId() ?? "all"}</output>;
}

describe("Step + StepScope (the wizard contract, §5.2)", () => {
  it("renders every step and the table of contents without a scope", async () => {
    await renderWithIntl(<Steps />);
    expect(screen.getAllByRole("region")).toHaveLength(2);
    const first = screen.getByRole("region", { name: /Étape 1\s*Mesurer l’usure/ });
    expect(first).toHaveAttribute("id", stepAnchor("pad-wear"));
    expect(first).toHaveAttribute("data-step-id", "pad-wear");
    expect(within(first).getByText("dessin")).toBeInTheDocument();
    expect(screen.getByTestId("guide-toc")).toBeInTheDocument();
    const links = within(screen.getByTestId("guide-toc")).getAllByRole("link", { hidden: true });
    expect(links[0]).toHaveAttribute("href", "#step-pad-wear");
  });

  it("with an active step, renders only that step and no table of contents", async () => {
    await renderWithIntl(
      <StepScope activeStepId="rotor-true">
        <Steps />
        <ActiveId />
      </StepScope>,
    );
    expect(screen.queryByText("Corps 1")).not.toBeInTheDocument();
    expect(screen.getByText("Corps 2")).toBeInTheDocument();
    expect(screen.queryByTestId("guide-toc")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("rotor-true");
  });

  it("an explicit null scope shows everything, in English too", async () => {
    await renderWithIntl(
      <StepScope activeStepId={null}>
        <Steps />
        <ActiveId />
      </StepScope>,
      { locale: "en" },
    );
    expect(
      screen.getByRole("heading", { name: /Step 2\s*Vérifier les disques/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("all");
  });

  it("renders no table of contents for a guide without steps", async () => {
    const { container } = await renderWithIntl(<GuideToc entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
