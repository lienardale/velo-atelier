import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoSpec, filterGuides } from "@/lib/content/filter";
import { toSummary } from "@/lib/content/guides";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { specFor } from "@/tests/_fakes/domain/build";
import { setNavigationState } from "@/tests/_fakes/session";
import { diskGuides } from "@/tests/_helpers/guides";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { GuideFilters } from "./GuideFilters";

const guides = diskGuides()
  .filter((guide) => guide.locale === "fr")
  .map(toSummary);

const cards = () =>
  screen.queryAllByRole("article").map((card) => card.getAttribute("data-guide-slug"));

// The corpus grows wave by wave: expected lists come from the filter over the guides
// on disk (unit-tested in tests/unit/content/filter.test.ts), anchored on W1 guides.
const sorted = (list: ReadonlyArray<string | null>) => [...list].sort();
const expectedSlugs = (filter: Parameters<typeof filterGuides>[1]) =>
  sorted(filterGuides(guides, filter).map((guide) => guide.slug));

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
    expect(cards()).toContain("clean-chain");
    expect(sorted(cards())).toEqual(expectedSlugs({ kind: "clean" }));
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
    expect(cards()).toContain("clean-chain");
    expect(cards()).not.toContain("check-brakes-disc"); // the road bike has rim brakes
    expect(sorted(cards())).toEqual(expectedSlugs({ spec: specFor("road-rim-2x11") }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Pour mon vélo" }));
    expect(replace.mock.lastCall?.[2]).toBe("/fr/guides");
  });

  it("filters for the demo bike with ?bike=demo, even without a guest bike", async () => {
    setNavigationState({ search: "bike=demo" });
    await renderWithIntl(<GuideFilters guides={guides} />, { locale: "en" });
    expect(screen.getByRole("checkbox", { name: "For my bike" })).toBeChecked();
    // the gravel demo bike has disc brakes and a chain
    expect(cards()).toEqual(expect.arrayContaining(["check-brakes-disc", "clean-chain"]));
    expect(sorted(cards())).toEqual(expectedSlugs({ spec: demoSpec() }));
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
