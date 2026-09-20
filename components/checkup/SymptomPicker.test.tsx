/* eslint-disable security/detect-object-injection -- lookups into the test's own label tables */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SymptomOption } from "@/lib/checkup/selectors";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { SymptomPicker } from "./SymptomPicker";

const OPTIONS: SymptomOption[] = [
  {
    reasonKey: "chain-elongation",
    actions: ["replace"],
    partIds: ["chain"],
    guideSlugs: ["replace-chain"],
  },
  {
    reasonKey: "hose-leak",
    actions: ["inspect-shop"],
    partIds: ["brake-line-front"],
    guideSlugs: [],
  },
];

const REASONS: Record<string, string> = {
  "chain-elongation": "Chaîne allongée",
  "hose-leak": "Fuite de liquide",
};

const TITLES: Record<string, string> = { "replace-chain": "Changer une chaîne" };

function picker(overrides: Partial<React.ComponentProps<typeof SymptomPicker>> = {}) {
  return (
    <SymptomPicker
      stepKey="check-drivetrain#chain-wear"
      options={OPTIONS}
      value={null}
      onPick={vi.fn()}
      note=""
      onNoteChange={vi.fn()}
      reasonLabel={(key) => REASONS[key] ?? key}
      guideTitle={(slug) => TITLES[slug] ?? null}
      isStub={() => false}
      {...overrides}
    />
  );
}

describe("SymptomPicker", () => {
  it("offers one radio per symptom, in one named group", async () => {
    await renderWithIntl(picker());

    expect(
      screen.getByRole("radiogroup", { name: "Qu'est-ce qui ne va pas ?" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "Chaîne allongée" })).not.toBeChecked();
  });

  it("links the guide that fixes a symptom, and says so when only a shop can", async () => {
    await renderWithIntl(picker());

    // No locale prefix here: outside a request, next-intl's `Link` renders the
    // pathname as written and the middleware adds the prefix.
    expect(screen.getByRole("link", { name: /Changer une chaîne/ })).toHaveAttribute(
      "href",
      "/guides/replace-chain",
    );
    expect(screen.getByText("À faire voir par un atelier")).toBeInTheDocument();
  });

  it("badges a guide that is still a stub", async () => {
    await renderWithIntl(picker({ isStub: (slug) => slug === "replace-chain" }));
    expect(screen.getByTestId("symptom-guide-replace-chain")).toHaveTextContent(
      "Guide en cours d'écriture",
    );
  });

  it("reports the symptom the visitor ticks", async () => {
    const onPick = vi.fn();
    const { user } = await renderWithIntl(picker({ onPick }));

    await user.click(screen.getByRole("radio", { name: "Chaîne allongée" }));
    expect(onPick).toHaveBeenCalledWith("chain-elongation");
  });

  it("keeps the note separate from the verdict", async () => {
    const onNoteChange = vi.fn();
    const onPick = vi.fn();
    const { user } = await renderWithIntl(picker({ onNoteChange, onPick }));

    // "2" is the KO shortcut everywhere else on the page; here it is a character.
    await user.type(screen.getByTestId("symptom-note"), "2");
    expect(onNoteChange).toHaveBeenCalledWith("2");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("shows the symptom already chosen as checked", async () => {
    await renderWithIntl(picker({ value: "hose-leak" }));
    expect(screen.getByRole("radio", { name: "Fuite de liquide" })).toBeChecked();
  });
});
