import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Callout, type CalloutTone } from "./Callout";

const TONES: readonly CalloutTone[] = ["info", "warning", "danger", "success"];

describe("Callout", () => {
  it("renders its body, and defaults to the neutral info tone", () => {
    const { container } = render(<Callout>Le vélo de démo est en lecture seule.</Callout>);
    expect(screen.getByText("Le vélo de démo est en lecture seule.")).toBeInTheDocument();
    expect(container.querySelector("[data-slot=callout]")).toHaveAttribute("data-tone", "info");
  });

  it("shows the optional title above the body", () => {
    render(
      <Callout tone="warning" title="Incompatible">
        <p>Cette cassette ne passe pas sur ce dérailleur.</p>
      </Callout>,
    );
    expect(screen.getByText("Incompatible")).toBeInTheDocument();
    expect(screen.getByText("Cette cassette ne passe pas sur ce dérailleur.")).toBeInTheDocument();
  });

  it.each(TONES)("dresses the %s tone with its own token and icon", (tone) => {
    const { container } = render(<Callout tone={tone}>texte</Callout>);
    const root = container.querySelector("[data-slot=callout]");
    expect(root).toHaveAttribute("data-tone", tone);
    // The icon is decoration: the tone must also be readable from the words.
    const icon = container.querySelector("[data-slot=callout-icon]");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon?.querySelector("svg")).toBeTruthy();
  });

  it("accepts a custom icon, or none at all", () => {
    const { container, rerender } = render(
      <Callout icon={<svg data-testid="custom" />}>texte</Callout>,
    );
    expect(screen.getByTestId("custom")).toBeInTheDocument();

    rerender(<Callout icon={false}>texte</Callout>);
    expect(container.querySelector("[data-slot=callout-icon]")).toBeNull();
  });

  it("is silent to assistive tech unless the caller asks for a live region", () => {
    const { rerender } = render(<Callout tone="warning">Plaquettes usées</Callout>);
    // No implicit role="alert": a callout that is simply part of the page must
    // not interrupt what a screen-reader user is reading (§6.5).
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <Callout tone="warning" role="alert">
        Plaquettes usées
      </Callout>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Plaquettes usées");
  });

  it("passes className and DOM props through to the root", () => {
    const { container } = render(
      <Callout className="mt-6" id="compat-warning" data-testid="compat">
        texte
      </Callout>,
    );
    const root = container.querySelector("[data-slot=callout]");
    expect(root).toHaveClass("mt-6");
    expect(root).toHaveAttribute("id", "compat-warning");
    expect(root).toHaveAttribute("data-testid", "compat");
  });

  it("styles with the Atelier status tokens, never a stock Tailwind colour", () => {
    const { container } = render(<Callout tone="danger">texte</Callout>);
    const className = container.querySelector("[data-slot=callout]")?.className ?? "";
    expect(className).toContain("border-l-danger");
    expect(className).toContain("text-danger-fg");
    expect(className).not.toMatch(/\b(dark:|(bg|text|border)-(red|blue|gray|slate|zinc)-\d)/);
  });
});
