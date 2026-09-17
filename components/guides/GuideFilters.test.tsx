import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toSummary } from "@/lib/content/guides";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { setNavigationState } from "@/tests/_fakes/session";
import { diskGuides } from "@/tests/_helpers/guides";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { GuideFilters } from "./GuideFilters";

// A fixed sample of the real corpus (the three W1 guides), so the expectations
// below do not change every time a guide is added.
const SAMPLE = new Set(["check-brakes-disc", "clean-chain", "replace-brake-pads-disc"]);
const guides = diskGuides()
  .filter((guide) => guide.locale === "fr" && SAMPLE.has(guide.slug))
  .map(toSummary);

const cards = () =>
  screen.queryAllByRole("article").map((card) => card.getAttribute("data-guide-slug"));

afterEach(() => {
  window.localStorage.clear();
  setNavigationState({ search: "" });
  vi.restoreAllMocks();
});

describe("GuideFilters", () => {
  it("lists every guide without a filter", async () => {
    await renderWithIntl(<GuideFilters guides={guides} />);
    expect(cards()).toHaveLength(guides.length);
    expect(screen.getByTestId("guide-count")).toHaveTextContent(`${guides.length} guides affichés`);
    expect(screen.getByRole("checkbox", { name: "Pour mon vélo" })).toBeDisabled();
    expect(screen.getByText(/Décrivez d’abord votre vélo/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Effacer les filtres" })).toBeNull();
  });

  it("reads the filter from the URL and ignores unknown values", async () => {
    setNavigationState({ search: "kind=clean&system=bogus" });
    await renderWithIntl(<GuideFilters guides={guides} />);
    expect(cards()).toEqual(["clean-chain"]);
    expect(screen.getByRole("combobox", { name: "Que voulez-vous faire ?" })).toHaveValue("clean");
    expect(screen.getByRole("combobox", { name: "Partie du vélo" })).toHaveValue("");
  });

  it("writes changes to the URL with replaceState, keeping other parameters", async () => {
    window.history.replaceState(null, "", "/fr/guides?utm=x");
    const replace = vi.spyOn(window.history, "replaceState");
    await renderWithIntl(<GuideFilters guides={guides} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Partie du vélo" }), {
      target: { value: "brakes" },
    });
    expect(replace.mock.lastCall?.[2]).toBe("/fr/guides?utm=x&system=brakes");
    // Never Next's own history state: its patched replaceState would skip the
    // router sync and `useSearchParams` would keep the old query (e2e-verified).
    expect(replace.mock.lastCall?.[0]).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Que voulez-vous faire ?" }), {
      target: { value: "check" },
    });
    expect(replace.mock.lastCall?.[2]).toBe("/fr/guides?utm=x&kind=check");
  });

  it("shows the empty state with a reset", async () => {
    window.history.replaceState(null, "", "/fr/guides?kind=clean&system=suspension");
    setNavigationState({ search: "kind=clean&system=suspension" });
    const replace = vi.spyOn(window.history, "replaceState");
    await renderWithIntl(<GuideFilters guides={guides} />);
    const empty = screen.getByTestId("guides-empty");
    expect(empty).toHaveTextContent("Aucun guide ne correspond à ces filtres.");
    fireEvent.click(within(empty).getByRole("button", { name: "Effacer les filtres" }));
    expect(replace.mock.lastCall?.[2]).toBe("/fr/guides");
  });

  it("filters for the guest bike stored on this device", async () => {
    window.localStorage.setItem(
      "va:bike:local",
      JSON.stringify({ version: 1, answers: BIKE_PRESETS["road-rim-2x11"] }),
    );
    window.history.replaceState(null, "", "/fr/guides");
    const replace = vi.spyOn(window.history, "replaceState");
    const { unmount } = await renderWithIntl(<GuideFilters guides={guides} />);
    const toggle = screen.getByRole("checkbox", { name: "Pour mon vélo" });
    expect(toggle).toBeEnabled();
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(replace.mock.lastCall?.[2]).toBe("/fr/guides?bike=local");
    unmount();

    setNavigationState({ search: "bike=local" });
    await renderWithIntl(<GuideFilters guides={guides} />);
    expect(cards()).toEqual(["clean-chain"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pour mon vélo" }));
    expect(replace.mock.lastCall?.[2]).toBe("/fr/guides");
  });

  it("filters for the demo bike with ?bike=demo, even without a guest bike", async () => {
    setNavigationState({ search: "bike=demo" });
    await renderWithIntl(<GuideFilters guides={guides} />, { locale: "en" });
    expect(screen.getByRole("checkbox", { name: "For my bike" })).toBeChecked();
    expect(cards()).toHaveLength(guides.length); // the gravel demo bike has disc brakes and a chain
  });

  it("treats unreadable storage as no guest bike", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setNavigationState({ search: "bike=local" });
    await renderWithIntl(<GuideFilters guides={guides} />);
    expect(screen.getByRole("checkbox", { name: "Pour mon vélo" })).toBeDisabled();
    expect(cards()).toHaveLength(guides.length);
  });
});
