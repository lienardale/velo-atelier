import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildOf, deriveBike } from "@/lib/bike/rules";
import { LOCAL_BIKE_KEY } from "@/lib/bike/storage-keys";
import { readLocalBike, writeLocalBike } from "@/lib/bike/local-bike";
import { resetLocalBikeSnapshotCache } from "@/lib/bike/repo";
import { BIKE_PRESETS } from "@/lib/domain/data/presets";
import { renderWithIntl } from "@/tests/_helpers/intl";

// A `"use server"` module reaches `@/auth` and the Prisma client; the form only
// needs a function reference, and asserting on the call IS the contract.
const updateBikeFitAction = vi.fn();
const updateBikePartAction = vi.fn();
vi.mock("@/app/[locale]/velo/[id]/reglages/actions", () => ({
  updateBikeFitAction: (...args: unknown[]) => updateBikeFitAction(...args),
}));
vi.mock("@/app/[locale]/velo/[id]/actions", () => ({
  updateBikePartAction: (...args: unknown[]) => updateBikePartAction(...args),
}));

const { MeasurementForm, patchFor } = await import("./MeasurementForm");

/**
 * One measurement card's form (§5.6, §6.8 AC12).
 *
 * The number a rider types is not the number the bike keeps: they type an
 * **inseam** and the bike remembers a **saddle height**. That translation, the
 * formatting of the readout (`74,2 cm` in French) and where the value ends up
 * are what this file pins; the arithmetic itself belongs to
 * `lib/geometry/formulas.test.ts`.
 */
const gravel = buildOf(deriveBike(BIKE_PRESETS["gravel-1x11"])); // tubeless, rigid
const emtb = buildOf(deriveBike(BIKE_PRESETS["emtb-mid-1x12"])); // full suspension

function renderForm(
  props: Partial<React.ComponentProps<typeof MeasurementForm>> = {},
  locale: "fr" | "en" = "fr",
) {
  return renderWithIntl(
    <MeasurementForm
      measureId="saddle-height"
      build={gravel}
      fit={{}}
      refKind="local"
      bikeId={null}
      {...props}
    />,
    { locale },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetLocalBikeSnapshotCache();
  writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"] }, { storage: window.localStorage });
  updateBikeFitAction.mockReset();
  updateBikePartAction.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
  resetLocalBikeSnapshotCache();
});

describe("the saddle-height card", () => {
  it("turns an inseam into the height it implies, formatted for the locale", async () => {
    const { user } = await renderForm();
    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    expect(await screen.findByTestId("readout-saddle-height")).toHaveTextContent("74,2 cm");
  });

  it("says 74.2 cm on the English page", async () => {
    const { user } = await renderForm({}, "en");
    await user.type(screen.getByLabelText("Inseam (cm)"), "84");
    expect(await screen.findByTestId("readout-saddle-height")).toHaveTextContent("74.2 cm");
  });

  it("stores the height in millimetres, not the inseam alone (§6.8 AC12)", async () => {
    const { user } = await renderForm();
    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Enregistré")).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(LOCAL_BIKE_KEY)!) as {
      fit: Record<string, number>;
    };
    expect(stored.fit).toEqual({ inseamCm: 84, saddleHeightMm: 742 });
  });

  it("shows nothing until there is something to compute from", async () => {
    await renderForm();
    expect(screen.queryByTestId("readout-saddle-height")).toBeNull();
  });

  it("refuses to save a measurement outside the accepted range", async () => {
    const { user } = await renderForm();
    await user.type(screen.getByLabelText("Entrejambe (cm)"), "480");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  });

  it("starts from what is already on record", async () => {
    window.localStorage.clear();
    resetLocalBikeSnapshotCache();
    writeLocalBike(
      { answers: BIKE_PRESETS["gravel-1x11"], fit: { inseamCm: 80, saddleHeightMm: 706 } },
      { storage: window.localStorage },
    );
    await renderForm();
    expect(await screen.findByDisplayValue("80")).toBeInTheDocument();
  });
});

