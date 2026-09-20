/**
 * The build list as the visitor works it (§6.5, §6.8 AC7).
 *
 * Two halves, and they are the two halves of the component:
 *
 *   the STORE — what `va:buildlist:<ref>` is allowed to contain, and what
 *   happens to a value that is not it (dropped, never half-used);
 *   the LIST — sections, the done checkbox, the hide filter, "retirer ce qui
 *   est fait", and the compatibility callout an incompatible refinement raises.
 *
 * A saved bike's list goes through server actions, which reach `@/auth` and
 * Prisma: they are mocked, and asserting the CALL is asserting the contract —
 * `tests/integration/build-lists.test.ts` is where the actions meet a database.
 */
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildOf, deriveBike } from "@/lib/bike/rules";
import { buildListKey } from "@/lib/bike/storage-keys";
import type { BuildListItem } from "@/lib/checkup/types";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { renderWithIntl } from "@/tests/_helpers/intl";

type ActionMock = (input: unknown) => Promise<{ ok: boolean; data?: unknown; code?: string }>;

const setBuildListItemDoneAction = vi.fn<ActionMock>(async () => ({ ok: true, data: null }));
const setBuildListItemRefinementAction = vi.fn<ActionMock>(async () => ({ ok: true, data: null }));
const clearDoneBuildListItemsAction = vi.fn<ActionMock>(async () => ({
  ok: true,
  data: { removed: 1 },
}));
vi.mock("@/app/[locale]/velo/[id]/liste/actions", () => ({
  setBuildListItemDoneAction: (input: unknown) => setBuildListItemDoneAction(input),
  setBuildListItemRefinementAction: (input: unknown) => setBuildListItemRefinementAction(input),
  clearDoneBuildListItemsAction: (input: unknown) => clearDoneBuildListItemsAction(input),
}));

const { BuildList, parseBuildList, readBuildList, resetBuildListSnapshotCache, writeBuildList } =
  await import("./BuildList");

// Hoisted: deriving a build walks the whole catalogue (`.debug/009`).
const gravel = buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"]));

function item(overrides: Partial<BuildListItem> = {}): BuildListItem {
  return {
    id: "check-drivetrain#chain-wear|chain|replace",
    stepKey: "check-drivetrain#chain-wear",
    sourceKeys: ["check-drivetrain#chain-wear"],
    partId: "chain",
    action: "replace",
    reasonKey: "chain-elongation",
    guideSlug: "replace-chain",
    done: false,
    sortOrder: 0,
    ...overrides,
  };
}

const pads = item({
  id: "check-brakes-disc#pad-wear|brake-pads-rear|replace",
  stepKey: "check-brakes-disc#pad-wear",
  sourceKeys: ["check-brakes-disc#pad-wear"],
  partId: "brake-pads-rear",
  reasonKey: "pad-worn",
  guideSlug: "replace-brake-pads-disc",
  sortOrder: 1,
});

function seed(items: readonly BuildListItem[]): void {
  window.localStorage.setItem(
    buildListKey("demo"),
    JSON.stringify({ version: 1, items, updatedAt: "2026-09-19T10:00:00.000Z" }),
  );
  resetBuildListSnapshotCache();
}

function renderGuestList() {
  return renderWithIntl(
    <BuildList
      bikeRef={{ kind: "demo" }}
      bikeParam="demo"
      build={gravel}
      locale="fr"
      initialItems={null}
      buildListId={null}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetBuildListSnapshotCache();
  setBuildListItemDoneAction.mockClear();
  setBuildListItemRefinementAction.mockClear();
  clearDoneBuildListItemsAction.mockClear();
});

afterEach(() => {
  window.localStorage.clear();
  resetBuildListSnapshotCache();
});

describe("what `va:buildlist:<ref>` is allowed to contain", () => {
  it("reads back what it wrote", () => {
    expect(writeBuildList("demo", [item()])).toBe(true);
    expect(readBuildList("demo")).toEqual([item()]);
  });

  it("also accepts a bare array, so a list written elsewhere still opens", () => {
    window.localStorage.setItem(buildListKey("demo"), JSON.stringify([item()]));
    expect(readBuildList("demo")).toEqual([item()]);
  });

  it("drops a value it cannot parse, and removes it from storage", () => {
    window.localStorage.setItem(buildListKey("demo"), "{not json");
    expect(readBuildList("demo")).toBeNull();
    expect(window.localStorage.getItem(buildListKey("demo"))).toBeNull();
  });

  it("refuses an item with an unknown action or an unknown part", () => {
    expect(parseBuildList(JSON.stringify([{ ...item(), action: "burn" }]))).toBeNull();
    expect(parseBuildList(JSON.stringify([{ ...item(), partId: "sprocket" }]))).toEqual([]);
  });

  it("answers null for a version it does not know", () => {
    expect(parseBuildList(JSON.stringify({ version: 2, items: [], updatedAt: "x" }))).toBeNull();
  });

  it("answers null when there is nothing stored", () => {
    expect(readBuildList("demo")).toBeNull();
    expect(parseBuildList(null)).toBeNull();
  });
});

