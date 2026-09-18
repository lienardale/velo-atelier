import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildOf, deriveBike } from "@/lib/bike/rules";
import { LOCAL_BIKE_KEY } from "@/lib/bike/storage-keys";
import { writeLocalBike } from "@/lib/bike/local-bike";
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