describe("the other cards", () => {
  it("suggests a pressure from the rider, the bike and the fitted tyre", async () => {
    const { user } = await renderForm({ measureId: "tire-pressure" });
    await user.type(screen.getByLabelText("Poids du cycliste (kg)"), "75");
    await user.type(screen.getByLabelText("Poids du vélo (kg)"), "9");

    const readout = await screen.findByTestId("readout-tire-pressure");
    // gravel-1x11 is tubeless on a 42 mm tyre: well under the road figures.
    expect(readout).toHaveTextContent(/Avant \d,\d bar · arrière \d,\d bar/);
  });

  it("judges sag against the band for this bike's suspension", async () => {
    const { user } = await renderForm({ measureId: "sag", build: emtb });
    await user.type(screen.getByLabelText("Sag mesuré (%)"), "27");
    expect(await screen.findByTestId("readout-sag")).toHaveTextContent("plage conseillée");
  });

  it("calls a stretched chain out", async () => {
    const { user } = await renderForm({ measureId: "chain-wear" });
    await user.type(screen.getByLabelText("12 maillons (mm)"), "306.5");
    expect(await screen.findByTestId("readout-chain-wear")).toHaveTextContent("à remplacer");
  });

  it("has no readout to show for a plain measurement", async () => {
    const { user } = await renderForm({ measureId: "reach" });
    await user.type(screen.getByLabelText("Reach (mm)"), "380");
    expect(screen.queryByTestId("readout-reach")).toBeNull();
  });
});

/**
 * The fit page draws one form per card, all over ONE bike
 * (`app/[locale]/velo/[id]/reglages/page.tsx`), so the record a form was
 * seeded from changes under it: another card is saved, another tab saves, the
 * guest bike is read out of storage after hydration, a revalidation hands a
 * saved bike's cards a fresh `fit`.
 *
 * Until 2026-10-13 every one of those re-seeded the whole card. A guest's
 * save writes `va:bike:local` in the same tab, which fires no `storage`
 * event, so the next card only saw it at its own next render — the visitor's
 * next keystroke there — and that render replaced its draft: the keystroke
 * was dropped with everything typed before it. Measured on the unfixed form:
 * here, "7" typed in the pressure card, the saddle card saved, then "2" → ""
 * and a save of that card answered "Enregistré" with no rider weight stored;
 * in Chromium, "72" typed after the save → "2". A saved bike's cards lost
 * theirs sooner, at the save itself: the action's answer carries the page
 * again, and the fresh `fit` re-seeded all of them ("38" in the reach card →
 * "" in Chromium).
 *
 * The rule now: a field that still shows what was on record follows the
 * record; a field showing anything else is the visitor's, and only their own
 * save of that card changes it.
 */
const NO_FIT = {};

type MeasureId = React.ComponentProps<typeof MeasurementForm>["measureId"];

/** The fit page in small: the cards named, in order, over one bike. */
function cards(
  measureIds: readonly MeasureId[],
  props: Partial<React.ComponentProps<typeof MeasurementForm>> = {},
) {
  return (
    <>
      {measureIds.map((measureId) => (
        <MeasurementForm
          key={measureId}
          measureId={measureId}
          build={gravel}
          fit={NO_FIT}
          refKind="local"
          bikeId={null}
          {...props}
        />
      ))}
    </>
  );
}

const savedIn = (measureId: MeasureId) =>
  waitFor(() =>
    expect(screen.getByTestId(`measure-state-${measureId}`)).toHaveTextContent("Enregistré"),
  );

/** The guest bike in the slot — the SAME bike, same id — with this fit on record. */
function storeFit(fit: Record<string, number>): void {
  const bike = readLocalBike(window.localStorage)!;
  writeLocalBike(
    { id: bike.id, answers: bike.answers, parts: bike.parts, fit },
    { storage: window.localStorage },
  );
}

