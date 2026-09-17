import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import frDecision from "@/messages/fr/decision.json";
import { DECISION_TREE } from "@/lib/domain/data/decision-tree";
import { visibleOptions } from "@/lib/domain/engine/decision";
import type { QuestionId } from "@/lib/domain/schema/decision";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { OptionGrid } from "./OptionGrid";
import { renderTreeIllustrations } from "./tree-illustrations";

const node = (id: QuestionId) => DECISION_TREE.find((candidate) => candidate.id === id)!;

async function renderGrid(id: QuestionId, value?: string, onValueChange = vi.fn()) {
  const options = visibleOptions(node(id), { discipline: "gravel", drivetrain: "derailleur-1x" });
  const result = await renderWithIntl(
    <>
      <h2 id="q">{id}</h2>
      <OptionGrid
        options={options}
        value={value}
        onValueChange={onValueChange}
        labelledBy="q"
        illustrations={renderTreeIllustrations()}
      />
    </>,
  );
  return { ...result, options, onValueChange };
}

describe("OptionGrid", () => {
  it("is a radiogroup named by the question, one radio card per visible option", async () => {
    const { options } = await renderGrid("wheel-size");
    const group = screen.getByRole("radiogroup", { name: "wheel-size" });
    const radios = within(group).getAllByRole("radio");
    // Gravel shows 700c and 650b only.
    expect(options.map((option) => option.id)).toEqual(["700c", "650b"]);
    expect(radios.map((radio) => radio.dataset.optionId)).toEqual(["700c", "650b"]);
    expect(radios[0]).toHaveAccessibleName(
      expect.stringContaining(frDecision["wheel-size"].options["700c"].label),
    );
    expect(radios[0]).toHaveTextContent(frDecision["wheel-size"].options["700c"].description);
  });

  it("shows decorative thumbnails where the tree has them, none on the numeric speeds grid", async () => {
    await renderGrid("brake-type");
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(5);
    for (const radio of radios) {
      const svg = radio.querySelector("svg[data-illustration]");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("renders no thumbnail for plain-number options", async () => {
    await renderGrid("speeds");
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.querySelector("svg[data-illustration]")).toBeNull();
    }
  });

  it("reflects the checked value and reports a new choice without anything else", async () => {
    const { user, onValueChange } = await renderGrid("cockpit", "drop");
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("data-option-id", "drop");
    await user.click(screen.getByRole("radio", { name: /Cintre plat/ }));
    expect(onValueChange).toHaveBeenCalledWith("flat");
  });

  it("moves between cards with the arrow keys", async () => {
    const { user, onValueChange } = await renderGrid("cockpit", "drop");
    await user.tab();
    expect(screen.getByRole("radio", { checked: true })).toHaveFocus();
    // Held down: Radix moves focus on a macrotask and selects only while an
    // arrow key is still pressed, as a real key press does (see OptionCard.test).
    await user.keyboard("{ArrowRight>}");
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("flat"));
    await user.keyboard("{/ArrowRight}");
  });

  it("every card is a 44 px tap target", async () => {
    await renderGrid("pedals");
    for (const radio of screen.getAllByRole("radio")) expect(radio).toHaveClass("tap-target");
  });
});