describe("an empty list", () => {
  it("offers a checkup rather than an empty page (§6.7)", async () => {
    await renderGuestList();
    expect(await screen.findByTestId("build-list-empty")).toBeInTheDocument();
    expect(screen.getByTestId("build-list-start-checkup")).toHaveAttribute(
      "href",
      "/velo/demo/controle",
    );
  });
});

describe("a guest list", () => {
  beforeEach(() => {
    seed([item(), pads]);
  });

  it("groups the lines by what has to be done to the part", async () => {
    await renderGuestList();
    const section = await screen.findByRole("region", { name: /À changer/ });
    expect(within(section).getAllByTestId("build-item")).toHaveLength(2);
  });

  it("names the part and why it is there", async () => {
    await renderGuestList();
    const card = (await screen.findAllByTestId("build-item"))[0];
    expect(within(card).getByText("Chaîne")).toBeInTheDocument();
    expect(within(card).getByTestId("build-item-reason")).not.toHaveTextContent("guides.reasons");
  });

  it("writes a ticked line straight back to storage", async () => {
    const { user } = await renderGuestList();
    const card = (await screen.findAllByTestId("build-item"))[0];
    await user.click(within(card).getByTestId("build-item-done"));

    const stored = readBuildList("demo");
    expect(stored?.find((entry) => entry.partId === "chain")).toMatchObject({
      done: true,
      doneReason: "manual",
    });
    expect(setBuildListItemDoneAction).not.toHaveBeenCalled();
  });

  it("hides what is done without losing it", async () => {
    seed([item({ done: true }), pads]);
    const { user } = await renderGuestList();
    expect(await screen.findAllByTestId("build-item")).toHaveLength(2);
    await user.click(screen.getByTestId("build-list-hide-done"));
    expect(screen.getAllByTestId("build-item")).toHaveLength(1);
    expect(readBuildList("demo")).toHaveLength(2);
  });

  it("removes the done lines when asked, and only then", async () => {
    seed([item({ done: true }), pads]);
    const { user } = await renderGuestList();
    await user.click(await screen.findByTestId("build-list-clear-done"));
    expect(readBuildList("demo")).toEqual([pads]);
  });

  it("says how many are done", async () => {
    seed([item({ done: true }), pads]);
    await renderGuestList();
    expect(await screen.findByTestId("build-list-state")).toHaveTextContent("1 sur 2 fait");
  });

  it("raises an interrupting callout for an incompatible refinement (§6.8 AC7)", async () => {
    // The gravel bike is 11-speed: a 12-speed chain does not fit its cassette.
    seed([item({ refinement: { speeds: "12" } })]);
    await renderGuestList();
    const callout = await screen.findByTestId("build-item-compat");
    expect(callout).toHaveAttribute("role", "alert");
    expect(callout).toHaveTextContent(/chaîne/i);
  });

  it("is quiet when the refinement matches the bike", async () => {
    seed([item({ refinement: { speeds: "11" } })]);
    await renderGuestList();
    await screen.findAllByTestId("build-item");
    expect(screen.queryByTestId("build-item-compat")).not.toBeInTheDocument();
  });
});

describe("a saved bike's list", () => {
  function renderSavedList(items: BuildListItem[]) {
    return renderWithIntl(
      <BuildList
        bikeRef={{ kind: "db", id: "00000000-0000-4000-8000-000000000009" }}
        bikeParam="00000000-0000-4000-8000-000000000009"
        build={gravel}
        locale="fr"
        initialItems={items}
        buildListId="00000000-0000-4000-8000-00000000000a"
      />,
    );
  }

  it("sends a ticked line to the action instead of to storage", async () => {
    const { user } = await renderSavedList([item()]);
    await user.click(within(screen.getAllByTestId("build-item")[0]).getByTestId("build-item-done"));

    expect(setBuildListItemDoneAction).toHaveBeenCalledWith({ itemId: item().id, done: true });
    expect(window.localStorage.getItem(buildListKey("demo"))).toBeNull();
  });

  it("clears the done lines by LIST id, not by the ids it was holding", async () => {
    const { user } = await renderSavedList([item({ done: true }), pads]);
    await user.click(screen.getByTestId("build-list-clear-done"));
    expect(clearDoneBuildListItemsAction).toHaveBeenCalledWith({
      buildListId: "00000000-0000-4000-8000-00000000000a",
    });
    expect(screen.getAllByTestId("build-item")).toHaveLength(1);
  });

  it("tells the visitor when a write did not land", async () => {
    setBuildListItemDoneAction.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });
    const { user } = await renderSavedList([item()]);
    await user.click(within(screen.getAllByTestId("build-item")[0]).getByTestId("build-item-done"));
    expect(await screen.findByTestId("build-list-save-failed")).toHaveAttribute("role", "alert");
  });
});