/**
 * This tab is told that `va:bike:local` has changed — by another tab, as far
 * as it knows. A bare `Event`: the subscription reads no key, it re-reads
 * storage (and CodeQL's model of `StorageEvent` still takes no arguments).
 */
function storageEvent(): void {
  act(() => {
    window.dispatchEvent(new Event("storage"));
  });
}

/** Another tab saves the guest bike: storage first, then the event this tab gets. */
function anotherTabSaves(fit: Record<string, number>): void {
  storeFit(fit);
  storageEvent();
}

/** Another guest bike — another id — takes the slot, and this tab is told. */
function anotherBikeInTheSlot(fit: Record<string, number>): void {
  writeLocalBike({ answers: BIKE_PRESETS["gravel-1x11"], fit }, { storage: window.localStorage });
  storageEvent();
}

/**
 * The guest bike not read yet, for as long as the test says. On the fit page
 * that is the render BEFORE the one hydration schedules (the hook's server
 * snapshot is "pending"), and jsdom cannot put a keystroke between the two —
 * so the hook is held there by hand. The real hook still runs underneath: the
 * `storage` subscription is the real one.
 */
async function guestBikeNotReadYet(): Promise<{ read: () => void; restore: () => void }> {
  const repo = await import("@/lib/bike/repo");
  const real = repo.useLocalBikeSnapshot;
  let pending = true;
  const held = vi.spyOn(repo, "useLocalBikeSnapshot").mockImplementation(() => {
    const snapshot = real();
    return pending ? repo.LOCAL_BIKE_PENDING : snapshot;
  });
  return {
    read: () => {
      pending = false;
    },
    restore: () => held.mockRestore(),
  };
}

