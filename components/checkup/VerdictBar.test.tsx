import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";

import { VerdictBar } from "./VerdictBar";

const PROMPT = "Reste-t-il au moins 1 mm de garniture ?";

describe("VerdictBar", () => {
  it("offers the three verdicts as one named group, with the question above them", async () => {
    await renderWithIntl(
      <VerdictBar
        prompt={PROMPT}
        current={undefined}
        skippable
        onAnswer={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByText(PROMPT)).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Votre verdict" });
    expect(group).toBeInTheDocument();
    for (const label of ["Ça marche", "Ça ne marche pas", "Passer"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("says why a question cannot be passed instead of showing a dead button", async () => {
    await renderWithIntl(
      <VerdictBar
        prompt={PROMPT}
        current={undefined}
        skippable={false}
        onAnswer={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Passer" })).not.toBeInTheDocument();
    expect(screen.getByTestId("verdict-required")).toHaveTextContent(
      "Cette question ne peut pas être passée.",
    );
  });

  it("marks the verdict already given, for a screen reader and for the e2e suite", async () => {
    const { rerender } = await renderWithIntl(
      <VerdictBar prompt={PROMPT} current="ko" skippable onAnswer={vi.fn()} onSkip={vi.fn()} />,
    );

    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "ko");
    expect(screen.getByRole("button", { name: "Ça ne marche pas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Ça marche" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    rerender(
      <VerdictBar
        prompt={PROMPT}
        current={undefined}
        skippable
        onAnswer={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByTestId("verdict-bar")).toHaveAttribute("data-verdict", "none");
  });

  it("reports the verdict the visitor chose", async () => {
    const onAnswer = vi.fn();
    const onSkip = vi.fn();
    const { user } = await renderWithIntl(
      <VerdictBar
        prompt={PROMPT}
        current={undefined}
        skippable
        onAnswer={onAnswer}
        onSkip={onSkip}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Ça marche" }));
    await user.click(screen.getByRole("button", { name: "Ça ne marche pas" }));
    await user.click(screen.getByRole("button", { name: "Passer" }));

    expect(onAnswer.mock.calls).toEqual([["ok"], ["ko"]]);
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("speaks English on the English page", async () => {
    await renderWithIntl(
      <VerdictBar
        prompt="Is there 1 mm left?"
        current="ok"
        skippable
        onAnswer={vi.fn()}
        onSkip={vi.fn()}
      />,
      { locale: "en" },
    );
    expect(screen.getByRole("group", { name: "Your verdict" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "It's fine" })).toBeInTheDocument();
  });
});
