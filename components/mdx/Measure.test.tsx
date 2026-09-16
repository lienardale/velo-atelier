import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/tests/_helpers/intl";

import { Measure, measureStorageKey, parseDecimal } from "./Measure";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("parseDecimal", () => {
  it("reads comma and dot decimals, and negative numbers", () => {
    expect(parseDecimal(" 74,2 ")).toBe(74.2);
    expect(parseDecimal("742")).toBe(742);
    expect(parseDecimal("-4.5")).toBe(-4.5);
    for (const bad of ["", "abc", "1.2.3", "1,"]) expect(parseDecimal(bad), bad).toBeNull();
  });
});

describe("Measure", () => {
  it("is a labelled decimal field that remembers the value on this device", async () => {
    await renderWithIntl(<Measure id="saddle-height" unit="mm" target="74 cm" />);
    const input = screen.getByLabelText("Hauteur de selle");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByTestId("measure-figure")).toHaveAttribute(
      "data-measure-id",
      "saddle-height",
    );
    expect(screen.getByText("mm")).toBeInTheDocument();
    expect(screen.getByText("Repère : 74 cm")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "742,5" } });
    expect(window.localStorage.getItem(measureStorageKey("saddle-height"))).toBe("742.5");
    expect(screen.getByText("Enregistrée sur cet appareil.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "abc" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(window.localStorage.getItem(measureStorageKey("saddle-height"))).toBeNull();
  });

  it("restores a stored value and ignores a corrupt one", async () => {
    window.localStorage.setItem(measureStorageKey("sag"), "25");
    window.localStorage.setItem(measureStorageKey("chain-wear"), "{nope");
    await renderWithIntl(
      <>
        <Measure id="sag" unit="percent" />
        <Measure id="chain-wear" unit="percent" />
      </>,
      { locale: "en" },
    );
    expect(screen.getByLabelText("Sag")).toHaveValue("25");
    expect(screen.getByLabelText("Chain wear")).toHaveValue("");
    expect(screen.getAllByText("%")).toHaveLength(2);
  });

  it("keeps working when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await renderWithIntl(<Measure id="tire-pressure" unit="bar" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "4" } });
    expect(input).toHaveValue("4");
    expect(screen.queryByText("Enregistrée sur cet appareil.")).toBeNull();
  });
});
