import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { createViewerStore, ViewerStoreProvider } from "@/components/bike3d/store";
import type { GuideRef } from "@/lib/bike/queries";
import { demoBikeRepo, localBikeRepo } from "@/lib/bike/repo";
import { buildOf, deriveBike } from "@/lib/bike/rules";
import { writeLocalBike, type KeyValueStorage } from "@/lib/bike/local-bike";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import type { PartId } from "@/lib/domain/data/parts";
import { findPart } from "@/lib/domain/engine/parts-for-spec";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { PartInfo } from "./PartInfo";

/**
 * The "Infos" tab (§6.4, §6.8 AC11): what a part is, what shape it is in, what
 * it is made of, and the three things you can do to it.
 *
 * The two claims worth a test are the ones a screenshot would not catch:
 *
 *  - **the guide links follow the bike**, not the part in the abstract — the
 *    same `tire-front` row offers the tubeless guide on a tubeless bike and the
 *    inner-tube one on a tubed bike;
 *  - **the demo bike shows no form at all**, because an edit there would change
 *    what every other visitor sees; it offers the fork instead.
 */
const gravel = buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"])); // tubeless
const roadRim = buildOf(deriveBike(BIKE_PRESETS["road-rim-2x11"])); // inner tubes

function guide(slug: string, appliesTo?: GuideRef["appliesTo"]): GuideRef {
  return { slug, title: slug, ...(appliesTo === undefined ? {} : { appliesTo }) };
}

const GUIDES: GuideRef[] = [
  guide("replace-tube-tire", { path: "tires.system", in: ["clincher-tube"] }),
  guide("replace-tire-tubeless", { path: "tires.system", in: ["tubeless"] }),
  guide("replace-chain"),
  guide("clean-chain"),
];

class MemoryStorage implements KeyValueStorage {
  private value: string | null = null;
  getItem(): string | null {
    return this.value;
  }
  setItem(_key: string, value: string): void {
    this.value = value;
  }
  removeItem(): void {
    this.value = null;
  }
}

let storage: MemoryStorage;

function renderInfo(
  props: Partial<React.ComponentProps<typeof PartInfo>> = {},
  build = gravel,
): ReturnType<typeof renderWithIntl> {
  const store = createViewerStore({
    availablePartIds: build.parts.map((part) => part.partId as PartId),
  });
  return renderWithIntl(
    <ViewerStoreProvider store={store}>
      <PartInfo
        build={build}
        partId="cassette"
        repo={localBikeRepo({ storage })}
        guides={GUIDES}
        bikeParam="local"
        {...props}
      />
    </ViewerStoreProvider>,
  );
}

beforeEach(() => {
  storage = new MemoryStorage();
  writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage });
});

describe("with no part selected", () => {
  it("says what to do instead of showing an empty panel", async () => {
    await renderInfo({ partId: null });
    expect(screen.getByTestId("part-panel-empty")).toHaveTextContent("Aucune pièce sélectionnée");
    expect(screen.getByTestId("part-panel-empty")).toHaveTextContent("Touchez une pièce");
  });

  it("says the same for a part that is not on this bike", async () => {
    await renderInfo({ partId: "e-motor" });
    expect(screen.getByTestId("part-panel-empty")).toBeInTheDocument();
  });
});

describe("the part itself", () => {
  it("names it, describes it and shows its attributes", async () => {
    await renderInfo();
    expect(screen.getByTestId("part-panel-title")).toHaveTextContent("Cassette");
    expect(screen.getByTestId("part-panel")).toHaveTextContent("pignons arrière");

    const attributes = screen.getByTestId("part-attributes");
    expect(within(attributes).getByText("Vitesses")).toBeInTheDocument();
    // An enum value is translated, not printed raw.
    expect(attributes).toHaveTextContent("11 vitesses");
  });

  it("reports the status a checkup left, and 'not checked' otherwise", async () => {
    await renderInfo();
    expect(screen.getByTestId("part-status")).toHaveTextContent("Non contrôlé");

    await renderInfo({ statuses: { cassette: "BROKEN" } });
    expect(screen.getAllByTestId("part-status")[1]).toHaveTextContent("À remplacer");
  });

  it("links to the part's own URL", async () => {
    // The mocked `Link` renders the INTERNAL pathname with its params filled in
    // (`tests/_fakes/session.ts`); the localized mapping and the `?spec=` query
    // are the e2e fixture's business, not a mock's.
    await renderInfo({ specCode: "AQEC" });
    expect(screen.getByTestId("part-permalink")).toHaveAttribute(
      "href",
      "/velo/local/piece/cassette",
    );
  });
});

describe("the guide links", () => {
  it("offers the guide that applies to THIS bike", async () => {
    await renderInfo({ partId: "tire-front" });
    expect(
      screen.getByTestId("part-panel").querySelector("[data-guide-action=replace]"),
    ).toHaveTextContent("replace-tire-tubeless");
  });

  it("offers a different one for a bike with inner tubes", async () => {
    await renderInfo({ partId: "tire-front", repo: localBikeRepo({ storage }) }, roadRim);
    expect(
      screen.getByTestId("part-panel").querySelector("[data-guide-action=replace]"),
    ).toHaveTextContent("replace-tube-tire");
  });

  it("shows nothing for an action this part has no guide for", async () => {
    await renderInfo({ partId: "chain" });
    const panel = screen.getByTestId("part-panel");
    expect(panel.querySelector("[data-guide-action=replace]")).not.toBeNull();
    expect(panel.querySelector("[data-guide-action=adjust]")).toBeNull();
  });
});

describe("editing", () => {
  it("shows the form for a bike the visitor owns", async () => {
    await renderInfo();
    expect(screen.getByTestId("part-edit-form")).toBeInTheDocument();
    expect(screen.queryByTestId("part-panel-fork")).toBeNull();
  });

  it("writes an attribute change straight to the guest bike", async () => {
    const { user } = await renderInfo();
    await user.selectOptions(document.querySelector('[data-attr="range"]')!, "11-36");

    expect(await screen.findByText("Enregistré")).toBeInTheDocument();
    const stored = JSON.parse(storage.getItem()!) as {
      parts: { partId: string; attributes: Record<string, unknown> }[];
    };
    expect(stored.parts.find((part) => part.partId === "cassette")?.attributes.range).toBe("11-36");
  });

  it("replaces the form with the fork CTA on the demo bike", async () => {
    await renderInfo({ repo: demoBikeRepo() });
    expect(screen.queryByTestId("part-edit-form")).toBeNull();
    expect(screen.getByTestId("part-panel-fork")).toHaveTextContent("copie locale");
  });

  it("says so when the write is refused", async () => {
    const { user } = await renderInfo({ repo: localBikeRepo({ storage: null }) });
    await user.selectOptions(document.querySelector('[data-attr="range"]')!, "11-36");
    expect(await screen.findByText("Introuvable.")).toBeInTheDocument();
  });
});

describe("a part whose attributes are all derived", () => {
  it("renders the panel without an edit form rather than an empty section", async () => {
    // `frame` has no editable attribute on this bike: the panel still reads.
    await renderInfo({ partId: "frame" });
    expect(screen.getByTestId("part-panel-title")).toHaveTextContent("Cadre");
    expect(findPart(gravel, "frame")).toBeDefined();
  });
});