describe("two cards over one guest bike", () => {
  const fitOf = () => readLocalBike(window.localStorage)?.fit ?? null;

  it("a save in one card leaves what is typed in the other as typed, the next keystroke included", async () => {
    const { user } = await renderWithIntl(cards(["saddle-height", "tire-pressure"]));
    const [saveSaddle, savePressure] = screen.getAllByRole("button", { name: "Enregistrer" });
    const rider = screen.getByLabelText("Poids du cycliste (kg)");

    // Half a number in the pressure card, then the visitor goes and saves the other.
    await user.type(rider, "7");
    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    await user.click(saveSaddle);
    await savedIn("saddle-height");
    expect(rider).toHaveValue(7);

    // The keystroke that was eaten: the pressure card's first render since that save.
    await user.type(rider, "2");
    expect(rider).toHaveValue(72);

    await user.type(screen.getByLabelText("Poids du vélo (kg)"), "9");
    await user.click(savePressure);
    await savedIn("tire-pressure");
    expect(fitOf()).toEqual({ inseamCm: 84, saddleHeightMm: 742, riderKg: 72, bikeKg: 9 });
  });

  it("a number typed in a card after another was saved is whole", async () => {
    const { user } = await renderWithIntl(cards(["saddle-height", "tire-pressure"]));
    const [saveSaddle] = screen.getAllByRole("button", { name: "Enregistrer" });

    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    await user.click(saveSaddle);
    await savedIn("saddle-height");

    // "2" on the unfixed form: the "7" was the keystroke that re-seeded the card.
    const rider = screen.getByLabelText("Poids du cycliste (kg)");
    await user.type(rider, "72");
    expect(rider).toHaveValue(72);
  });

  // A pin, true before the repair too: the height stored is the formula's,
  // whatever was typed beside the inseam — and the card says so.
  it("the card that was saved shows what was stored, not what was typed", async () => {
    const { user } = await renderWithIntl(cards(["saddle-height", "tire-pressure"]));
    const [saveSaddle] = screen.getAllByRole("button", { name: "Enregistrer" });
    const height = screen.getByLabelText("Hauteur de selle (mm)");

    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    await user.type(height, "750");
    await user.click(saveSaddle);
    await savedIn("saddle-height");

    expect(fitOf()).toEqual({ inseamCm: 84, saddleHeightMm: 742 });
    expect(screen.getByLabelText("Entrejambe (cm)")).toHaveValue(84);
    expect(height).toHaveValue(742);
  });

  it("a field nobody typed in follows the record; the one beside it, typed in, does not move", async () => {
    const { user } = await renderWithIntl(cards(["saddle-height", "tire-pressure"]));
    const rider = screen.getByLabelText("Poids du cycliste (kg)");
    const bike = screen.getByLabelText("Poids du vélo (kg)");
    await user.type(bike, "9");

    anotherTabSaves({ inseamCm: 80, saddleHeightMm: 706, riderKg: 68, bikeKg: 11 });

    expect(screen.getByLabelText("Entrejambe (cm)")).toHaveValue(80);
    expect(screen.getByLabelText("Hauteur de selle (mm)")).toHaveValue(706);
    expect(rider).toHaveValue(68);
    expect(bike).toHaveValue(9);

    // And it goes on following, save after save, while the typed one stays.
    anotherTabSaves({ inseamCm: 80, saddleHeightMm: 706, riderKg: 70, bikeKg: 12 });
    expect(rider).toHaveValue(70);
    expect(bike).toHaveValue(9);
  });

  it("a field emptied by hand is typed in too: it stays empty while the record moves", async () => {
    storeFit({ riderKg: 68, bikeKg: 11 });
    const { user } = await renderWithIntl(cards(["saddle-height", "tire-pressure"]));
    const [saveSaddle] = screen.getAllByRole("button", { name: "Enregistrer" });
    const rider = screen.getByLabelText("Poids du cycliste (kg)");
    const bike = screen.getByLabelText("Poids du vélo (kg)");
    expect(rider).toHaveValue(68);

    // Emptied, and nothing typed yet: the record moving must not fill it again.
    await user.clear(rider);
    anotherTabSaves({ riderKg: 70, bikeKg: 12 });
    expect(rider).toHaveValue(null);
    expect(bike).toHaveValue(12);

    // Nor does another card's save in this tab, at the keystroke that follows it.
    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    await user.click(saveSaddle);
    await savedIn("saddle-height");
    await user.type(rider, "7");
    expect(rider).toHaveValue(7);
    expect(bike).toHaveValue(12);
  });

  // Compared as the text on screen, not through a "touched" flag that could
  // outlive what it was raised for.
  it("a number typed and then deleted is an untouched field again", async () => {
    const { user } = await renderWithIntl(cards(["saddle-height", "tire-pressure"]));
    const rider = screen.getByLabelText("Poids du cycliste (kg)");
    await user.type(rider, "7{Backspace}");
    expect(rider).toHaveValue(null);

    anotherTabSaves({ riderKg: 68 });
    expect(rider).toHaveValue(68);
  });

  /**
   * The one change of record that does take what was typed, pinned so that it
   * stays a decision: `va:bike:local` is a slot, and a NEW guest bike in it —
   * another id — is another bike. What was typed was typed for the first.
   */
  it("another guest bike in the slot: every card shows the new bike's values, and nothing typed for the first", async () => {
    const first = readLocalBike(window.localStorage)!;
    const { user } = await renderWithIntl(cards(["saddle-height", "tire-pressure"]));
    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    await user.type(screen.getByLabelText("Poids du cycliste (kg)"), "72");

    anotherBikeInTheSlot({ inseamCm: 78, saddleHeightMm: 689 });
    expect(readLocalBike(window.localStorage)!.id).not.toBe(first.id);

    expect(screen.getByLabelText("Entrejambe (cm)")).toHaveValue(78);
    expect(screen.getByLabelText("Hauteur de selle (mm)")).toHaveValue(689);
    expect(screen.getByLabelText("Poids du cycliste (kg)")).toHaveValue(null);
  });

  // The same decision from the other side: what was typed when the slot was
  // empty was typed for no bike, and could not be saved.
  it("a guest bike where there was none: its values, and nothing typed before it", async () => {
    window.localStorage.clear();
    resetLocalBikeSnapshotCache();
    const { user } = await renderWithIntl(cards(["saddle-height"]));
    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");

    anotherBikeInTheSlot({ inseamCm: 78, saddleHeightMm: 689 });

    expect(screen.getByLabelText("Entrejambe (cm)")).toHaveValue(78);
  });

  /**
   * The bike GONE is not another bike: the guest import in another tab clears
   * the slot once the bike is in the account. Nothing has taken its place, so
   * nothing typed is taken — it cannot be saved either, and the card says so —
   * while the fields nobody typed in show that there is no record any more.
   * Whatever bike comes next is another one.
   */
  it("the guest bike gone from the slot: what was typed stays, what was on record goes", async () => {
    storeFit({ riderKg: 68, bikeKg: 11 });
    const { user } = await renderWithIntl(cards(["saddle-height", "tire-pressure"]));
    const [saveSaddle] = screen.getAllByRole("button", { name: "Enregistrer" });
    const inseam = screen.getByLabelText("Entrejambe (cm)");
    await user.type(inseam, "84");

    window.localStorage.removeItem(LOCAL_BIKE_KEY);
    storageEvent();

    expect(inseam).toHaveValue(84);
    expect(screen.getByLabelText("Poids du cycliste (kg)")).toHaveValue(null);
    expect(screen.getByLabelText("Poids du vélo (kg)")).toHaveValue(null);

    await user.click(saveSaddle);
    expect(await screen.findByText("Introuvable.")).toBeInTheDocument();
    expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBeNull();
    expect(inseam).toHaveValue(84);

    anotherBikeInTheSlot({ inseamCm: 78, saddleHeightMm: 689 });
    expect(inseam).toHaveValue(78);
  });

  /**
   * The first read is not another bike. On the fit page the guest bike arrives
   * in the render AFTER hydration, and a field typed in before that render was
   * wiped by it — the `mobile-webkit` flake of `.debug/015` §2, with React
   * already attached to the input.
   */
  it("typed before the guest bike was read: kept once it is, and the fields beside it take what was stored", async () => {
    storeFit({ inseamCm: 80, saddleHeightMm: 706 });
    const hook = await guestBikeNotReadYet();
    try {
      const { user, rerender } = await renderWithIntl(cards(["saddle-height"]));
      const inseam = screen.getByLabelText("Entrejambe (cm)");
      expect(inseam).toHaveValue(null);
      await user.type(inseam, "84");

      hook.read();
      rerender(cards(["saddle-height"]));

      expect(inseam).toHaveValue(84);
      expect(screen.getByLabelText("Hauteur de selle (mm)")).toHaveValue(706);
    } finally {
      hook.restore();
    }
  });

  // The first read can also find NO bike: what is typed stays (nothing was
  // read, nothing changed), and the bike that then arrives is another one.
  it("read, and no guest bike found: what was typed stays, until one arrives", async () => {
    window.localStorage.clear();
    resetLocalBikeSnapshotCache();
    const hook = await guestBikeNotReadYet();
    try {
      const { user, rerender } = await renderWithIntl(cards(["saddle-height"]));
      const inseam = screen.getByLabelText("Entrejambe (cm)");
      await user.type(inseam, "84");

      hook.read();
      rerender(cards(["saddle-height"]));
      expect(inseam).toHaveValue(84);

      anotherBikeInTheSlot({ inseamCm: 78, saddleHeightMm: 689 });
      expect(inseam).toHaveValue(78);
    } finally {
      hook.restore();
    }
  });
});

