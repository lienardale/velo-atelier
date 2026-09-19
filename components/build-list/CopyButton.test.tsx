/**
 * "Copier la liste" and "Imprimer" (§6.5, §6.8 AC7).
 *
 * Two small buttons with one thing each to get right: the text is what a person
 * can read in a message, and a clipboard that refuses says so instead of
 * looking like a button that does nothing.
 */
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuildListItem } from "@/lib/checkup/types";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { buildListAsText, CopyButton } from "./CopyButton";
import { PrintButton } from "./PrintButton";

const items: BuildListItem[] = [
  {
    id: "a",
    stepKey: "check-drivetrain#chain-wear",
    sourceKeys: ["check-drivetrain#chain-wear"],
    partId: "chain",
    action: "replace",
    reasonKey: "chain-elongation",
    guideSlug: "replace-chain",
    done: false,
    sortOrder: 0,
  },
  {
    id: "b",
    stepKey: "check-brakes-disc#pad-wear",
    sourceKeys: ["check-brakes-disc#pad-wear"],
    partId: "brake-pads-rear",
    action: "replace",
    reasonKey: "pad-worn",
    guideSlug: "replace-brake-pads-disc",
    done: true,
    sortOrder: 1,
  },
];

/**
 * `userEvent.setup()` installs its own clipboard stub, so the fake has to go in
 * AFTER the render — otherwise the button writes to user-event's clipboard and
 * every case passes for the wrong reason.
 */
function setClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildListAsText", () => {
  it("is one line per OPEN item: the part, and why", () => {
    expect(buildListAsText(items, "fr", (key) => `<${key}>`)).toBe("Chaîne — <chain-elongation>");
  });

  it("names the parts in the reader's language", () => {
    expect(buildListAsText(items, "en", () => "worn")).toBe("Chain — worn");
  });
});

describe("<CopyButton>", () => {
  it("puts the list on the clipboard and says so", async () => {
    const writeText = vi.fn(async () => {});
    const { user } = await renderWithIntl(
      <CopyButton
        items={items}
        locale="fr"
        label="Copier la liste"
        doneLabel="Liste copiée"
        failedLabel="Copie impossible"
      />,
    );
    setClipboard(writeText);
    await user.click(screen.getByTestId("build-list-copy"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Chaîne"));
    expect(await screen.findByTestId("build-list-copy-status")).toHaveTextContent("Liste copiée");
  });

  it("says so when the browser refuses rather than failing silently", async () => {
    const { user } = await renderWithIntl(
      <CopyButton
        items={items}
        locale="fr"
        label="Copier la liste"
        doneLabel="Liste copiée"
        failedLabel="Copie impossible"
      />,
    );
    setClipboard(vi.fn(async () => Promise.reject(new Error("denied"))));
    await user.click(screen.getByTestId("build-list-copy"));
    expect(await screen.findByTestId("build-list-copy-status")).toHaveTextContent(
      "Copie impossible",
    );
  });

  it("announces the outcome politely, for a screen reader", async () => {
    await renderWithIntl(
      <CopyButton items={items} locale="fr" label="C" doneLabel="D" failedLabel="F" />,
    );
    const status = screen.getByTestId("build-list-copy-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});

describe("<PrintButton>", () => {
  it("asks the browser to print, and nothing else", async () => {
    const print = vi.fn();
    Object.defineProperty(window, "print", { configurable: true, value: print });
    const { user } = await renderWithIntl(<PrintButton label="Imprimer" />);
    await user.click(screen.getByTestId("build-list-print"));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("marks itself as chrome the print sheet drops", async () => {
    await renderWithIntl(<PrintButton label="Imprimer" />);
    expect(screen.getByTestId("build-list-print")).toHaveAttribute("data-print", "hide");
  });
});
