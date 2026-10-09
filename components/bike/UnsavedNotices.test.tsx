import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { showUnsavedNotice, UnsavedNotices } from "./UnsavedNotices";

/**
 * The region the workspace keeps for "this was not saved" when the toast
 * that normally says it cannot be had (`.debug/017` §5.8, "Review of the
 * fix"). Reached through the real workspace in `BikeWorkspace.test.tsx`;
 * here, what only a clock can show.
 */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("UnsavedNotices", () => {
  it("shows nothing — not even an empty alert — until there is something to say", () => {
    const { container } = render(<UnsavedNotices />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says each sentence as an alert, with its reason when there is one, and takes it away after the time given", () => {
    render(<UnsavedNotices />);

    act(() => {
      expect(
        showUnsavedNotice("Pneu avant · Largeur : non enregistré.", "Trop large.", 20_000),
      ).toBe(true);
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
      expect(showUnsavedNotice("Fourche · Débattement : non enregistré.", undefined, 20_000)).toBe(
        true,
      );
    });

    const region = screen.getByRole("alert");
    expect([...region.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "Pneu avant · Largeur : non enregistré. Trop large.",
      "Fourche · Débattement : non enregistré.",
    ]);

    act(() => vi.advanceTimersByTime(15_000));
    expect([...screen.getByRole("alert").querySelectorAll("p")].map((l) => l.textContent)).toEqual([
      "Fourche · Débattement : non enregistré.",
    ]);

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("answers false, and keeps nothing, when no workspace is on screen to say it in", () => {
    expect(showUnsavedNotice("Pneu avant · Largeur : non enregistré.", undefined, 20_000)).toBe(
      false,
    );
    render(<UnsavedNotices />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("forgets what it was saying when the workspace goes: the next bike's page starts with nothing", () => {
    const first = render(<UnsavedNotices />);
    act(() => {
      showUnsavedNotice("Pneu avant · Largeur : non enregistré.", undefined, 20_000);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    first.unmount();
    render(<UnsavedNotices />);
    expect(screen.queryByRole("alert")).toBeNull();
    // The first sentence's timer firing later is not an error either.
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
