import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";

import { BikeCanvasFallback, BikeCanvasSkeleton } from "./BikeCanvasFallback";

/**
 * The placeholder's whole job is to be exactly the size of the viewer and to
 * say the right thing (or, in the skeleton's case, nothing at all).
 *
 * The size classes are asserted literally because they are a **contract with
 * `BikeViewer`**: its box is `aspect-square max-h-[60svh] min-h-[260px]` and
 * `lg:aspect-[16/10]`, and if the two ever disagree the page jumps when the
 * bike arrives — a CLS regression no snapshot of a finished page would catch,
 * because by the time the screenshot is taken the jump is over.
 */
const BOX_CLASSES = [
  "aspect-square",
  "max-h-[60svh]",
  "min-h-[260px]",
  "lg:aspect-[16/10]",
  "w-full",
];

describe("BikeCanvasSkeleton", () => {
  it("reserves the viewer's box and says nothing", async () => {
    const { container } = await renderWithIntl(<BikeCanvasSkeleton />);
    const box = screen.getByTestId("bike-canvas-skeleton");

    for (const className of BOX_CLASSES) expect(box.className).toContain(className);
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent).toBe("");
  });

  it("is what `loading.tsx` renders — no translation, no request read", async () => {
    // A next-intl read in `loading.tsx` (which gets no params, so cannot call
    // `setRequestLocale`) turns the segment dynamic and costs `/velo/demo` its
    // prerender (§6.8 AC2). Rendering it with NO provider at all proves it.
    const { render } = await import("@testing-library/react");
    expect(() => render(<BikeCanvasSkeleton />)).not.toThrow();
  });
});

describe("BikeCanvasFallback", () => {
  it("announces the loading state politely and busily", async () => {
    await renderWithIntl(<BikeCanvasFallback state="loading" />);
    const box = screen.getByTestId("bike-canvas-fallback");

    expect(box).toHaveAttribute("data-state", "loading");
    expect(box).toHaveAttribute("role", "status");
    expect(box).toHaveAttribute("aria-busy", "true");
    expect(box).toHaveAttribute("aria-live", "polite");
    expect(box).toHaveTextContent("Chargement du vélo");
    for (const className of BOX_CLASSES) expect(box.className).toContain(className);
  });

  it("explains the empty state and carries the caller's way out", async () => {
    await renderWithIntl(
      <BikeCanvasFallback state="empty" action={<button type="button">Décrire mon vélo</button>} />,
    );
    const box = screen.getByTestId("bike-canvas-fallback");

    expect(box).toHaveAttribute("data-state", "empty");
    expect(box).toHaveAttribute("aria-busy", "false");
    expect(box).toHaveTextContent("Aucun vélo enregistré sur cet appareil");
    expect(box).toHaveTextContent("Décrivez votre vélo");
    expect(screen.getByRole("button", { name: "Décrire mon vélo" })).toBeInTheDocument();
  });

  it("shows neither the help text nor an action while loading", async () => {
    await renderWithIntl(
      <BikeCanvasFallback
        state="loading"
        action={<button type="button">Décrire mon vélo</button>}
      />,
    );
    expect(screen.getByTestId("bike-canvas-fallback")).not.toHaveTextContent("Décrivez votre vélo");
  });

  it("speaks English on the English page", async () => {
    await renderWithIntl(<BikeCanvasFallback state="empty" />, { locale: "en" });
    expect(screen.getByTestId("bike-canvas-fallback")).toHaveTextContent(
      "No bike saved on this device",
    );
  });
});
