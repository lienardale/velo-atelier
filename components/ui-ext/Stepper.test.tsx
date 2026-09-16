import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Stepper } from "./Stepper";

describe("Stepper", () => {
  it("is a single progressbar named by the caller's localized sentence", () => {
    render(<Stepper current={4} total={12} label="Étape 4 sur 12" />);
    const bar = screen.getByRole("progressbar", { name: "Étape 4 sur 12" });
    expect(bar).toHaveAttribute("aria-valuenow", "4");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "12");
    expect(bar).toHaveAttribute("aria-valuetext", "Étape 4 sur 12");
    // One announcement, not three: the counter and title beside it are decorative.
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  });

  it("fills the bar to the step's share of the tree", () => {
    const { container } = render(<Stepper current={3} total={12} label="…" />);
    expect(container.querySelector("[data-slot=stepper-bar-fill]")).toHaveStyle({ width: "25%" });
  });

  it("shows the counter, and the step title when there is one", () => {
    const { rerender } = render(<Stepper current={4} total={12} label="Étape 4 sur 12" />);
    expect(screen.getByText("4/12")).toBeInTheDocument();
    expect(screen.queryByText("Frein avant")).not.toBeInTheDocument();

    rerender(<Stepper current={4} total={12} label="Étape 4 sur 12" title="Frein avant" />);
    expect(screen.getByText("Frein avant")).toBeInTheDocument();
  });

  it("lets a locale override the visible counter", () => {
    render(<Stepper current={2} total={5} label="Step 2 of 5" countLabel="2 of 5" />);
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
    expect(screen.queryByText("2/5")).not.toBeInTheDocument();
  });

  it("exposes the raw numbers for the e2e suite", () => {
    const { container } = render(<Stepper current={3} total={9} label="Étape 3 sur 9" />);
    const root = container.querySelector("[data-slot=stepper]");
    expect(root).toHaveAttribute("data-step", "3");
    expect(root).toHaveAttribute("data-total", "9");
  });

  it("clamps a step outside the tree instead of overflowing the bar", () => {
    const { container, rerender } = render(<Stepper current={99} total={12} label="…" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "12");
    expect(container.querySelector("[data-slot=stepper-bar-fill]")).toHaveStyle({ width: "100%" });
    expect(screen.getByText("12/12")).toBeInTheDocument();

    rerender(<Stepper current={-4} total={12} label="…" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("0/12")).toBeInTheDocument();
  });

  it("reads as complete, not NaN, when there is no step left to take", () => {
    const { container } = render(<Stepper current={0} total={0} label="Terminé" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    // aria-valuemax must never equal aria-valuemin, or the range is meaningless.
    expect(bar).toHaveAttribute("aria-valuemax", "1");
    expect(container.querySelector("[data-slot=stepper-bar-fill]")).toHaveStyle({ width: "100%" });
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });

  it("passes className and DOM props through to the root", () => {
    const { container } = render(
      <Stepper current={1} total={3} label="…" className="mb-4" data-testid="wizard-stepper" />,
    );
    const root = container.querySelector("[data-slot=stepper]");
    expect(root).toHaveClass("mb-4");
    expect(root).toHaveAttribute("data-testid", "wizard-stepper");
  });
});
