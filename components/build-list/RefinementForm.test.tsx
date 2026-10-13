/**
 * "Préciser la pièce" (§6.5).
 *
 * The questions themselves belong to the domain (`buildBuyingGuide`); what this
 * file holds is the form's own behaviour: it asks only what is still open, it
 * shows what the bike already decides, and every control writes the whole
 * refinement back on `change` — there is no submit button to forget to press.
 */
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { buildOf, deriveBike } from "@/lib/bike/rules";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { MAX_REFINEMENT_VALUE_LENGTH } from "@/lib/shop/refinement";
import type { Refinement } from "@/lib/shop/questions";
import { renderWithIntl } from "@/tests/_helpers/intl";
import { PRODUCT_TITLE } from "@/tests/_helpers/long-answers";

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

/**
 * One answer is at most `MAX_REFINEMENT_VALUE_LENGTH` characters, and until
 * 2026-10-13 nothing in this form said so: every reader of a stored refinement
 * bounded an entry, and the control that produced it did not (`.debug/017`
 * §5.9). What the form hands UP is the subject here — every refinement it
 * passes to `onChange`, recorded — with the parent keeping it, as the list
 * does; the list around it is `BuildList.long-answer.test.tsx`.
 */
describe("no control hands up an answer longer than the cap", () => {
  const CAP = MAX_REFINEMENT_VALUE_LENGTH;

  /** The rear pads' form, its refinement held by the parent the way the list holds it. */
  async function renderPads(initial: Refinement = {}) {
    const handedUp: Refinement[] = [];
    function Held(): React.JSX.Element {
      const [refinement, setRefinement] = useState<Refinement>(initial);
      return (
        <RefinementForm
          build={gravel}
          partId="brake-pads-rear"
          refinement={refinement}
          locale="fr"
          itemId="item-1"
          onChange={(next) => {
            handedUp.push(next);
            setRefinement(next);
          }}
        />
      );
    }
    const view = await renderWithIntl(<Held />);
    return {
      ...view,
      handedUp,
      model: () => screen.getByLabelText("Référence des plaquettes") as HTMLInputElement,
      thickness: () => screen.getByLabelText("Épaisseur de garniture") as HTMLInputElement,
      /** The longest value of any refinement handed up so far. */
      longest: () =>
        Math.max(0, ...handedUp.flatMap((next) => Object.values(next).map((v) => v.length))),
    };
  }

  it("typed: 80 keystrokes are 64 changes, and the field shows the first 64 characters", async () => {
    const { user, handedUp, model, longest } = await renderPads();
    const typed = "r".repeat(80);
    await user.type(model(), typed);

    expect(model().value).toBe(typed.slice(0, CAP));
    expect(handedUp).toHaveLength(CAP);
    expect(longest()).toBe(CAP);
  });

  it("pasted: a 99-character title is one change, holding its beginning", async () => {
    const { user, handedUp, model } = await renderPads({ "pad-thickness": "2" });
    await user.click(model());
    await user.paste(PRODUCT_TITLE);

    expect(handedUp).toEqual([{ "pad-thickness": "2", "pad-model": PRODUCT_TITLE.slice(0, CAP) }]);
    expect(model().value).toBe(PRODUCT_TITLE.slice(0, CAP));
  });

  it("text set past the attribute is cut to the cap before it is handed up", async () => {
    const { handedUp, model } = await renderPads();
    fireEvent.change(model(), { target: { value: PRODUCT_TITLE } });
    expect(handedUp).toEqual([{ "pad-model": PRODUCT_TITLE.slice(0, CAP) }]);
  });

  it("a number over the cap is not handed up at all — a number cut short is another number", async () => {
    const { handedUp, thickness } = await renderPads({ "pad-thickness": "2.5" });
    fireEvent.change(thickness(), { target: { value: "1".repeat(CAP + 1) } });

    expect(handedUp).toEqual([]);
    // The controlled field goes on showing what is stored.
    expect(thickness().value).toBe("2.5");

    // At the cap it is an answer like any other.
    fireEvent.change(thickness(), { target: { value: "1".repeat(CAP) } });
    expect(handedUp).toEqual([{ "pad-thickness": "1".repeat(CAP) }]);
  });

  it("emptying a field still removes its answer", async () => {
    const { user, handedUp, model } = await renderPads({ "pad-model": "J04C" });
    await user.clear(model());
    expect(handedUp.at(-1)).toEqual({});
  });
});
