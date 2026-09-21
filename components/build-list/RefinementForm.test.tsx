/**
 * "Préciser la pièce" (§6.5).
 *
 * The questions themselves belong to the domain (`buildBuyingGuide`); what this
 * file holds is the form's own behaviour: it asks only what is still open, it
 * shows what the bike already decides, and every control writes the whole
 * refinement back on `change` — there is no submit button to forget to press.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildOf, deriveBike } from "@/lib/bike/rules";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { RefinementForm } from "./RefinementForm";

const gravel = buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"]));

async function renderForm(
  props: Partial<React.ComponentProps<typeof RefinementForm>> = {},
  locale: "fr" | "en" = "fr",
) {
  const onChange = vi.fn();
  return {
    onChange,
    ...(await renderWithIntl(
      <RefinementForm
        build={gravel}
        partId="cassette"
        refinement={{}}
        locale={locale}
        itemId="item-1"
        onChange={onChange}
        {...props}
      />,
      { locale },
    )),
  };
}

describe("<RefinementForm>", () => {
  it("shows what the rest of the bike already decides", async () => {
    await renderForm();
    expect(screen.getByTestId("refinement-constraints")).toHaveTextContent(
      "Vitesses : 11 vitesses",
    );
  });

  it("asks only what is still open", async () => {
    const { container } = await renderForm();
    const keys = [...container.querySelectorAll("[data-question]")].map((node) =>
      node.getAttribute("data-question"),
    );
    expect(keys).toEqual(["range", "largest-cog", "freehub"]);
    expect(keys).not.toContain("speeds");
  });

  it("writes the whole refinement back as soon as a control changes", async () => {
    const { user, onChange } = await renderForm();
    await user.selectOptions(screen.getByLabelText("Étagement"), "11-34");
    expect(onChange).toHaveBeenCalledWith({ range: "11-34" });
  });

  it("removes an answer rather than storing an empty string", async () => {
    const { user, onChange } = await renderForm({ refinement: { range: "11-34" } });
    await user.selectOptions(screen.getByLabelText("Étagement"), "");
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("keeps the other answers when one changes", async () => {
    const { user, onChange } = await renderForm({ refinement: { freehub: "hg" } });
    await user.selectOptions(screen.getByLabelText("Étagement"), "11-34");
    expect(onChange).toHaveBeenCalledWith({ freehub: "hg", range: "11-34" });
  });

  it("gives a number its own field, with the bounds the bike implies", async () => {
    const { container } = await renderForm();
    const largest = container.querySelector('[data-question="largest-cog"]') as HTMLInputElement;
    expect(largest.tagName).toBe("INPUT");
    expect(largest.type).toBe("number");
    expect(largest.inputMode).toBe("decimal");
    expect(largest.max).toBe("42");
    // 16 px, or iOS Safari zooms the page on focus (§6.8 AC5).
    expect(largest.className).toContain("text-base");
  });

  it("offers a 'comment mesurer' disclosure for an attribute that explains itself", async () => {
    await renderForm();
    expect(screen.getAllByText("Comment mesurer").length).toBeGreaterThan(0);
  });

  it("asks about a part whose every attribute the bike decides, as constraints only", async () => {
    // No part of this bike has neither a question nor a constraint, so the
    // "renders nothing" branch has no fixture on a real build — what IS worth
    // pinning is that a part the visitor did not choose anything about still
    // gets its section, because the constraints alone are the useful half.
    const { container } = await renderForm({ partId: "brake-pads-rear" });
    expect(container.querySelector("[data-testid='refinement-form']")).not.toBeNull();
  });

  it("speaks English on the English page", async () => {
    await renderForm({}, "en");
    expect(screen.getByLabelText("Range")).toBeInTheDocument();
  });
});

/**
 * §6.5's brand tier on the build list: asked when the page handed this part's
 * tiers down, and not otherwise — a part `content/brands.yaml` does not cover
 * has no brand a tier could put in the search.
 */
describe("the brand tier", () => {
  const CASSETTE_TIERS = {
    entry: ["Shimano Deore"],
    mid: ["Shimano SLX"],
    high: ["Shimano XTR"],
  };

  it("is asked, in the visitor's language, when the page knows the part's brands", async () => {
    const { user, onChange } = await renderForm({ brandTiers: CASSETTE_TIERS });
    const tier = screen.getByLabelText("Gamme");
    expect([...tier.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Peu importe",
      "Entrée de gamme",
      "Milieu de gamme",
      "Haut de gamme",
    ]);
    await user.selectOptions(tier, "high");
    expect(onChange).toHaveBeenCalledWith({ "brand-tier": "high" });
  });

  it("is not asked for a part with no brands", async () => {
    await renderForm();
    expect(screen.queryByLabelText("Gamme")).not.toBeInTheDocument();
  });

  it("speaks English on the English page", async () => {
    const { container } = await renderForm({ brandTiers: CASSETTE_TIERS }, "en");
    const tier = container.querySelector('[data-question="brand-tier"]') as HTMLSelectElement;
    expect([...tier.options].map((option) => option.textContent)).toEqual([
      "No preference",
      "Entry level",
      "Mid range",
      "High end",
    ]);
  });
});

/** §6.5: "Comment mesurer" disclosures WITH an illustration, where one exists. */
describe("the drawings in 'Comment mesurer'", () => {
  it("puts the page's drawing inside the disclosure of its own question, and nowhere else", async () => {
    const { container } = await renderForm({
      drawings: { "largest-cog": <svg data-testid="drawing-largest-cog" aria-hidden="true" /> },
    });
    const drawing = screen.getByTestId("drawing-largest-cog");
    const question = container
      .querySelector('[data-question="largest-cog"]')!
      .closest("div") as HTMLElement;
    expect(question.contains(drawing)).toBe(true);
    expect(drawing.closest("details")).not.toBeNull();
    expect(screen.getAllByTestId("drawing-largest-cog")).toHaveLength(1);
  });

  it("keeps the help text alone where no drawing was handed down", async () => {
    const { container } = await renderForm();
    expect(container.querySelector("details svg[data-illustration]")).toBeNull();
    expect(screen.getAllByText("Comment mesurer").length).toBeGreaterThan(0);
  });
});
