import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RadioGroup } from "@/components/ui/radio-group";

import { OptionCard } from "./OptionCard";

function renderOptions(
  props: { value?: string; onValueChange?: (value: string) => void; disabled?: boolean } = {},
) {
  const user = userEvent.setup();
  const result = render(
    <RadioGroup aria-label="Type de freins" className="grid-cols-2" {...props}>
      <OptionCard
        value="disc-hydraulic"
        label="Disque hydraulique"
        hint="Durite, pas de câble"
        illustration={
          <svg role="img" aria-label="Étrier de frein à disque">
            <title>Étrier de frein à disque</title>
          </svg>
        }
      />
      <OptionCard value="rim-caliper" label="Patins" hint="Patins sur la jante" />
      <OptionCard value="drum" label="Tambour" disabled />
    </RadioGroup>,
  );
  return { user, ...result };
}

describe("OptionCard", () => {
  it("is a real radio inside the group, not a label wrapping a hidden input", () => {
    renderOptions();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0].tagName).toBe("BUTTON");
    // §6.8 AC5 measures `[role=radio]`: the attribute has to be on the big
    // target itself, which is what makes the 44 px assertion meaningful.
    expect(radios[0]).toHaveAttribute("role", "radio");
    expect(screen.getByRole("radiogroup", { name: "Type de freins" })).toBeInTheDocument();
  });

  it("names itself from its label and hint, and shows the illustration", () => {
    renderOptions();
    const radio = screen.getByRole("radio", { name: /Disque hydraulique/ });
    expect(radio).toHaveTextContent("Durite, pas de câble");
    expect(screen.getByRole("img", { name: "Étrier de frein à disque" })).toBeInTheDocument();
  });

  it("is a 44 px target dressed in the Atelier tokens", () => {
    renderOptions();
    const radio = screen.getAllByRole("radio")[0];
    expect(radio).toHaveClass("tap-target");
    expect(radio.className).toContain("border-rule");
    expect(radio.className).toContain("bg-paper");
    expect(radio.className).not.toMatch(/\bdark:/);
  });

  it("selects on click and reports the value", async () => {
    const onValueChange = vi.fn();
    const { user } = renderOptions({ onValueChange });
    await user.click(screen.getByRole("radio", { name: /Patins/ }));
    expect(onValueChange).toHaveBeenCalledWith("rim-caliper");
  });

  it("marks the controlled value as checked", () => {
    renderOptions({ value: "rim-caliper", onValueChange: vi.fn() });
    expect(screen.getByRole("radio", { name: /Patins/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Disque hydraulique/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Patins/ })).toHaveAttribute("data-state", "checked");
  });

  it("moves between options with the arrow keys (§6.3)", async () => {
    const onValueChange = vi.fn();
    const { user } = renderOptions({ value: "disc-hydraulic", onValueChange });

    // Roving tabindex: one Tab reaches the group, not one Tab per option.
    await user.tab();
    expect(screen.getByRole("radio", { name: /Disque hydraulique/ })).toHaveFocus();

    // `{ArrowRight>}` holds the key down: Radix moves focus on a macrotask and
    // only selects while an arrow key is still pressed, exactly as a real
    // key press behaves.
    await user.keyboard("{ArrowRight>}");
    await waitFor(() => expect(screen.getByRole("radio", { name: /Patins/ })).toHaveFocus());
    expect(onValueChange).toHaveBeenCalledWith("rim-caliper");
    await user.keyboard("{/ArrowRight}");
  });

  it("keeps a disabled option out of reach", async () => {
    const onValueChange = vi.fn();
    const { user } = renderOptions({ onValueChange });
    const disabled = screen.getByRole("radio", { name: /Tambour/ });
    expect(disabled).toBeDisabled();
    await user.click(disabled);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("passes className and DOM props through", () => {
    render(
      <RadioGroup aria-label="g">
        <OptionCard value="a" label="A" className="col-span-2" data-testid="opt-a" />
      </RadioGroup>,
    );
    const radio = screen.getByTestId("opt-a");
    expect(radio).toHaveClass("col-span-2");
  });
});
