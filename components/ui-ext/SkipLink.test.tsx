import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";

import { MAIN_CONTENT_ID, SkipLink } from "./SkipLink";

describe("SkipLink", () => {
  it("jumps to the main content, in French by default", async () => {
    await renderWithIntl(<SkipLink />);
    const link = screen.getByRole("link", { name: "Aller au contenu principal" });
    expect(link).toHaveAttribute("href", `#${MAIN_CONTENT_ID}`);
    expect(MAIN_CONTENT_ID).toBe("main-content");
  });

  it("is visually hidden until focused, then a 44 px target", async () => {
    await renderWithIntl(<SkipLink />);
    const link = screen.getByRole("link");
    expect(link).toHaveClass("sr-only", "focus:not-sr-only", "focus:tap-target");
  });

  it("is the first thing a keyboard user reaches", async () => {
    const { user } = await renderWithIntl(
      <>
        <SkipLink />
        <button type="button">menu</button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole("link")).toHaveFocus();
  });

  it("speaks English and accepts another target", async () => {
    await renderWithIntl(<SkipLink targetId="guide-steps" />, { locale: "en" });
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#guide-steps",
    );
  });
});