describe("two cards over one saved bike", () => {
  const BIKE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const saved = { refKind: "db", bikeId: BIKE_ID } as const;

  /** What `revalidatePath` does after the action: the page again, with the fit as stored. */
  const STORED = { inseamCm: 84, saddleHeightMm: 742 };

  /** A save whose answer the test gives, when it chooses. */
  function saveOnItsWay(): (data: Record<string, number>) => Promise<void> {
    let answer!: (result: { ok: true; data: Record<string, number> }) => void;
    updateBikeFitAction.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    return (data) =>
      act(async () => {
        answer({ ok: true, data });
      });
  }

  const sending = (measureId: MeasureId) =>
    waitFor(() =>
      expect(screen.getByTestId(`measure-state-${measureId}`)).toHaveTextContent("Enregistrement…"),
    );

  it("the fresh fit a save hands every card does not take what is typed in another", async () => {
    updateBikeFitAction.mockResolvedValue({ ok: true, data: STORED });
    const { user, rerender } = await renderWithIntl(
      cards(["saddle-height", "reach"], { ...saved, fit: NO_FIT }),
    );
    const [saveSaddle] = screen.getAllByRole("button", { name: "Enregistrer" });
    const reach = screen.getByLabelText("Reach (mm)");

    await user.type(reach, "38");
    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    await user.click(saveSaddle);
    await savedIn("saddle-height");
    rerender(cards(["saddle-height", "reach"], { ...saved, fit: { ...STORED } }));

    expect(reach).toHaveValue(38);
    await user.type(reach, "0");
    expect(reach).toHaveValue(380);
    expect(screen.getByLabelText("Entrejambe (cm)")).toHaveValue(84);
    expect(screen.getByLabelText("Hauteur de selle (mm)")).toHaveValue(742);
  });

  it("a field nobody typed in follows the fresh fit", async () => {
    const { rerender } = await renderWithIntl(cards(["tire-pressure"], { ...saved, fit: NO_FIT }));
    rerender(cards(["tire-pressure"], { ...saved, fit: { riderKg: 68 } }));
    expect(screen.getByLabelText("Poids du cycliste (kg)")).toHaveValue(68);
  });

  // In jsdom nothing renders the page again, and the unfixed form went back to
  // the `fit` it was mounted with: both inputs empty under "Enregistré".
  it("the card that was saved shows what was stored, whether or not the page is rendered again", async () => {
    updateBikeFitAction.mockResolvedValue({ ok: true, data: STORED });
    const { user } = await renderWithIntl(cards(["saddle-height"], { ...saved, fit: NO_FIT }));

    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await savedIn("saddle-height");

    expect(screen.getByLabelText("Entrejambe (cm)")).toHaveValue(84);
    expect(screen.getByLabelText("Hauteur de selle (mm)")).toHaveValue(742);
  });

  // What the card stored is what its untouched fields show from then on: the
  // record it follows next is compared with THAT, not with the `fit` it was
  // mounted with.
  it("a saved field follows the record again, from what was stored", async () => {
    updateBikeFitAction.mockResolvedValue({ ok: true, data: { reachMm: 380 } });
    const { user, rerender } = await renderWithIntl(cards(["reach"], { ...saved, fit: NO_FIT }));
    const reach = screen.getByLabelText("Reach (mm)");

    await user.type(reach, "380");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await savedIn("reach");

    // Another device, later: the page comes back with another reach.
    rerender(cards(["reach"], { ...saved, fit: { reachMm: 400 } }));
    expect(reach).toHaveValue(400);
  });

  it("typed while the save was on its way: kept, and not taken for what the save stored", async () => {
    const answer = saveOnItsWay();
    const { user } = await renderWithIntl(cards(["reach"], { ...saved, fit: NO_FIT }));
    const reach = screen.getByLabelText("Reach (mm)");

    await user.type(reach, "380");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await sending("reach");
    // The visitor corrects the number before the server has answered for the first.
    await user.type(reach, "{Backspace}5");
    await answer({ reachMm: 380 });
    await savedIn("reach");

    expect(updateBikeFitAction).toHaveBeenCalledWith({ bikeId: BIKE_ID, fit: { reachMm: 380 } });
    expect(reach).toHaveValue(385);
  });

  it("emptied while the save was on its way: stays empty, through the answer and the page that follows it", async () => {
    const answer = saveOnItsWay();
    const { user, rerender } = await renderWithIntl(cards(["reach"], { ...saved, fit: NO_FIT }));
    const reach = screen.getByLabelText("Reach (mm)");

    await user.type(reach, "380");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await sending("reach");
    await user.clear(reach);
    await answer({ reachMm: 380 });
    await savedIn("reach");
    expect(reach).toHaveValue(null);

    rerender(cards(["reach"], { ...saved, fit: { reachMm: 380 } }));
    expect(reach).toHaveValue(null);
  });

  /**
   * The record can move while the card's own save is on its way, and a field
   * the save sent untouched moves with it. That is not "typed since": when the
   * answer comes the field shows what was stored, like any other the visitor
   * left alone. Found in review — the first repair compared the field with
   * what was sent, word for word, and left 706 under "Enregistré" with 742
   * stored, for good. No path to it was found in the app (the page a save
   * brings back arrives after its answer); the form does not lean on that.
   */
  it("the record moves while the save is on its way: the card still shows what was stored", async () => {
    const answer = saveOnItsWay();
    const { user, rerender } = await renderWithIntl(
      cards(["saddle-height"], { ...saved, fit: NO_FIT }),
    );
    const inseam = screen.getByLabelText("Entrejambe (cm)");
    const height = screen.getByLabelText("Hauteur de selle (mm)");

    await user.type(inseam, "84");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await sending("saddle-height");

    // Another device's measurements arrive first: typed stays, untouched follows.
    rerender(cards(["saddle-height"], { ...saved, fit: { inseamCm: 80, saddleHeightMm: 706 } }));
    expect(inseam).toHaveValue(84);
    expect(height).toHaveValue(706);

    await answer(STORED);
    await savedIn("saddle-height");
    expect(inseam).toHaveValue(84);
    expect(height).toHaveValue(742);

    // And both are untouched fields again: the next record is followed.
    rerender(cards(["saddle-height"], { ...saved, fit: { inseamCm: 85, saddleHeightMm: 751 } }));
    expect(inseam).toHaveValue(85);
    expect(height).toHaveValue(751);
  });

  // A prop can change where a route would have mounted the form again; the
  // answer to a save sent for the first bike is not the second bike's record.
  it("another saved bike while a save is on its way: the answer for the first shows nowhere", async () => {
    const answer = saveOnItsWay();
    const { user, rerender } = await renderWithIntl(cards(["reach"], { ...saved, fit: NO_FIT }));
    const reach = screen.getByLabelText("Reach (mm)");

    await user.type(reach, "380");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await sending("reach");

    const other = { refKind: "db", bikeId: "7c9e6679-7425-40de-944b-e07fc1f90ae7" } as const;
    rerender(cards(["reach"], { ...other, fit: { reachMm: 400 } }));
    expect(reach).toHaveValue(400);

    await answer({ reachMm: 380 });
    await savedIn("reach");
    expect(reach).toHaveValue(400);

    // Its untouched field is still the second bike's, and follows its record.
    rerender(cards(["reach"], { ...other, fit: { reachMm: 410 } }));
    expect(reach).toHaveValue(410);
  });
});

