import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BikeViewerProvider } from "@/components/bike3d/BikeViewer";
import {
  createViewerStore,
  ViewerStoreProvider,
  type ViewerStore,
} from "@/components/bike3d/store";
import { buildOf, deriveBike } from "@/lib/bike/rules";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import type { PartId } from "@/lib/domain/data/parts";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { PartsList } from "./PartsList";

/**
 * `PartsList` is the accessibility mirror of the 3D canvas (§6.4), so what is
 * asserted here is the half of the product a WebGL-less or keyboard-only
 * visitor gets: **every** part reachable, selection visible and bidirectional,
 * and picking whole systems at once.
 *
 * The store is created by hand rather than through `BikeViewer` so the "the
 * canvas selected something" direction can be driven directly — the viewer
 * itself is `components/bike3d`'s to test.
 */
const build = buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"]));

let store: ViewerStore;

function renderList(props: Partial<React.ComponentProps<typeof PartsList>> = {}) {
  store = createViewerStore({
    availablePartIds: build.parts.map((part) => part.partId as PartId),
  });
  return renderWithIntl(
    <ViewerStoreProvider store={store}>
      <PartsList build={build} {...props} />
    </ViewerStoreProvider>,
  );
}

/**
 * By `data-part-row`, not by accessible name: several parts share a word
 * ("Selle" is inside "Tige de selle"), and a regex over the name would match
 * two rows and fail for a reason that has nothing to do with the assertion.
 */
function rowFor(partId: string): HTMLButtonElement {
  const row = document.querySelector<HTMLButtonElement>(`[data-part-row="${partId}"]`);
  if (row === null) throw new Error(`no row for ${partId}`);
  return row;
}

beforeEach(() => {
  vi.restoreAllMocks();
  // jsdom has no layout, and `scrollIntoView` is not implemented there.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("what it shows", () => {
  it("lists every part of the bike exactly once, hosted ones included", async () => {
    await renderList();
    const rows = screen.getAllByRole("button").filter((node) => node.dataset.partRow);
    const ids = rows.map((row) => row.dataset.partRow);

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(build.parts.map((part) => part.partId).sort());
  });

  it("groups them by system, each group a labelled fieldset inside an open details", async () => {
    await renderList();
    const group = document.querySelector('[data-system="drivetrain"]') as HTMLDetailsElement;

    expect(group.tagName).toBe("DETAILS");
    expect(group.open).toBe(true);
    expect(group.querySelector("summary")).toHaveTextContent("Transmission");
    expect(within(group).getByRole("group")).toHaveAccessibleName("Transmission");
  });

  it("nests a hosted part under its host rather than beside it", async () => {
    await renderList();
    const host = document.querySelector('[data-part-id="brake-caliper-front"]') as HTMLElement;
    expect(within(host).getByTestId("pick-brake-pads-front")).toBeInTheDocument();
  });

  it("shows a status badge only for a part a checkup has judged", async () => {
    await renderList({ statuses: { chain: "BROKEN", cassette: "UNKNOWN" } });
    const chain = document.querySelector('[data-part-id="chain"]') as HTMLElement;
    const cassette = document.querySelector('[data-part-id="cassette"]') as HTMLElement;

    expect(within(chain).getByText("À remplacer")).toBeInTheDocument();
    expect(cassette.querySelector("[data-status]")).toBeNull();
  });
});

describe("selection", () => {
  it("marks the selected row with aria-current and nothing else", async () => {
    const { user } = await renderList();
    await user.click(rowFor("chain"));

    expect(rowFor("chain")).toHaveAttribute("aria-current", "true");
    expect(rowFor("cassette")).not.toHaveAttribute("aria-current");
    expect(store.api.getState().selectedPartId).toBe("chain");
    expect(store.api.getState().lastSource).toBe("list");
  });

  it("asks for a camera move when the selection comes from the list", async () => {
    const { user } = await renderList();
    const before = store.api.getState().focusNonce;
    await user.click(rowFor("saddle"));
    expect(store.api.getState().focusNonce).toBe(before + 1);
  });

  it("follows a selection made in the canvas and scrolls that row into view", async () => {
    await renderList();
    store.api.getState().select("cassette", { source: "canvas" });

    await screen.findByTestId("parts-list");
    expect(rowFor("cassette")).toHaveAttribute("aria-current", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("does not scroll when the list itself made the selection", async () => {
    const { user } = await renderList();
    await user.click(rowFor("chain"));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("clears the selection on Escape, leaving focus on the row", async () => {
    const { user } = await renderList();
    await user.click(rowFor("chain"));
    await user.keyboard("{Escape}");

    expect(store.api.getState().selectedPartId).toBeNull();
    expect(document.activeElement).toBe(rowFor("chain"));
  });

  it("reaches every part with the keyboard alone", async () => {
    const { user } = await renderList({ selectable: false });
    const rows = screen.getAllByRole("button").filter((node) => node.dataset.partRow);

    for (const row of rows) {
      row.focus();
      await user.keyboard("{Enter}");
      expect(store.api.getState().selectedPartId).toBe(row.dataset.partRow);
    }
  });
});

describe("picking parts for a partial checkup", () => {
  it("toggles one part with a native checkbox", async () => {
    const { user } = await renderList();
    await user.click(screen.getByTestId("pick-chain"));

    expect(store.api.getState().pickedPartIds.has("chain")).toBe(true);
    expect(screen.getByTestId("pick-chain")).toBeChecked();
  });

  it("names the checkbox after the part, so a screen reader hears which one", async () => {
    await renderList();
    expect(screen.getByTestId("pick-chain")).toHaveAccessibleName(
      "Sélectionner Chaîne pour un contrôle",
    );
  });

  it("selects a whole system, hosted parts included, and clears it again", async () => {
    const { user } = await renderList();
    await user.click(screen.getByTestId("select-system-brakes"));

    const picked = store.api.getState().pickedPartIds;
    expect(picked.has("brake-caliper-front")).toBe(true);
    expect(picked.has("brake-pads-front")).toBe(true);

    await user.click(screen.getByTestId("select-system-brakes"));
    expect(store.api.getState().pickedPartIds.size).toBe(0);
  });

  it("shows the system checkbox as indeterminate while only some of it is picked", async () => {
    const { user } = await renderList();
    await user.click(screen.getByTestId("pick-chain"));

    const systemBox = screen.getByTestId("select-system-drivetrain") as HTMLInputElement;
    expect(systemBox.indeterminate).toBe(true);
    expect(systemBox.checked).toBe(false);
  });

  it("hides the checkboxes when the host does not want them", async () => {
    await renderList({ selectable: false });
    expect(screen.queryByTestId("pick-chain")).toBeNull();
    expect(screen.queryByTestId("select-system-drivetrain")).toBeNull();
  });
});

describe("inside a viewer provider", () => {
  it("shares the store with the viewer rather than creating its own", async () => {
    await renderWithIntl(
      <BikeViewerProvider build={build} initialPartId="chain">
        <PartsList build={build} />
      </BikeViewerProvider>,
    );
    expect(rowFor("chain")).toHaveAttribute("aria-current", "true");
  });
});
