/**
 * The build list's "Comment mesurer" drawings (§6.5), rendered the way the
 * `/liste` page renders them — on the server, then handed to the client form.
 *
 * What is pinned is what makes them safe to repeat on one page: DECORATIVE
 * (no `<title id>` a second card would duplicate — the question's own help
 * text says what to read), and always WITH the legend of their numbered
 * callouts.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { messagesFor, renderWithIntl } from "@/tests/_helpers/intl";

import { renderMeasureDrawings } from "./measure-drawings";

describe("renderMeasureDrawings", () => {
  it("draws only the attributes an existing drawing fits", () => {
    const nodes = renderMeasureDrawings(["axle", "range", "speeds", "axle"]);
    expect(Object.keys(nodes).sort()).toEqual(["axle", "speeds"]);
  });

  it("renders a decorative drawing with its legend, twice without a duplicate id", async () => {
    const { axle } = renderMeasureDrawings(["axle"]);
    const { container } = await renderWithIntl(
      <>
        <div data-testid="first">{axle}</div>
        <div data-testid="second">{axle}</div>
      </>,
    );

    const drawings = container.querySelectorAll('svg[data-illustration="axle-qr-vs-thru"]');
    expect(drawings).toHaveLength(2);
    for (const svg of drawings) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).not.toHaveAttribute("role");
      expect(svg.querySelector("title")).toBeNull();
    }
    expect(container.querySelectorAll("[id]")).toHaveLength(0);

    const messages = (await messagesFor("fr")) as {
      illustrations: Record<string, { callouts?: Record<string, string> }>;
    };
    const first = messages.illustrations["axle-qr-vs-thru"].callouts?.["1"];
    expect(first).toBeDefined();
    expect(screen.getAllByText(first!)).toHaveLength(2);
  });
});