describe("where the value goes", () => {
  it("calls the server action for a saved bike, with the bike's id", async () => {
    updateBikeFitAction.mockResolvedValue({
      ok: true,
      data: { inseamCm: 84, saddleHeightMm: 742 },
    });
    const { user } = await renderForm({
      refKind: "db",
      bikeId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      fit: {},
    });

    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Enregistré")).toBeInTheDocument();
    expect(updateBikeFitAction).toHaveBeenCalledWith({
      bikeId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      fit: { inseamCm: 84, saddleHeightMm: 742 },
    });
  });

  it("shows the action's own refusal", async () => {
    updateBikeFitAction.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const { user } = await renderForm({
      refKind: "db",
      bikeId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Introuvable.")).toBeInTheDocument();
  });

  it("offers no save at all on the demo bike", async () => {
    await renderForm({ refKind: "demo" });
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
    expect(screen.getByLabelText("Entrejambe (cm)")).toBeDisabled();
    expect(screen.getByTestId("measure-form-saddle-height")).toHaveTextContent("copie locale");
  });
});

/**
 * `va:bike:local` is a slot: the guest bike in it is replaced by a NEW one —
 * the demo's local copy, a bike generated again from the tree — by another
 * page of the same browser, while this one is open. The guest repo used to
 * write back under whatever id it found there, so a fit saved before this
 * page had heard of the replacement was bike A's measurement in bike B
 * (`.debug/017` §5.8, "Fourth review": found for the part form, whose field
 * commits on removal; here the same repo under the form with a button). The
 * form's repo is built for the bike its inputs were seeded from.
 */
describe("a guest bike's fit goes to the bike the inputs were seeded from", () => {
  const fitOf = () => readLocalBike(window.localStorage)?.fit ?? null;

  it("the guest bike replaced by another page, and this page not told yet: the save is refused, and nothing is written to the new bike", async () => {
    const a = readLocalBike(window.localStorage)!;
    const { user } = await renderForm();
    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");

    // Another page stores a NEW guest bike; the `storage` event is not here yet.
    const b = writeLocalBike(
      { answers: BIKE_PRESETS["gravel-1x11"] },
      { storage: window.localStorage },
    )!;
    expect(b.id).not.toBe(a.id);
    const bytes = window.localStorage.getItem(LOCAL_BIKE_KEY);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    // The save has answered, one way or the other.
    const state = screen.getByTestId("measure-state-saddle-height");
    await waitFor(() => expect(state.textContent).toMatch(/^(Enregistré|Introuvable\.)$/));
    expect(fitOf(), "bike B's fit, which nobody typed anything for").toBeNull();
    // Not one byte of B moved — `updatedAt` included.
    expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBe(bytes);
    expect(readLocalBike(window.localStorage)!.id).toBe(b.id);
    expect(state).toHaveTextContent("Introuvable.");
  });

  /**
   * The other side, pinned so that it stays a decision: once this page HAS
   * been told, its inputs are re-seeded from the new bike (as they always
   * were: what was typed for the first is dropped), and the repo is built
   * again for it — what is saved from then on was typed over the new bike's
   * values, and is the new bike's.
   */
  it("once this page is told (the storage event), the inputs are the new bike's and a save is the new bike's", async () => {
    const { user } = await renderForm();
    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");

    const b = writeLocalBike(
      { answers: BIKE_PRESETS["gravel-1x11"], fit: { inseamCm: 78, saddleHeightMm: 689 } },
      { storage: window.localStorage },
    )!;
    act(() => {
      window.dispatchEvent(new Event("storage"));
    });

    const inseam = screen.getByLabelText("Entrejambe (cm)");
    expect(inseam).toHaveValue(78);
    await user.clear(inseam);
    await user.type(inseam, "80");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Enregistré")).toBeInTheDocument();
    expect(readLocalBike(window.localStorage)!.id).toBe(b.id);
    expect(fitOf()).toEqual({ inseamCm: 80, saddleHeightMm: 706 });
  });

  // A pin: with nothing stored the save was refused before the repair too.
  it("no guest bike in this browser at all: the save is refused, and none is written into being", async () => {
    window.localStorage.clear();
    resetLocalBikeSnapshotCache();
    const { user } = await renderForm();
    await user.type(screen.getByLabelText("Entrejambe (cm)"), "84");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Introuvable.")).toBeInTheDocument();
    expect(window.localStorage.getItem(LOCAL_BIKE_KEY)).toBeNull();
  });
});

describe("patchFor", () => {
  it("derives the saddle height and leaves every other card's values alone", () => {
    expect(patchFor("saddle-height", { inseamCm: 84 })).toEqual({
      inseamCm: 84,
      saddleHeightMm: 742,
    });
    expect(patchFor("saddle-height", {})).toEqual({});
    expect(patchFor("tire-pressure", { riderKg: 75, bikeKg: 9 })).toEqual({
      riderKg: 75,
      bikeKg: 9,
    });
  });
});
